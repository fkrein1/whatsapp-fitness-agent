import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { jsonSafeToolOutput, recentConversationMessages } from "../src/agent/model-context";
import {
  contextWithCachedInstructions,
  FitnessAgent,
  toolsForNextStep,
} from "../src/agent/fitness-agent";

describe("agent model context", () => {
  it("keeps the current and five previous user turns with their conversational replies", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "too old" },
      { role: "assistant", content: "too old reply" },
      ...Array.from({ length: 6 }, (_, index) => [
        { role: "user", content: `request ${index + 1}` } satisfies ModelMessage,
        { role: "assistant", content: `reply ${index + 1}` } satisfies ModelMessage,
      ]).flat(),
    ];

    expect(recentConversationMessages(messages)).toEqual(messages.slice(2));
  });

  it("removes completed tool traffic while keeping the conversational replies", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "what did I lift?" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "query_recent_exercise",
            input: { days: 7 },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "query_recent_exercise",
            output: { type: "json", value: { large: "payload" } },
          },
        ],
      },
      { role: "assistant", content: "You trained bench press." },
      { role: "user", content: "and the week before?" },
    ];

    expect(recentConversationMessages(messages)).toEqual([
      { role: "user", content: "what did I lift?" },
      { role: "assistant", content: "You trained bench press." },
      { role: "user", content: "and the week before?" },
    ]);
  });

  it("can keep a multi-message burst plus five previous user turns", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: "user" as const,
      content: `message ${index + 1}`,
    }));

    expect(recentConversationMessages(messages, 8, 3)).toEqual(messages.slice(4));
  });

  it("keeps media only for the current user burst", () => {
    const oldFile = {
      type: "file" as const,
      mediaType: "image/jpeg",
      data: { type: "url" as const, url: new URL("data:image/jpeg;base64,AQID") },
    };
    const currentFile = {
      type: "file" as const,
      mediaType: "image/jpeg",
      data: { type: "url" as const, url: new URL("data:image/jpeg;base64,BAUG") },
    };
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "old photo" }, oldFile],
      },
      { role: "assistant", content: "I saw yogurt." },
      {
        role: "user",
        content: [{ type: "text", text: "current photo" }, currentFile],
      },
    ];

    expect(recentConversationMessages(messages, 9, 1)).toEqual([
      { role: "user", content: [{ type: "text", text: "old photo" }] },
      { role: "assistant", content: "I saw yogurt." },
      {
        role: "user",
        content: [{ type: "text", text: "current photo" }, currentFile],
      },
    ]);
  });

  it("converts database dates into valid JSON tool output", () => {
    expect(
      jsonSafeToolOutput({ occurredAt: new Date("2026-08-22T12:00:00.000Z"), value: 80 }),
    ).toEqual({ occurredAt: "2026-08-22T12:00:00.000Z", value: 80 });
  });

  it("ends the explicit cache prefix after the stable prompt and Soul", () => {
    const context = contextWithCachedInstructions(
      "stable prompt",
      "stable Soul",
      "changing timestamp",
      [{ role: "user", content: "current message" }],
    );

    expect(context).toEqual({
      instructions: {
        role: "system",
        content: "stable prompt\n\nContexto pessoal confiável:\n<soul>\nstable Soul\n</soul>",
        providerOptions: {
          openai: {
            promptCacheBreakpoint: { mode: "explicit" },
          },
        },
      },
      messages: [
        { role: "user", content: "changing timestamp" },
        { role: "user", content: "current message" },
      ],
    });
  });

  it("keeps nonterminal deferred tools stable and disables them after writes", () => {
    expect(toolsAfter("research_nutrition")).toEqual({});
    expect(toolsAfter("query_meals")).toEqual({});
    expect(toolsAfter("record_events")).toEqual({
      toolChoice: "none",
    });
    expect(toolsAfter("record_meals")).toEqual({
      toolChoice: "none",
    });
  });

  it("puts every fitness function in one deferred namespace", () => {
    const agent = Object.create(FitnessAgent.prototype) as FitnessAgent;
    const tools = agent.getTools();

    expect(tools.tool_search).toMatchObject({ type: "provider", id: "openai.tool_search" });
    for (const name of [
      "record_events",
      "record_meals",
      "research_nutrition",
      "query_meals",
      "query_training",
      "query_measurements",
      "query_timeline",
      "manage_records",
      "update_soul",
      "resolve_pending_meal",
    ]) {
      expect(tools[name]).toMatchObject({
        providerOptions: {
          openai: {
            namespace: { name: "fitness" },
            deferLoading: true,
          },
        },
      });
    }
  });
});

function toolsAfter(toolName: string) {
  return toolsForNextStep({ steps: [{ toolCalls: [{ toolName }] }] });
}
