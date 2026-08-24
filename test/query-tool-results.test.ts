import { describe, expect, it } from "vitest";

import {
  mealQueryToolResult,
  measurementQueryToolResult,
  timelineQueryToolResult,
  trainingQueryToolResult,
} from "../src/agent/query-tool-results";

const completeNutrition = {
  caloriesKcal: 620,
  proteinGrams: 48,
  carbsGrams: 61,
  fatGrams: 17,
  complete: { calories: true, protein: true, carbs: true, fat: true },
};
const completePage = {
  total: 1,
  offset: 0,
  limit: 20,
  returned: 1,
  hasMore: false,
  nextOffset: null,
};

describe("query tool results", () => {
  it("keeps compact meal meaning without query echoes or correction references", () => {
    const result = mealQueryToolResult({
      range: { startDate: "2026-08-23", endDate: "2026-08-23" },
      detail: "compact",
      totals: completeNutrition,
      mealCount: 1,
      dailyAverageCalories: 620,
      days: [{ date: "2026-08-23", totals: completeNutrition }],
      meals: [
        {
          ref: "event-ref",
          occurredAt: new Date("2026-08-23T15:30:00Z"),
          summary: "Frango com arroz",
          confidence: 1,
          totals: completeNutrition,
          itemNames: ["Frango", "Arroz"],
        },
      ],
      comparison: null,
      page: completePage,
    } as Parameters<typeof mealQueryToolResult>[0]);

    expect(result).toMatchObject({
      summary: { mealCount: 1, dailyAverageCalories: 620 },
      mealFields: ["occurredAt", "summary", "totals", "itemNames"],
      meals: [["2026-08-23 12:30", "Frango com arroz", completeNutrition, ["Frango", "Arroz"]]],
    });
    expect(result).not.toHaveProperty("range");
    expect(result).not.toHaveProperty("days");
    expect(result).not.toHaveProperty("itemFields");
    expect(result).not.toHaveProperty("nextOffset");
    expect(JSON.stringify(result)).not.toContain("event-ref");
  });

  it("keeps references and field headers for full meal correction data", () => {
    const result = mealQueryToolResult({
      range: { startDate: "2026-08-23", endDate: "2026-08-23" },
      detail: "full",
      totals: completeNutrition,
      mealCount: 1,
      dailyAverageCalories: 620,
      days: [{ date: "2026-08-23", totals: completeNutrition }],
      meals: [
        {
          ref: "event-ref",
          occurredAt: new Date("2026-08-23T15:30:00Z"),
          summary: "Frango com arroz",
          confidence: 1,
          totals: completeNutrition,
          itemNames: ["Frango"],
          items: [
            {
              ref: "item-ref",
              name: "Frango",
              quantity: 180,
              unit: "g",
              caloriesKcal: 300,
              proteinGrams: 45,
              carbsGrams: 0,
              fatGrams: 10,
              confidence: 0.9,
              nutritionSource: "estimated",
            },
          ],
        },
      ],
      comparison: null,
      page: { ...completePage, total: 2, hasMore: true, nextOffset: 20 },
    } as Parameters<typeof mealQueryToolResult>[0]);

    expect(result.meals[0]).toContain("event-ref");
    expect(JSON.stringify(result.meals[0])).toContain("item-ref");
    expect(result).toHaveProperty("itemFields");
    expect(result).toHaveProperty("nextOffset", 20);
  });

  it("uses the same column policy for training and only exposes set refs in full", () => {
    const exercise = {
      exercise: "Bench Press",
      sets: 3,
      totalReps: 24,
      maxWeightKg: 80,
      volumeKg: 1920,
      distanceMeters: 0,
      durationSeconds: 0,
    };
    const base = {
      range: { startDate: "2026-08-01", endDate: "2026-08-23" },
      filters: [],
      summary: {
        sessions: 1,
        workouts: 1,
        runs: 0,
        setRows: 3,
        totalReps: 24,
        volumeKg: 1920,
        distanceMeters: 0,
        durationSeconds: 0,
        exercises: [exercise],
      },
      sessions: [
        {
          ref: "session-ref",
          kind: "workout" as const,
          occurredAt: new Date("2026-08-23T15:30:00Z"),
          summary: "Peito",
          exercises: [exercise],
          sets: [
            {
              ref: "set-ref",
              exercise: "Bench Press",
              originalName: "supino",
              setNumber: 1,
              reps: 8,
              weightKg: 80,
              durationSeconds: null,
              distanceMeters: null,
            },
          ],
        },
      ],
      comparison: null,
      page: completePage,
    };

    const compact = trainingQueryToolResult({
      ...base,
      detail: "compact",
    } as Parameters<typeof trainingQueryToolResult>[0]);
    const full = trainingQueryToolResult({
      ...base,
      detail: "full",
    } as Parameters<typeof trainingQueryToolResult>[0]);

    expect(JSON.stringify(compact)).not.toContain("session-ref");
    expect(JSON.stringify(compact)).not.toContain("set-ref");
    expect(full).toHaveProperty("setFields");
    expect(JSON.stringify(full)).toContain("set-ref");
  });

  it("returns measurement rows only in full and compacts timeline zero counts", () => {
    const measurementBase = {
      range: { startDate: "2026-08-01", endDate: "2026-08-23" },
      summary: [
        {
          metric: "weight",
          count: 2,
          first: { value: 80, unit: "kg", occurredAt: new Date("2026-08-01T12:00:00Z") },
          latest: { value: 79, unit: "kg", occurredAt: new Date("2026-08-23T12:00:00Z") },
          change: -1,
        },
      ],
      records: [
        {
          ref: "event-ref",
          measurementRef: "measurement-ref",
          occurredAt: new Date("2026-08-23T12:00:00Z"),
          summary: "Peso 79 kg",
          metric: "weight",
          value: 79,
          unit: "kg",
        },
      ],
      comparison: null,
      page: completePage,
    };
    const compact = measurementQueryToolResult({
      ...measurementBase,
      detail: "compact",
    } as Parameters<typeof measurementQueryToolResult>[0]);
    const full = measurementQueryToolResult({
      ...measurementBase,
      detail: "full",
    } as Parameters<typeof measurementQueryToolResult>[0]);

    expect(compact).not.toHaveProperty("records");
    expect(full).toHaveProperty("records");

    const timeline = timelineQueryToolResult(
      {
        range: { startDate: "2026-08-23", endDate: "2026-08-23" },
        records: [
          {
            ref: "event-ref",
            kind: "meal",
            occurredAt: new Date("2026-08-23T15:30:00Z"),
            summary: "Almoço",
          },
        ],
        counts: { meal: 1, workout: 0, run: 0, measurement: 0, note: 0 },
        page: completePage,
      } as Parameters<typeof timelineQueryToolResult>[0],
      "compact",
    );
    expect(timeline.counts).toEqual({ meal: 1 });
    expect(JSON.stringify(timeline)).not.toContain("event-ref");
  });
});
