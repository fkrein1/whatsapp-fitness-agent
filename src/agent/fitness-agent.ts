import { Think } from "@cloudflare/think";
import type { ChatResponseResult, TurnConfig, TurnContext } from "@cloudflare/think";
import { tool } from "ai";
import type { ToolSet, UIMessage } from "ai";
import { z } from "zod";

import { createDatabase } from "../db/client";
import {
  getDailyCalories,
  getRecentEvents,
  getRecentWeights,
  markSourceMessageProcessed,
  saveIngestion,
} from "../db/repository";
import { extractedEventSchema } from "../ingestion/types";
import { searchNutrition } from "../nutrition/brave";
import { sendWhatsAppText } from "../whatsapp/client";

const sourceInput = { sourceMessageId: z.string().uuid() };

export class FitnessAgent extends Think<Env> {
  workspaceBash = false;
  includeMcpTools = false;
  sendReasoning = false;
  maxSteps = 6;
  chatStreamStallTimeoutMs = 120_000;
  chatRecovery = {
    maxAttempts: 3,
    stableTimeoutMs: 120_000,
    terminalMessage: "I could not finish that request. Please try again.",
  };

  getModel() {
    return "openai/gpt-5.6-luna";
  }

  getSystemPrompt() {
    return `You are a private fitness logging agent for one user in Brazil.
Use tools for every request. Never claim that data was logged or queried without a successful tool result.
The user message includes a sourceMessageId. Pass it unchanged to the terminal fitness tool.
Record workouts, runs, meals, body weight, and notes with explicit dates when supplied.
Use search_nutrition before recording branded, packaged, restaurant, or menu food unless the user supplied label values.
For uncertain portions, state that calories are estimates and lower confidence.
Keep the final WhatsApp reply short and specific. Do not give medical advice.`;
  }

  beforeTurn(_context: TurnContext): TurnConfig {
    return { maxOutputTokens: 2000, maxRetries: 2 };
  }

  getTools(): ToolSet {
    return {
      record_fitness: tool({
        description: "Persist extracted workouts, runs, meals, measurements, or notes.",
        inputSchema: z.object({
          ...sourceInput,
          occurredAtFallback: z.string().datetime(),
          events: z.array(extractedEventSchema).min(1),
        }),
        execute: async ({ sourceMessageId, occurredAtFallback, events }) => {
          await saveIngestion(
            createDatabase(this.env.DB),
            sourceMessageId,
            { events, query: null, reply: "Recorded." },
            new Date(occurredAtFallback),
            { externalKeyPrefix: sourceMessageId },
          );
          return { saved: true, eventCount: events.length };
        },
      }),
      search_nutrition: tool({
        description:
          "Search Brazilian nutrition sources for a branded, packaged, restaurant, or menu food.",
        inputSchema: z.object({ queries: z.array(z.string().min(1)).min(1).max(3) }),
        execute: ({ queries }) => searchNutrition(queries, this.env),
      }),
      query_daily_calories: tool({
        description: "Return calories logged for a UTC calendar date.",
        inputSchema: z.object({ ...sourceInput, date: z.string().date() }),
        execute: async ({ sourceMessageId, date }) => {
          const db = createDatabase(this.env.DB);
          const calories = await getDailyCalories(db, new Date(`${date}T12:00:00Z`));
          await markSourceMessageProcessed(db, sourceMessageId);
          return { date, caloriesKcal: Math.round(calories) };
        },
      }),
      query_recent_exercise: tool({
        description: "Return recent workout and run summaries.",
        inputSchema: z.object({ ...sourceInput, days: z.number().int().min(1).max(365) }),
        execute: async ({ sourceMessageId, days }) => {
          const db = createDatabase(this.env.DB);
          const events = await getRecentEvents(db, ["workout", "run"], days);
          await markSourceMessageProcessed(db, sourceMessageId);
          return events;
        },
      }),
      query_recent_weight: tool({
        description: "Return recent body-weight measurements.",
        inputSchema: z.object({ ...sourceInput, days: z.number().int().min(1).max(365) }),
        execute: async ({ sourceMessageId, days }) => {
          const db = createDatabase(this.env.DB);
          const weights = await getRecentWeights(db, days);
          await markSourceMessageProcessed(db, sourceMessageId);
          return weights;
        },
      }),
    };
  }

  async submitWhatsAppText(input: {
    sourceMessageId: string;
    providerMessageId: string;
    text: string;
    receivedAt: string;
  }) {
    const message: UIMessage = {
      id: input.providerMessageId,
      role: "user",
      parts: [
        {
          type: "text",
          text: `sourceMessageId: ${input.sourceMessageId}\nreceivedAt: ${input.receivedAt}\n\n${input.text}`,
        },
      ],
    };
    return this.submitMessages([message], {
      idempotencyKey: input.providerMessageId,
      metadata: { sourceMessageId: input.sourceMessageId, channel: "whatsapp" },
    });
  }

  async onChatResponse(result: ChatResponseResult) {
    if (result.status !== "completed" || result.continuation) return;
    const text = result.message.parts
      .filter(
        (part): part is Extract<(typeof result.message.parts)[number], { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) await sendWhatsAppText(this.env.WHATSAPP_RECIPIENT, text, this.env);
  }
}
