import { z } from "zod";

const nullableNumber = z.number().finite().nullable();
const nullableNonnegativeNumber = z.number().finite().nonnegative().nullable();

export const extractedMealItemSchema = z.object({
  name: z.string().min(1),
  quantity: nullableNonnegativeNumber,
  unit: z.string().nullable(),
  caloriesKcal: nullableNonnegativeNumber,
  proteinGrams: nullableNonnegativeNumber,
  carbsGrams: nullableNonnegativeNumber,
  fatGrams: nullableNonnegativeNumber,
  confidence: z.number().min(0).max(1),
  nutritionSource: z.string().nullable(),
});

export const extractedExerciseSetSchema = z.object({
  exercise: z.string().min(1),
  setNumber: z.number().int().positive().nullable(),
  reps: z.number().int().nonnegative().nullable(),
  weightKg: nullableNumber,
  durationSeconds: z.number().int().nonnegative().nullable(),
  distanceMeters: nullableNumber,
});

export const extractedMeasurementSchema = z.object({
  metric: z.enum(["weight", "body_fat", "waist", "other"]),
  value: z.number().finite(),
  unit: z.string().min(1),
});

export const extractedEventSchema = z.object({
  kind: z.enum(["meal", "workout", "run", "measurement", "note"]),
  occurredAt: z.string().datetime().nullable(),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  mealItems: z.array(extractedMealItemSchema),
  exerciseSets: z.array(extractedExerciseSetSchema),
  measurements: z.array(extractedMeasurementSchema),
});

export const ingestionResultSchema = z.object({
  events: z.array(extractedEventSchema),
  query: z
    .object({
      type: z.enum(["daily_calories", "recent_exercise", "recent_weight"]),
      days: z.number().int().min(1).max(365),
    })
    .nullable(),
  reply: z.string().min(1),
});

export type IngestionResult = z.infer<typeof ingestionResultSchema>;
