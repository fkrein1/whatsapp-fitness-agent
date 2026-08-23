import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { IngestionResult } from "../ingestion/types";

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
    status: text("status", { enum: ["received", "processing", "processed", "partial", "failed"] })
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

export const agentTurnEvents = sqliteTable(
  "agent_turn_events",
  {
    id: text("id").primaryKey(),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => sourceMessages.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    details: text("details", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("agent_turn_events_source_created_at_idx").on(table.sourceMessageId, table.createdAt),
  ],
);

export const agentSouls = sqliteTable("agent_souls", {
  senderId: text("sender_id").primaryKey(),
  content: text("content").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const agentSoulChanges = sqliteTable(
  "agent_soul_changes",
  {
    id: text("id").primaryKey(),
    senderId: text("sender_id").notNull(),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => sourceMessages.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    before: text("before").notNull(),
    after: text("after").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("agent_soul_changes_sender_revision_idx").on(table.senderId, table.revision),
    index("agent_soul_changes_source_message_id_idx").on(table.sourceMessageId),
  ],
);

export const mealProposals = sqliteTable(
  "meal_proposals",
  {
    id: text("id").primaryKey(),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => sourceMessages.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull(),
    payload: text("payload", { mode: "json" }).$type<IngestionResult>().notNull(),
    status: text("status", { enum: ["pending", "approved", "cancelled"] })
      .notNull()
      .default("pending"),
    resolutionSourceMessageId: text("resolution_source_message_id").references(
      () => sourceMessages.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("meal_proposals_source_message_id_uq").on(table.sourceMessageId),
    index("meal_proposals_sender_status_created_at_idx").on(
      table.senderId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const fitnessEvents = sqliteTable(
  "fitness_events",
  {
    id: text("id").primaryKey(),
    externalKey: text("external_key").unique(),
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
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("fitness_events_kind_occurred_at_idx").on(table.kind, table.occurredAt),
    index("fitness_events_source_message_id_idx").on(table.sourceMessageId),
  ],
);

export const recordChanges = sqliteTable(
  "record_changes",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => fitnessEvents.id, { onDelete: "cascade" }),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => sourceMessages.id, { onDelete: "cascade" }),
    action: text("action", {
      enum: [
        "update_event",
        "update_meal_item",
        "update_exercise_set",
        "update_measurement",
        "delete_event",
      ],
    }).notNull(),
    before: text("before", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    after: text("after", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("record_changes_event_created_at_idx").on(table.eventId, table.createdAt),
    index("record_changes_source_message_id_idx").on(table.sourceMessageId),
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

export const exercises = sqliteTable(
  "exercises",
  {
    id: text("id").primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("exercises_canonical_name_uq").on(table.canonicalName),
    uniqueIndex("exercises_normalized_name_uq").on(table.normalizedName),
  ],
);

export const exerciseAliases = sqliteTable(
  "exercise_aliases",
  {
    id: text("id").primaryKey(),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("exercise_aliases_normalized_alias_uq").on(table.normalizedAlias),
    index("exercise_aliases_exercise_id_idx").on(table.exerciseId),
  ],
);

export const exerciseSets = sqliteTable(
  "exercise_sets",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => fitnessEvents.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    originalName: text("exercise").notNull(),
    setNumber: integer("set_number"),
    reps: integer("reps"),
    weightKg: real("weight_kg"),
    durationSeconds: integer("duration_seconds"),
    distanceMeters: real("distance_meters"),
  },
  (table) => [
    index("exercise_sets_event_id_idx").on(table.eventId),
    index("exercise_sets_exercise_id_idx").on(table.exerciseId),
  ],
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
