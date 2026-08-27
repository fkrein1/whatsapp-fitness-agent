import { jsonSchema, type Schema } from "ai";
import { z } from "zod";

import {
  extractedExerciseSetSchema,
  extractedMealItemSchema,
  extractedMeasurementSchema,
} from "../ingestion/types";

const isoDateTimeSchema = z.string().datetime({ offset: true });

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
    .datetime({ offset: true })
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

const recordableEventSchema = z.discriminatedUnion("kind", [
  workoutEventSchema,
  runEventSchema,
  measurementEventSchema,
  noteEventSchema,
]);

export const recordMealsInputSchema = z.object({
  mode: z
    .enum(["save", "draft"])
    .describe("save writes meals now; draft keeps photographed meals pending."),
  meals: z
    .array(mealEventSchema.omit({ kind: true }))
    .min(1)
    .describe("Every distinct meal requested or identified in the current message batch."),
});

export const recordEventsInputSchema = z.object({
  events: z
    .array(recordableEventSchema)
    .min(1)
    .describe("Every workout, run, measurement, or note requested in the current message batch."),
});

export const mealQuerySchema = queryOptionsSchema;

export const deleteMealsInputSchema = z.object({
  mealRefs: z
    .array(z.string().uuid())
    .min(1)
    .max(20)
    .describe("Meal references returned by query_meals with detail full."),
  reason: z
    .string()
    .min(1)
    .max(200)
    .describe("User's reason, such as duplicate or logged by mistake."),
});

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
    .datetime({ offset: true })
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

const replaceWorkoutActionSchema = z.object({
  action: z.literal("replace_workout"),
  eventRef: z.string().uuid().describe("Workout reference returned by a full training query."),
  occurredAt: isoDateTimeSchema.optional().describe("Replacement timestamp, when requested."),
  summary: z.string().min(1).optional().describe("Replacement workout summary."),
  sets: z
    .array(extractedExerciseSetSchema)
    .min(1)
    .max(100)
    .describe("Complete replacement set list for this workout, including unchanged sets."),
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
        replaceWorkoutActionSchema,
        updateMeasurementActionSchema,
        deleteEventActionSchema,
      ]),
    )
    .min(1)
    .max(20)
    .describe("Unambiguous corrections explicitly requested by the user."),
});

const pendingMealChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("update_item"),
    eventIndex: z.number().int().nonnegative(),
    itemIndex: z.number().int().nonnegative(),
    name: z.string().min(1).optional(),
    quantity: z.number().finite().nonnegative().nullable().optional(),
    unit: z.string().nullable().optional(),
    caloriesKcal: z.number().finite().nonnegative().nullable().optional(),
    proteinGrams: z.number().finite().nonnegative().nullable().optional(),
    carbsGrams: z.number().finite().nonnegative().nullable().optional(),
    fatGrams: z.number().finite().nonnegative().nullable().optional(),
  }),
  z.object({
    type: z.literal("add_item"),
    eventIndex: z.number().int().nonnegative(),
    item: extractedMealItemSchema,
  }),
  z.object({
    type: z.literal("remove_item"),
    eventIndex: z.number().int().nonnegative(),
    itemIndex: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("update_meal"),
    eventIndex: z.number().int().nonnegative(),
    occurredAt: isoDateTimeSchema.nullable().optional(),
    summary: z.string().min(1).optional(),
  }),
]);

export const pendingMealActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save") }),
  z.object({
    action: z.literal("edit"),
    changes: z
      .array(pendingMealChangeSchema)
      .min(1)
      .max(20)
      .describe(
        "Only the requested changes, using the event and item indexes in the draft summary.",
      ),
    saveNow: z.boolean().default(false),
  }),
  z.object({ action: z.literal("discard") }),
]);

export const updateSoulInputSchema = z.object({
  content: z
    .string()
    .min(40)
    .max(12_000)
    .describe(
      "The complete replacement Soul document in Markdown. Preserve every unchanged fact and preference from the current Soul.",
    ),
  reason: z
    .string()
    .min(1)
    .max(200)
    .describe("Concise explanation of what the person asked to add, change, or forget."),
});

export function compactToolSchema<T extends z.ZodType>(schema: T): Schema<z.output<T>> {
  return jsonSchema<z.output<T>>(() => smallestJsonSchema(schema), {
    validate: (value) => {
      const result = schema.safeParse(value);
      return result.success
        ? { success: true, value: result.data }
        : { success: false, error: result.error };
    },
  });
}

function smallestJsonSchema(schema: z.ZodType) {
  const candidates = [
    compactJsonSchema(z.toJSONSchema(schema, { reused: "inline" })),
    compactJsonSchema(z.toJSONSchema(schema, { reused: "ref" })),
  ];
  return candidates.reduce((smallest, candidate) =>
    JSON.stringify(candidate).length < JSON.stringify(smallest).length ? candidate : smallest,
  );
}

function compactJsonSchema(value: unknown): Record<string, unknown> {
  const compact = compactJsonValue(value);
  if (!isJsonObject(compact)) throw new Error("Tool schema must be a JSON object");
  delete compact.$schema;
  return compact;
}

function compactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactJsonValue);
  if (!isJsonObject(value)) return value;

  const compact = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, compactJsonValue(child)]),
  );
  delete compact.default;
  delete compact.pattern;
  if (compact.maximum === Number.MAX_SAFE_INTEGER) delete compact.maximum;
  if (compact.minimum === Number.MIN_SAFE_INTEGER) delete compact.minimum;
  return compact;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type QueryOptions = z.infer<typeof queryOptionsSchema>;
export type MealQuery = z.infer<typeof mealQuerySchema>;
export type DeleteMealsInput = z.infer<typeof deleteMealsInputSchema>;
export type TrainingQuery = z.infer<typeof trainingQuerySchema>;
export type MeasurementQuery = z.infer<typeof measurementQuerySchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type ManageRecordsInput = z.infer<typeof manageRecordsInputSchema>;
export type RecordMealsInput = z.infer<typeof recordMealsInputSchema>;
export type RecordEventsInput = z.infer<typeof recordEventsInputSchema>;
export type PendingMealAction = z.infer<typeof pendingMealActionSchema>;
