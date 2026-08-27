import { describe, expect, it } from "vitest";

import { applyPendingMealChanges, compactPendingMealContext } from "../src/agent/pending-meal";
import type { IngestionResult } from "../src/ingestion/types";

const pendingEvents: IngestionResult["events"] = [
  {
    kind: "meal",
    occurredAt: null,
    summary: "Iogurte com banana",
    confidence: 0.9,
    mealItems: [
      {
        name: "Iogurte Danone",
        quantity: 1,
        unit: "unidade",
        caloriesKcal: 120,
        proteinGrams: 6,
        carbsGrams: 15,
        fatGrams: 3,
        confidence: 0.95,
        nutritionSource: "rótulo",
      },
      {
        name: "Banana",
        quantity: 1,
        unit: "unidade",
        caloriesKcal: 90,
        proteinGrams: 1,
        carbsGrams: 23,
        fatGrams: 0.3,
        confidence: 0.8,
        nutritionSource: "estimativa",
      },
    ],
    exerciseSets: [],
    measurements: [],
  },
];

describe("pending meal context", () => {
  it("formats a compact indexed summary", () => {
    const context = compactPendingMealContext(pendingEvents, new Date("2026-08-22T17:05:00.000Z"));

    expect(context).toContain("m0.i0 | Iogurte Danone | 1 unidade | 120 kcal");
    expect(context).toContain("m0.i1 | Banana | 1 unidade | 90 kcal");
    expect(context).toContain("Total | 210 kcal; C 38 g; G 3,3 g; P 7 g");
    expect(context).not.toContain('"mealItems"');
  });

  it("patches one item and scales nutrition when only its quantity changes", () => {
    const updated = applyPendingMealChanges(pendingEvents, [
      { type: "update_item", eventIndex: 0, itemIndex: 0, quantity: 2 },
    ]);

    expect(updated[0]?.mealItems[0]).toEqual(
      expect.objectContaining({
        quantity: 2,
        caloriesKcal: 240,
        proteinGrams: 12,
        carbsGrams: 30,
        fatGrams: 6,
      }),
    );
    expect(updated[0]?.mealItems[1]).toEqual(pendingEvents[0]?.mealItems[1]);
    expect(pendingEvents[0]?.mealItems[0].quantity).toBe(1);
  });

  it("can remove an item and update the meal summary without replacing the draft", () => {
    const updated = applyPendingMealChanges(pendingEvents, [
      { type: "remove_item", eventIndex: 0, itemIndex: 1 },
      { type: "update_meal", eventIndex: 0, summary: "Dois iogurtes" },
      { type: "update_item", eventIndex: 0, itemIndex: 0, quantity: 2 },
    ]);

    expect(updated[0]?.summary).toBe("Dois iogurtes");
    expect(updated[0]?.mealItems).toHaveLength(1);
    expect(updated[0]?.mealItems[0].quantity).toBe(2);
  });

  it("keeps original item indexes stable across multiple changes", () => {
    const updated = applyPendingMealChanges(pendingEvents, [
      { type: "remove_item", eventIndex: 0, itemIndex: 0 },
      { type: "update_item", eventIndex: 0, itemIndex: 1, quantity: 2 },
    ]);

    expect(updated[0]?.mealItems).toEqual([
      expect.objectContaining({ name: "Banana", quantity: 2, caloriesKcal: 180 }),
    ]);
  });

  it("replaces a complete meal in one change", () => {
    const replacement = {
      ...pendingEvents[0]!.mealItems[1]!,
      name: "Almoço novo",
      quantity: 552,
      unit: "g",
    };
    const updated = applyPendingMealChanges(pendingEvents, [
      {
        type: "replace_meal",
        eventIndex: 0,
        summary: "Refeito do zero",
        items: [replacement],
      },
    ]);

    expect(updated[0]).toEqual(
      expect.objectContaining({
        summary: "Refeito do zero",
        mealItems: [replacement],
      }),
    );
  });

  it("rejects invalid pending indexes", () => {
    expect(() =>
      applyPendingMealChanges(pendingEvents, [
        { type: "remove_item", eventIndex: 0, itemIndex: 4 },
      ]),
    ).toThrow("m0.i4");
  });
});
