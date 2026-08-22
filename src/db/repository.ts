import { and, eq, gte, lt, sql } from "drizzle-orm";

import type { IngestionResult } from "../ingestion/types";
import type { Database } from "./client";
import { exerciseSets, fitnessEvents, mealItems, measurements, sourceMessages } from "./schema";
import type { MessageInputType } from "./schema";

type SourceMessageInput = {
  providerMessageId: string;
  senderId: string;
  inputType: MessageInputType;
  text: string | null;
  mediaId: string | null;
  mimeType: string | null;
  receivedAt: Date;
};

export async function claimSourceMessage(db: Database, input: SourceMessageInput) {
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(sourceMessages)
    .values({ id, ...input })
    .onConflictDoNothing({ target: sourceMessages.providerMessageId })
    .returning({ id: sourceMessages.id });

  return inserted[0]?.id ?? null;
}

export async function saveIngestion(
  db: Database,
  sourceMessageId: string,
  result: IngestionResult,
  fallbackOccurredAt: Date,
) {
  for (const event of result.events) {
    const eventId = crypto.randomUUID();
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : fallbackOccurredAt;

    await db.insert(fitnessEvents).values({
      id: eventId,
      sourceMessageId,
      kind: event.kind,
      occurredAt,
      summary: event.summary,
      confidence: event.confidence,
      details: {},
      createdAt: new Date(),
    });

    if (event.mealItems.length) {
      await db.insert(mealItems).values(
        event.mealItems.map((item) => ({
          id: crypto.randomUUID(),
          eventId,
          ...item,
          nutritionSource: "model_estimate",
        })),
      );
    }

    if (event.exerciseSets.length) {
      await db
        .insert(exerciseSets)
        .values(event.exerciseSets.map((set) => ({ id: crypto.randomUUID(), eventId, ...set })));
    }

    if (event.measurements.length) {
      await db.insert(measurements).values(
        event.measurements.map((measurement) => ({
          id: crypto.randomUUID(),
          eventId,
          ...measurement,
        })),
      );
    }
  }

  await db
    .update(sourceMessages)
    .set({ status: "processed", processedAt: new Date(), error: null })
    .where(eq(sourceMessages.id, sourceMessageId));
}

export async function markSourceMessageFailed(db: Database, id: string, error: string) {
  await db
    .update(sourceMessages)
    .set({ status: "failed", processedAt: new Date(), error: error.slice(0, 500) })
    .where(eq(sourceMessages.id, id));
}

export async function getDailyCalories(db: Database, day: Date) {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const [row] = await db
    .select({ caloriesKcal: sql<number>`coalesce(sum(${mealItems.caloriesKcal}), 0)` })
    .from(mealItems)
    .innerJoin(fitnessEvents, eq(mealItems.eventId, fitnessEvents.id))
    .where(and(gte(fitnessEvents.occurredAt, start), lt(fitnessEvents.occurredAt, end)));

  return row?.caloriesKcal ?? 0;
}

export async function getRecentEvents(db: Database, kinds: string[], days: number) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);

  return db
    .select({
      kind: fitnessEvents.kind,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
    })
    .from(fitnessEvents)
    .where(
      and(
        sql`${fitnessEvents.kind} in (${sql.join(
          kinds.map((kind) => sql`${kind}`),
          sql`, `,
        )})`,
        gte(fitnessEvents.occurredAt, start),
      ),
    )
    .orderBy(sql`${fitnessEvents.occurredAt} desc`)
    .limit(50);
}

export async function getRecentWeights(db: Database, days: number) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);

  return db
    .select({
      occurredAt: fitnessEvents.occurredAt,
      value: measurements.value,
      unit: measurements.unit,
    })
    .from(measurements)
    .innerJoin(fitnessEvents, eq(measurements.eventId, fitnessEvents.id))
    .where(and(eq(measurements.metric, "weight"), gte(fitnessEvents.occurredAt, start)))
    .orderBy(sql`${fitnessEvents.occurredAt} desc`)
    .limit(50);
}
