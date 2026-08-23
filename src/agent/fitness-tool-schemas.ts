import { z } from "zod";

import {
  extractedExerciseSetSchema,
  extractedMealItemSchema,
  extractedMeasurementSchema,
} from "../ingestion/types";

export const dateRangeSchema = z
  .object({
    startDate: z
      .string()
      .date()
      .describe("Inclusive first calendar date in America/Sao_Paulo, formatted YYYY-MM-DD."),
    endDate: z
      .string()
      .date()
      .describe("Inclusive last calendar date in America/Sao_Paulo, formatted YYYY-MM-DD."),
  })
  .refine((range) => range.startDate <= range.endDate, {
    message: "startDate must be on or before endDate",
  });

export const queryOptionsSchema = z.object({
  range: dateRangeSchema.describe(
    "Date range inferred from the user's words and the trusted current timestamp.",
  ),
  detail: z
    .enum(["compact", "full"])
    .default("compact")
    .describe(
      "Use compact for normal WhatsApp summaries. Use full when the user asks for breakdowns, items, sets, sources, or every data point.",
    ),
  compare: z
    .enum(["none", "previous_period"])
    .default("none")
    .describe("Use previous_period only when the user asks for change, progress, or comparison."),
  limit: z.number().int().min(1).max(50).default(20).describe("Maximum records in this page."),
  offset: z.number().int().min(0).default(0).describe("Zero-based record offset for pagination."),
});

const eventBase = {
  occurredAt: z
    .string()
    .datetime()
    .nullable()
    .default(null)
    .describe("When it happened. Use null to use the current WhatsApp message timestamp."),
  summary: z.string().min(1).describe("Short factual summary in Portuguese."),
  confidence: z.number().min(0).max(1).default(1),
};

const mealEventSchema = z.object({
  kind: z.literal("meal"),
  ...eventBase,
  items: z.array(extractedMealItemSchema).min(1).describe("Foods or drinks in this meal."),
});

export const proposeMealInputSchema = z.object({
  events: z
    .array(mealEventSchema)
    .min(1)
    .describe("Refeições identificadas na foto que devem ficar disponíveis para salvar depois."),
});

const workoutEventSchema = z.object({
  kind: z.literal("workout"),
  ...eventBase,
  sets: z
    .array(extractedExerciseSetSchema)
    .min(1)
    .describe("Individual exercise sets. Exercise names are normalized during persistence."),
});

const runEventSchema = z.object({
  kind: z.literal("run"),
  ...eventBase,
  distanceMeters: z.number().finite().nonnegative().nullable().default(null),
  durationSeconds: z.number().int().nonnegative().nullable().default(null),
});

const measurementEventSchema = z.object({
  kind: z.literal("measurement"),
  ...eventBase,
  measurements: z.array(extractedMeasurementSchema).min(1),
});

const noteEventSchema = z.object({
  kind: z.literal("note"),
  ...eventBase,
});

export const logEventsInputSchema = z.object({
  events: z
    .array(
      z.discriminatedUnion("kind", [
        mealEventSchema,
        workoutEventSchema,
        runEventSchema,
        measurementEventSchema,
        noteEventSchema,
      ]),
    )
    .min(1)
    .describe("Every distinct record requested in the current message burst."),
});

export const mealQuerySchema = queryOptionsSchema;

export const trainingQuerySchema = queryOptionsSchema.extend({
  exercises: z
    .array(z.string().min(1))
    .max(10)
    .default([])
    .describe("Canonical names or natural aliases to filter. Empty means all exercises and runs."),
});

export const measurementQuerySchema = queryOptionsSchema.extend({
  metrics: z
    .array(z.enum(["weight", "body_fat", "waist", "other"]))
    .default([])
    .describe("Measurement types to include. Empty means every type."),
});

export const timelineQuerySchema = queryOptionsSchema.omit({ compare: true }).extend({
  kinds: z
    .array(z.enum(["meal", "workout", "run", "measurement", "note"]))
    .default([])
    .describe("Record types to include. Empty means every type."),
  search: z
    .string()
    .max(100)
    .nullable()
    .default(null)
    .describe("Optional words that should occur in the record summary."),
});

const updateEventActionSchema = z.object({
  action: z.literal("update_event"),
  eventRef: z.string().uuid().describe("Event reference returned by a query tool."),
  occurredAt: z
    .string()
    .datetime()
    .optional()
    .describe("Replacement timestamp when correcting date or time."),
  summary: z.string().min(1).optional().describe("Replacement summary."),
});

const updateMealItemActionSchema = z.object({
  action: z.literal("update_meal_item"),
  itemRef: z.string().uuid().describe("Meal-item reference returned by a full meal query."),
  name: z.string().min(1).optional(),
  quantity: z.number().finite().nonnegative().nullable().optional(),
  unit: z.string().nullable().optional(),
  caloriesKcal: z.number().finite().nonnegative().nullable().optional(),
  proteinGrams: z.number().finite().nonnegative().nullable().optional(),
  carbsGrams: z.number().finite().nonnegative().nullable().optional(),
  fatGrams: z.number().finite().nonnegative().nullable().optional(),
});

const updateExerciseSetActionSchema = z.object({
  action: z.literal("update_exercise_set"),
  setRef: z.string().uuid().describe("Set reference returned by a full training query."),
  exercise: z
    .string()
    .min(1)
    .optional()
    .describe("Corrected exercise name. It is resolved through the exercise catalog."),
  reps: z.number().int().nonnegative().nullable().optional(),
  weightKg: z.number().finite().nonnegative().nullable().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
  distanceMeters: z.number().finite().nonnegative().nullable().optional(),
});

const updateMeasurementActionSchema = z.object({
  action: z.literal("update_measurement"),
  measurementRef: z
    .string()
    .uuid()
    .describe("Measurement reference returned by a full measurement query."),
  value: z.number().finite().optional(),
  unit: z.string().min(1).optional(),
});

const deleteEventActionSchema = z.object({
  action: z.literal("delete_event"),
  eventRef: z.string().uuid().describe("Event reference returned by a query tool."),
  reason: z
    .string()
    .min(1)
    .max(200)
    .describe("User's reason, such as duplicate or logged by mistake."),
});

export const manageRecordsInputSchema = z.object({
  changes: z
    .array(
      z.discriminatedUnion("action", [
        updateEventActionSchema,
        updateMealItemActionSchema,
        updateExerciseSetActionSchema,
        updateMeasurementActionSchema,
        deleteEventActionSchema,
      ]),
    )
    .min(1)
    .max(20)
    .describe("Unambiguous corrections explicitly requested by the user."),
});

export const pendingMealActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save") }),
  z.object({
    action: z.literal("edit"),
    events: z.array(mealEventSchema).min(1),
    saveNow: z.boolean().default(false),
  }),
  z.object({ action: z.literal("discard") }),
]);

export type QueryOptions = z.infer<typeof queryOptionsSchema>;
export type MealQuery = z.infer<typeof mealQuerySchema>;
export type TrainingQuery = z.infer<typeof trainingQuerySchema>;
export type MeasurementQuery = z.infer<typeof measurementQuerySchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type ManageRecordsInput = z.infer<typeof manageRecordsInputSchema>;
export type LogEventsInput = z.infer<typeof logEventsInputSchema>;
