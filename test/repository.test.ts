import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "../src/db/client";
import {
  claimSourceMessage,
  getDailyCalories,
  getRecentWeights,
  saveIngestion,
} from "../src/db/repository";

describe("fitness repository", () => {
  it("claims a WhatsApp message only once", async () => {
    const db = createDatabase(env.DB);
    const input = {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId: "5511999999999",
      inputType: "text" as const,
      text: "I weigh 80 kg",
      mediaId: null,
      mimeType: null,
      receivedAt: new Date(),
    };

    expect(await claimSourceMessage(db, input)).toEqual(expect.any(String));
    expect(await claimSourceMessage(db, input)).toBeNull();
  });

  it("stores queryable meals and weekly weight", async () => {
    const db = createDatabase(env.DB);
    const occurredAt = new Date();
    const sourceMessageId = await claimSourceMessage(db, {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId: "5511999999999",
      inputType: "text",
      text: "80 kg and a 500 calorie lunch",
      mediaId: null,
      mimeType: null,
      receivedAt: occurredAt,
    });
    expect(sourceMessageId).not.toBeNull();

    await saveIngestion(
      db,
      sourceMessageId!,
      {
        events: [
          {
            kind: "measurement",
            occurredAt: occurredAt.toISOString(),
            summary: "Weight 80 kg",
            confidence: 1,
            mealItems: [],
            exerciseSets: [],
            measurements: [{ metric: "weight", value: 80, unit: "kg" }],
          },
          {
            kind: "meal",
            occurredAt: occurredAt.toISOString(),
            summary: "Lunch",
            confidence: 0.8,
            mealItems: [
              {
                name: "Lunch",
                quantity: null,
                unit: null,
                caloriesKcal: 500,
                proteinGrams: null,
                carbsGrams: null,
                fatGrams: null,
                confidence: 0.8,
                nutritionSource: "user_provided",
              },
            ],
            exerciseSets: [],
            measurements: [],
          },
        ],
        query: null,
        reply: "Logged.",
      },
      occurredAt,
    );

    expect(await getDailyCalories(db, occurredAt)).toBe(500);
    expect(await getRecentWeights(db, 7)).toEqual([
      expect.objectContaining({ value: 80, unit: "kg" }),
    ]);
  });
});
