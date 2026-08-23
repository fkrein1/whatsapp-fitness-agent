import { describe, expect, it } from "vitest";

import {
  logEventsInputSchema,
  manageRecordsInputSchema,
  pendingMealActionSchema,
} from "../src/agent/fitness-tool-schemas";

describe("fitness tool schemas", () => {
  it("rejects negative nutrition in new meals", () => {
    const result = logEventsInputSchema.safeParse({
      events: [
        {
          kind: "meal",
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
});
