import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { jsonSafeToolOutput, recentConversationMessages } from "../src/agent/model-context";

describe("agent model context", () => {
  it("keeps the current and four previous user turns with their conversational replies", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "too old" },
      { role: "assistant", content: "too old reply" },
      ...Array.from({ length: 5 }, (_, index) => [
        { role: "user", content: `request ${index + 1}` } satisfies ModelMessage,
        { role: "assistant", content: `reply ${index + 1}` } satisfies ModelMessage,
      ]).flat(),
    ];

    expect(recentConversationMessages(messages)).toEqual(messages.slice(2));
  });

  it("removes old tool payloads while preserving nearby assistant text", () => {
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

  it("can keep a multi-message burst plus four previous user turns", () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      role: "user" as const,
      content: `message ${index + 1}`,
    }));

    expect(recentConversationMessages(messages, 7)).toEqual(messages.slice(1));
  });

  it("converts database dates into valid JSON tool output", () => {
    expect(
      jsonSafeToolOutput({ occurredAt: new Date("2026-08-22T12:00:00.000Z"), value: 80 }),
    ).toEqual({ occurredAt: "2026-08-22T12:00:00.000Z", value: 80 });
  });
});
