import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type FitnessEventKind = "meal" | "workout" | "run" | "measurement" | "note";
export type MessageInputType = "text" | "image" | "audio";

export const sourceMessages = sqliteTable(
  "source_messages",
  {
    id: text("id").primaryKey(),
    providerMessageId: text("provider_message_id").notNull(),
    senderId: text("sender_id").notNull(),
    inputType: text("input_type").$type<MessageInputType>().notNull(),
    text: text("text"),
    mediaId: text("media_id"),
    mimeType: text("mime_type"),
    status: text("status", { enum: ["received", "processed", "failed"] })
      .notNull()
      .default("received"),
    error: text("error"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("source_messages_provider_message_id_uq").on(table.providerMessageId),
    index("source_messages_received_at_idx").on(table.receivedAt),
  ],
);

export const fitnessEvents = sqliteTable(
  "fitness_events",
  {
    id: text("id").primaryKey(),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => sourceMessages.id, { onDelete: "cascade" }),
    kind: text("kind").$type<FitnessEventKind>().notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    summary: text("summary").notNull(),
    confidence: real("confidence").notNull(),
    details: text("details", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("fitness_events_kind_occurred_at_idx").on(table.kind, table.occurredAt),
    index("fitness_events_source_message_id_idx").on(table.sourceMessageId),
  ],
);

export const mealItems = sqliteTable(
  "meal_items",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => fitnessEvents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: real("quantity"),
    unit: text("unit"),
    caloriesKcal: real("calories_kcal"),
    proteinGrams: real("protein_grams"),
    carbsGrams: real("carbs_grams"),
    fatGrams: real("fat_grams"),
    confidence: real("confidence").notNull(),
    nutritionSource: text("nutrition_source").notNull().default("model_estimate"),
  },
  (table) => [index("meal_items_event_id_idx").on(table.eventId)],
);

export const exerciseSets = sqliteTable(
  "exercise_sets",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => fitnessEvents.id, { onDelete: "cascade" }),
    exercise: text("exercise").notNull(),
    setNumber: integer("set_number"),
    reps: integer("reps"),
    weightKg: real("weight_kg"),
    durationSeconds: integer("duration_seconds"),
    distanceMeters: real("distance_meters"),
  },
  (table) => [index("exercise_sets_event_id_idx").on(table.eventId)],
);

export const measurements = sqliteTable(
  "measurements",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => fitnessEvents.id, { onDelete: "cascade" }),
    metric: text("metric", { enum: ["weight", "body_fat", "waist", "other"] }).notNull(),
    value: real("value").notNull(),
    unit: text("unit").notNull(),
  },
  (table) => [index("measurements_metric_event_id_idx").on(table.metric, table.eventId)],
);
