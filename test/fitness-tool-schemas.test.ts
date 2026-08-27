import { describe, expect, it } from "vitest";

import {
  compactToolSchema,
  deleteMealsInputSchema,
  manageRecordsInputSchema,
  mealQuerySchema,
  measurementQuerySchema,
  pendingMealActionSchema,
  recordEventsInputSchema,
  recordMealsInputSchema,
  timelineQuerySchema,
  trainingQuerySchema,
  updateSoulInputSchema,
} from "../src/agent/fitness-tool-schemas";

describe("fitness tool schemas", () => {
  it("accepts ISO timestamps with UTC or explicit offsets", () => {
    for (const occurredAt of ["2026-08-24T12:30:00Z", "2026-08-24T09:30:00-03:00"]) {
      expect(
        recordEventsInputSchema.safeParse({
          events: [
            {
              kind: "workout",
              occurredAt,
              summary: "Treino",
              confidence: 1,
              sets: [
                {
                  exercise: "Shoulder Press",
                  setNumber: 1,
                  reps: 10,
                  weightKg: 70,
                  durationSeconds: null,
                  distanceMeters: null,
                },
              ],
            },
          ],
        }).success,
      ).toBe(true);
    }
  });

  it("accepts replacing a complete workout in one correction", () => {
    expect(
      manageRecordsInputSchema.safeParse({
        changes: [
          {
            action: "replace_workout",
            eventRef: crypto.randomUUID(),
            occurredAt: "2026-08-24T09:30:00-03:00",
            sets: [
              {
                exercise: "Shoulder Press",
                setNumber: 1,
                reps: 10,
                weightKg: 70,
                durationSeconds: null,
                distanceMeters: null,
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects negative nutrition in new meals", () => {
    const result = recordMealsInputSchema.safeParse({
      mode: "save",
      meals: [
        {
          occurredAt: null,
          summary: "Estorno",
          confidence: 1,
          items: [
            {
              name: "Ajuste",
              quantity: 1,
              unit: "registro",
              caloriesKcal: -500,
              proteinGrams: null,
              carbsGrams: null,
              fatGrams: null,
              confidence: 1,
              nutritionSource: "user_provided",
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("keeps meals out of the general event recorder", () => {
    const result = recordEventsInputSchema.safeParse({
      events: [
        {
          kind: "meal",
          occurredAt: null,
          summary: "Almoço",
          confidence: 1,
          items: [],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts explicit meal deletion by queried reference", () => {
    expect(
      deleteMealsInputSchema.safeParse({
        mealRefs: [crypto.randomUUID(), crypto.randomUUID()],
        reason: "duplicado",
      }).success,
    ).toBe(true);
  });

  it("rejects negative nutrition in meal corrections", () => {
    const result = manageRecordsInputSchema.safeParse({
      changes: [
        {
          action: "update_meal_item",
          itemRef: crypto.randomUUID(),
          caloriesKcal: -100,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts compact pending meal patches", () => {
    expect(
      pendingMealActionSchema.parse({
        action: "edit",
        changes: [{ type: "update_item", eventIndex: 0, itemIndex: 1, quantity: 2 }],
        saveNow: true,
      }),
    ).toEqual({
      action: "edit",
      changes: [{ type: "update_item", eventIndex: 0, itemIndex: 1, quantity: 2 }],
      saveNow: true,
    });
  });

  it("sends compact JSON Schema while preserving Zod validation", async () => {
    const schema = compactToolSchema(mealQuerySchema);
    const serialized = JSON.stringify(await schema.jsonSchema);

    expect(serialized).not.toContain('"default"');
    expect(serialized).not.toContain('"pattern"');
    expect(serialized).not.toContain(String(Number.MAX_SAFE_INTEGER));
    expect(serialized.length).toBeLessThan(2_000);
    expect(
      await schema.validate?.({
        range: { startDate: "not-a-date", endDate: "2026-08-23" },
      }),
    ).toMatchObject({ success: false });
    expect(
      await schema.validate?.({
        range: { startDate: "2026-08-23", endDate: "2026-08-23" },
      }),
    ).toMatchObject({
      success: true,
      value: { detail: "compact", compare: "none", limit: 20, offset: 0 },
    });
  });

  it("keeps the meal recorder smaller than the former event union", async () => {
    const serialized = JSON.stringify(await compactToolSchema(recordMealsInputSchema).jsonSchema);

    expect(serialized.length).toBeLessThan(2_500);
  });

  it("keeps every deferred tool schema independently bounded", async () => {
    const schemas = [
      recordEventsInputSchema,
      recordMealsInputSchema,
      deleteMealsInputSchema,
      mealQuerySchema,
      trainingQuerySchema,
      measurementQuerySchema,
      timelineQuerySchema,
      manageRecordsInputSchema,
      pendingMealActionSchema,
      updateSoulInputSchema,
    ];
    const lengths = await Promise.all(
      schemas.map(
        async (schema) => JSON.stringify(await compactToolSchema(schema).jsonSchema).length,
      ),
    );

    expect(Math.max(...lengths)).toBeLessThan(4_500);
  });
});
