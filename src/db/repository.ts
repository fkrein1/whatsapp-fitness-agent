import { and, desc, eq, gte, inArray, isNull, like, lt, or, sql } from "drizzle-orm";

import type {
  ManageRecordsInput,
  MealQuery,
  MeasurementQuery,
  TimelineQuery,
  TrainingQuery,
} from "../agent/fitness-tool-schemas";
import { cleanExerciseName, normalizeExerciseKey } from "../exercises/normalize";
import type { IngestionResult } from "../ingestion/types";
import type { Database } from "./client";
import {
  agentTurnEvents,
  exerciseAliases,
  exercises,
  exerciseSets,
  fitnessEvents,
  mealProposals,
  mealItems,
  measurements,
  recordChanges,
  sourceMessages,
} from "./schema";
import type { MessageInputType } from "./schema";

const D1_CHILD_INSERT_CHUNK_SIZE = 10;

function chunksOf<T>(values: T[]) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += D1_CHILD_INSERT_CHUNK_SIZE) {
    chunks.push(values.slice(index, index + D1_CHILD_INSERT_CHUNK_SIZE));
  }
  return chunks;
}

async function findExerciseByName(db: Database, name: string) {
  const normalizedName = normalizeExerciseKey(name);
  const [match] = await db
    .select({ id: exercises.id, canonicalName: exercises.canonicalName })
    .from(exerciseAliases)
    .innerJoin(exercises, eq(exerciseAliases.exerciseId, exercises.id))
    .where(eq(exerciseAliases.normalizedAlias, normalizedName))
    .limit(1);
  if (match) return match;

  const [canonicalMatch] = await db
    .select({ id: exercises.id, canonicalName: exercises.canonicalName })
    .from(exercises)
    .where(eq(exercises.normalizedName, normalizedName))
    .limit(1);
  return canonicalMatch ?? null;
}

export async function registerExercise(db: Database, name: string, existingExerciseId?: string) {
  const cleanedName = cleanExerciseName(name);
  const normalizedName = normalizeExerciseKey(cleanedName);
  const existingAlias = await findExerciseByName(db, cleanedName);
  if (existingAlias) return { ...existingAlias, created: false };

  let exercise: { id: string; canonicalName: string } | undefined;
  let created = false;
  if (existingExerciseId) {
    [exercise] = await db
      .select({ id: exercises.id, canonicalName: exercises.canonicalName })
      .from(exercises)
      .where(eq(exercises.id, existingExerciseId))
      .limit(1);
    if (!exercise) throw new Error(`Unknown exercise id: ${existingExerciseId}`);
  } else {
    const id = crypto.randomUUID();
    const inserted = await db
      .insert(exercises)
      .values({ id, canonicalName: cleanedName, normalizedName, createdAt: new Date() })
      .onConflictDoNothing({ target: exercises.normalizedName })
      .returning({ id: exercises.id, canonicalName: exercises.canonicalName });
    [exercise] = inserted.length
      ? inserted
      : await db
          .select({ id: exercises.id, canonicalName: exercises.canonicalName })
          .from(exercises)
          .where(eq(exercises.normalizedName, normalizedName))
          .limit(1);
    created = Boolean(inserted.length);
  }

  await db
    .insert(exerciseAliases)
    .values({
      id: crypto.randomUUID(),
      exerciseId: exercise.id,
      alias: cleanedName,
      normalizedAlias: normalizedName,
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: exerciseAliases.normalizedAlias });
  return { ...exercise, created };
}

function nameSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeExerciseKey(left).split(" "));
  const rightTokens = new Set(normalizeExerciseKey(right).split(" "));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / new Set([...leftTokens, ...rightTokens]).size;
}

export async function resolveExerciseNames(db: Database, names: string[]) {
  const catalog = await db
    .select({ id: exercises.id, canonicalName: exercises.canonicalName })
    .from(exercises)
    .orderBy(exercises.canonicalName);

  return Promise.all(
    [...new Set(names.map(cleanExerciseName))].map(async (name) => {
      const exact = await findExerciseByName(db, name);
      const candidates: { id: string; canonicalName: string; similarity: number }[] = [];
      if (!exact) {
        for (const exercise of catalog) {
          const candidate = {
            ...exercise,
            similarity: nameSimilarity(name, exercise.canonicalName),
          };
          if (!candidate.similarity) continue;
          const insertionIndex = candidates.findIndex(
            (existing) => existing.similarity < candidate.similarity,
          );
          candidates.splice(insertionIndex < 0 ? candidates.length : insertionIndex, 0, candidate);
          if (candidates.length > 3) candidates.pop();
        }
      }
      return { submittedName: name, exact, candidates };
    }),
  );
}

type SourceMessageInput = {
  providerMessageId: string;
  senderId: string;
  inputType: MessageInputType;
  text: string | null;
  mediaId: string | null;
  mimeType: string | null;
  receivedAt: Date;
};

export async function claimSourceMessage(
  db: Database,
  input: SourceMessageInput,
  id = crypto.randomUUID(),
) {
  const inserted = await db
    .insert(sourceMessages)
    .values({ id, ...input })
    .onConflictDoNothing({ target: sourceMessages.providerMessageId })
    .returning({ id: sourceMessages.id });

  return inserted[0]?.id ?? null;
}

export async function recordAgentTurnEvent(
  db: Database,
  sourceMessageId: string,
  stage: string,
  details: Record<string, unknown> = {},
) {
  const createdAt = new Date();
  await db.insert(agentTurnEvents).values({
    id: crypto.randomUUID(),
    sourceMessageId,
    stage,
    details,
    createdAt,
  });
  return createdAt;
}

export async function getAgentTurnEvents(db: Database, sourceMessageId: string) {
  return db
    .select({
      stage: agentTurnEvents.stage,
      details: agentTurnEvents.details,
      createdAt: agentTurnEvents.createdAt,
    })
    .from(agentTurnEvents)
    .where(eq(agentTurnEvents.sourceMessageId, sourceMessageId))
    .orderBy(agentTurnEvents.createdAt);
}

export async function createMealProposal(
  db: Database,
  sourceMessageId: string,
  senderId: string,
  payload: IngestionResult,
) {
  const now = new Date();
  await db
    .update(mealProposals)
    .set({ status: "cancelled", resolvedAt: now })
    .where(and(eq(mealProposals.senderId, senderId), eq(mealProposals.status, "pending")));

  const id = crypto.randomUUID();
  await db.insert(mealProposals).values({
    id,
    sourceMessageId,
    senderId,
    payload,
    status: "pending",
    createdAt: now,
  });
  await markSourceMessageProcessed(db, sourceMessageId);
  return id;
}

export async function getLatestPendingMealProposal(
  db: Database,
  senderId: string,
  now = new Date(),
) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [proposal] = await db
    .select({
      id: mealProposals.id,
      sourceMessageId: mealProposals.sourceMessageId,
      payload: mealProposals.payload,
      receivedAt: sourceMessages.receivedAt,
    })
    .from(mealProposals)
    .innerJoin(sourceMessages, eq(mealProposals.sourceMessageId, sourceMessages.id))
    .where(
      and(
        eq(mealProposals.senderId, senderId),
        eq(mealProposals.status, "pending"),
        gte(mealProposals.createdAt, cutoff),
      ),
    )
    .orderBy(desc(mealProposals.createdAt))
    .limit(1);
  return proposal ?? null;
}

export async function updateLatestMealProposal(
  db: Database,
  senderId: string,
  events: IngestionResult["events"],
  now = new Date(),
) {
  const proposal = await getLatestPendingMealProposal(db, senderId, now);
  if (!proposal) return null;
  const payload: IngestionResult = {
    ...proposal.payload,
    events,
    query: null,
    reply: "Proposta de refeição atualizada.",
  };
  const [updated] = await db
    .update(mealProposals)
    .set({ payload })
    .where(and(eq(mealProposals.id, proposal.id), eq(mealProposals.status, "pending")))
    .returning({ id: mealProposals.id });
  return updated ? payload : null;
}

export async function approveLatestMealProposal(
  db: Database,
  senderId: string,
  resolutionSourceMessageId: string,
  now = new Date(),
) {
  const proposal = await getLatestPendingMealProposal(db, senderId, now);
  if (!proposal) return null;

  const [claimed] = await db
    .update(mealProposals)
    .set({ status: "approved", resolutionSourceMessageId, resolvedAt: now })
    .where(and(eq(mealProposals.id, proposal.id), eq(mealProposals.status, "pending")))
    .returning({ id: mealProposals.id });
  if (!claimed) return null;

  try {
    const result = await saveIngestion(db, proposal.sourceMessageId, proposal.payload, now, {
      externalKeyPrefix: proposal.sourceMessageId,
    });
    await markSourceMessageProcessed(db, resolutionSourceMessageId);
    return { ...result, payload: proposal.payload };
  } catch (error) {
    await db
      .update(mealProposals)
      .set({
        status: "pending",
        resolutionSourceMessageId: null,
        resolvedAt: null,
      })
      .where(eq(mealProposals.id, proposal.id));
    throw error;
  }
}

export async function cancelLatestMealProposal(
  db: Database,
  senderId: string,
  resolutionSourceMessageId: string,
  now = new Date(),
) {
  const proposal = await getLatestPendingMealProposal(db, senderId, now);
  if (!proposal) return false;
  const [cancelled] = await db
    .update(mealProposals)
    .set({ status: "cancelled", resolutionSourceMessageId, resolvedAt: now })
    .where(and(eq(mealProposals.id, proposal.id), eq(mealProposals.status, "pending")))
    .returning({ id: mealProposals.id });
  if (!cancelled) return false;
  await markSourceMessageProcessed(db, resolutionSourceMessageId);
  return true;
}

export async function saveIngestion(
  db: Database,
  sourceMessageId: string,
  result: IngestionResult,
  fallbackOccurredAt: Date,
  options: {
    externalKeyPrefix?: string;
    finalize?: boolean;
  } = {},
) {
  let insertedEvents = 0;
  let reusedEvents = 0;
  for (const [eventIndex, event] of result.events.entries()) {
    const newEventId = crypto.randomUUID();
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : fallbackOccurredAt;
    const externalKey = options.externalKeyPrefix
      ? `${options.externalKeyPrefix}:${eventIndex}`
      : null;
    const eventValues = {
      id: newEventId,
      externalKey,
      sourceMessageId,
      kind: event.kind,
      occurredAt,
      summary: event.summary,
      confidence: event.confidence,
      details: {},
      createdAt: new Date(),
    };

    const insertedEvent = externalKey
      ? await db
          .insert(fitnessEvents)
          .values(eventValues)
          .onConflictDoNothing({ target: fitnessEvents.externalKey })
          .returning({ id: fitnessEvents.id })
      : await db.insert(fitnessEvents).values(eventValues).returning({ id: fitnessEvents.id });
    const [savedEvent] = insertedEvent.length
      ? insertedEvent
      : await db
          .select({ id: fitnessEvents.id })
          .from(fitnessEvents)
          .where(eq(fitnessEvents.externalKey, externalKey!))
          .limit(1);
    const eventId = savedEvent.id;
    if (insertedEvent.length) insertedEvents += 1;
    else reusedEvents += 1;

    if (externalKey) {
      await db
        .update(fitnessEvents)
        .set({
          kind: event.kind,
          occurredAt,
          summary: event.summary,
          confidence: event.confidence,
          details: {},
          updatedAt: new Date(),
          deletedAt: null,
        })
        .where(eq(fitnessEvents.id, eventId));
      await db.delete(mealItems).where(eq(mealItems.eventId, eventId));
      await db.delete(exerciseSets).where(eq(exerciseSets.eventId, eventId));
      await db.delete(measurements).where(eq(measurements.eventId, eventId));
    }

    if (event.mealItems.length) {
      const values = event.mealItems.map((item) => ({
        id: crypto.randomUUID(),
        eventId,
        ...item,
        nutritionSource: item.nutritionSource ?? "model_estimate",
      }));
      for (const chunk of chunksOf(values)) await db.insert(mealItems).values(chunk);
    }

    if (event.exerciseSets.length) {
      const values: (typeof exerciseSets.$inferInsert)[] = [];
      for (const set of event.exerciseSets) {
        const exercise = await registerExercise(db, set.exercise);
        values.push({
          id: crypto.randomUUID(),
          eventId,
          exerciseId: exercise.id,
          originalName: cleanExerciseName(set.exercise),
          setNumber: set.setNumber,
          reps: set.reps,
          weightKg: set.weightKg,
          durationSeconds: set.durationSeconds,
          distanceMeters: set.distanceMeters,
        });
      }
      for (const chunk of chunksOf(values)) await db.insert(exerciseSets).values(chunk);
    }

    if (event.measurements.length) {
      const values = event.measurements.map((measurement) => ({
        id: crypto.randomUUID(),
        eventId,
        ...measurement,
      }));
      for (const chunk of chunksOf(values)) await db.insert(measurements).values(chunk);
    }
  }

  if (options.finalize ?? true) await markSourceMessageProcessed(db, sourceMessageId);
  return { insertedEvents, reusedEvents };
}

export async function markSourceMessageProcessing(db: Database, id: string) {
  await db
    .update(sourceMessages)
    .set({ status: "processing", error: null })
    .where(eq(sourceMessages.id, id));
}

export async function markSourceMessageProcessed(db: Database, id: string) {
  await db
    .update(sourceMessages)
    .set({ status: "processed", processedAt: new Date(), error: null })
    .where(eq(sourceMessages.id, id));
}

export async function markSourceMessagePartial(db: Database, id: string, error: string) {
  await db
    .update(sourceMessages)
    .set({ status: "partial", processedAt: new Date(), error: error.slice(0, 500) })
    .where(eq(sourceMessages.id, id));
}

export async function markSourceMessageFailed(db: Database, id: string, error: string) {
  await db
    .update(sourceMessages)
    .set({ status: "failed", processedAt: new Date(), error: error.slice(0, 500) })
    .where(eq(sourceMessages.id, id));
}

export async function getSourceMessageStatus(db: Database, id: string) {
  const [message] = await db
    .select({ status: sourceMessages.status, error: sourceMessages.error })
    .from(sourceMessages)
    .where(eq(sourceMessages.id, id))
    .limit(1);
  return message ?? null;
}

export async function getDailyCalories(db: Database, day: Date, timeZone = "America/Sao_Paulo") {
  const { start, end } = getDayRange(day, timeZone);

  const [row] = await db
    .select({ caloriesKcal: sql<number>`coalesce(sum(${mealItems.caloriesKcal}), 0)` })
    .from(mealItems)
    .innerJoin(fitnessEvents, eq(mealItems.eventId, fitnessEvents.id))
    .where(
      and(
        gte(fitnessEvents.occurredAt, start),
        lt(fitnessEvents.occurredAt, end),
        isNull(fitnessEvents.deletedAt),
      ),
    );

  return row?.caloriesKcal ?? 0;
}

export async function getDailyMeals(db: Database, day: Date, timeZone = "America/Sao_Paulo") {
  const { localDate, start, end } = getDayRange(day, timeZone);
  const events = await db
    .select({
      id: fitnessEvents.id,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
      confidence: fitnessEvents.confidence,
    })
    .from(fitnessEvents)
    .where(
      and(
        eq(fitnessEvents.kind, "meal"),
        gte(fitnessEvents.occurredAt, start),
        lt(fitnessEvents.occurredAt, end),
        isNull(fitnessEvents.deletedAt),
      ),
    )
    .orderBy(fitnessEvents.occurredAt)
    .limit(50);

  if (!events.length) {
    return {
      date: localDate,
      meals: [],
      totals: emptyNutritionTotals(),
    };
  }

  const items = await db
    .select({
      eventId: mealItems.eventId,
      name: mealItems.name,
      quantity: mealItems.quantity,
      unit: mealItems.unit,
      caloriesKcal: mealItems.caloriesKcal,
      proteinGrams: mealItems.proteinGrams,
      carbsGrams: mealItems.carbsGrams,
      fatGrams: mealItems.fatGrams,
      confidence: mealItems.confidence,
      nutritionSource: mealItems.nutritionSource,
    })
    .from(mealItems)
    .where(
      inArray(
        mealItems.eventId,
        events.map((event) => event.id),
      ),
    );

  const itemsByEvent = new Map<string, typeof items>();
  for (const item of items) {
    const eventItems = itemsByEvent.get(item.eventId) ?? [];
    eventItems.push(item);
    itemsByEvent.set(item.eventId, eventItems);
  }

  return {
    date: localDate,
    meals: events.map((event) => {
      const eventItems = (itemsByEvent.get(event.id) ?? []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        caloriesKcal: item.caloriesKcal,
        proteinGrams: item.proteinGrams,
        carbsGrams: item.carbsGrams,
        fatGrams: item.fatGrams,
        confidence: item.confidence,
        nutritionSource: item.nutritionSource,
      }));
      return {
        occurredAt: event.occurredAt,
        summary: event.summary,
        confidence: event.confidence,
        items: eventItems,
        totals: nutritionTotals(eventItems),
      };
    }),
    totals: nutritionTotals(items),
  };
}

function getDayRange(day: Date, timeZone: string) {
  const localDate = formatDateInTimeZone(day, timeZone);
  const start = localMidnightToUtc(localDate, timeZone);
  const nextDate = new Date(`${localDate}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = localMidnightToUtc(nextDate.toISOString().slice(0, 10), timeZone);
  return { localDate, start, end };
}

function nutritionTotals(
  items: Array<{
    caloriesKcal: number | null;
    proteinGrams: number | null;
    carbsGrams: number | null;
    fatGrams: number | null;
  }>,
) {
  return {
    caloriesKcal: sumKnownNutrition(items.map((item) => item.caloriesKcal)),
    proteinGrams: sumKnownNutrition(items.map((item) => item.proteinGrams)),
    carbsGrams: sumKnownNutrition(items.map((item) => item.carbsGrams)),
    fatGrams: sumKnownNutrition(items.map((item) => item.fatGrams)),
    complete: {
      calories: items.every((item) => item.caloriesKcal !== null),
      protein: items.every((item) => item.proteinGrams !== null),
      carbs: items.every((item) => item.carbsGrams !== null),
      fat: items.every((item) => item.fatGrams !== null),
    },
  };
}

function emptyNutritionTotals() {
  return {
    caloriesKcal: 0,
    proteinGrams: 0,
    carbsGrams: 0,
    fatGrams: 0,
    complete: { calories: true, protein: true, carbs: true, fat: true },
  };
}

function sumKnownNutrition(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localMidnightToUtc(date: string, timeZone: string) {
  const guess = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return new Date(guess.getTime() - (representedAsUtc - guess.getTime()));
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
        isNull(fitnessEvents.deletedAt),
      ),
    )
    .orderBy(sql`${fitnessEvents.occurredAt} desc`)
    .limit(50);
}

export async function getRecentExerciseSessions(db: Database, days: number, limit = 20) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  const events = await db
    .select({
      id: fitnessEvents.id,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
    })
    .from(fitnessEvents)
    .where(
      and(
        eq(fitnessEvents.kind, "workout"),
        gte(fitnessEvents.occurredAt, start),
        isNull(fitnessEvents.deletedAt),
      ),
    )
    .orderBy(sql`${fitnessEvents.occurredAt} desc`)
    .limit(limit);
  if (!events.length) return [];

  const sets = await db
    .select({
      eventId: exerciseSets.eventId,
      exercise: exercises.canonicalName,
      originalName: exerciseSets.originalName,
      setNumber: exerciseSets.setNumber,
      reps: exerciseSets.reps,
      weightKg: exerciseSets.weightKg,
      durationSeconds: exerciseSets.durationSeconds,
      distanceMeters: exerciseSets.distanceMeters,
    })
    .from(exerciseSets)
    .innerJoin(exercises, eq(exerciseSets.exerciseId, exercises.id))
    .where(
      inArray(
        exerciseSets.eventId,
        events.map((event) => event.id),
      ),
    )
    .orderBy(exerciseSets.eventId, exercises.canonicalName, exerciseSets.setNumber);

  return events.map((event) => ({
    occurredAt: event.occurredAt,
    summary: event.summary,
    sets: sets
      .filter((set) => set.eventId === event.id)
      .map((set) => ({
        exercise: set.exercise,
        originalName: set.originalName,
        setNumber: set.setNumber,
        reps: set.reps,
        weightKg: set.weightKg,
        durationSeconds: set.durationSeconds,
        distanceMeters: set.distanceMeters,
      })),
  }));
}

export async function getExerciseCatalog(db: Database) {
  return db
    .select({
      id: exercises.id,
      exercise: exercises.canonicalName,
      workouts: sql<number>`count(distinct ${exerciseSets.eventId})`,
      setRows: sql<number>`count(${exerciseSets.id})`,
      latestAt: sql<number>`max(${fitnessEvents.occurredAt})`,
      maxWeightKg: sql<number | null>`max(${exerciseSets.weightKg})`,
    })
    .from(exercises)
    .leftJoin(exerciseSets, eq(exerciseSets.exerciseId, exercises.id))
    .leftJoin(
      fitnessEvents,
      and(eq(exerciseSets.eventId, fitnessEvents.id), isNull(fitnessEvents.deletedAt)),
    )
    .groupBy(exercises.id)
    .orderBy(exercises.canonicalName);
}

export async function getExerciseProgress(db: Database, exercise: string, days: number) {
  const matchedExercise = await findExerciseByName(db, exercise);
  if (!matchedExercise) {
    const [lookup] = await resolveExerciseNames(db, [exercise]);
    return { exercise: cleanExerciseName(exercise), sessions: [], candidates: lookup.candidates };
  }
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  const rows = await db
    .select({
      eventId: fitnessEvents.id,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
      setNumber: exerciseSets.setNumber,
      reps: exerciseSets.reps,
      weightKg: exerciseSets.weightKg,
    })
    .from(exerciseSets)
    .innerJoin(fitnessEvents, eq(exerciseSets.eventId, fitnessEvents.id))
    .where(
      and(
        eq(exerciseSets.exerciseId, matchedExercise.id),
        gte(fitnessEvents.occurredAt, start),
        isNull(fitnessEvents.deletedAt),
      ),
    )
    .orderBy(fitnessEvents.occurredAt, exerciseSets.setNumber);

  const sessions = new Map<
    string,
    {
      occurredAt: Date;
      summary: string;
      sets: { setNumber: number | null; reps: number | null; weightKg: number | null }[];
    }
  >();
  for (const row of rows) {
    const session = sessions.get(row.eventId) ?? {
      occurredAt: row.occurredAt,
      summary: row.summary,
      sets: [],
    };
    session.sets.push({ setNumber: row.setNumber, reps: row.reps, weightKg: row.weightKg });
    sessions.set(row.eventId, session);
  }

  return {
    exercise: matchedExercise.canonicalName,
    sessions: [...sessions.values()].map((session) => ({
      ...session,
      totalReps: session.sets.reduce((total, set) => total + (set.reps ?? 0), 0),
      maxWeightKg: session.sets.reduce<number | null>(
        (maximum, set) =>
          set.weightKg === null ? maximum : Math.max(maximum ?? set.weightKg, set.weightKg),
        null,
      ),
      volumeKg: session.sets.reduce(
        (total, set) => total + (set.reps ?? 0) * (set.weightKg ?? 0),
        0,
      ),
    })),
  };
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
    .where(
      and(
        eq(measurements.metric, "weight"),
        gte(fitnessEvents.occurredAt, start),
        isNull(fitnessEvents.deletedAt),
      ),
    )
    .orderBy(sql`${fitnessEvents.occurredAt} desc`)
    .limit(50);
}

export async function queryMeals(db: Database, input: MealQuery) {
  const range = inclusiveDateRange(input.range.startDate, input.range.endDate);
  const allEvents = await db
    .select({
      id: fitnessEvents.id,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
      confidence: fitnessEvents.confidence,
    })
    .from(fitnessEvents)
    .where(
      and(
        eq(fitnessEvents.kind, "meal"),
        gte(fitnessEvents.occurredAt, range.start),
        lt(fitnessEvents.occurredAt, range.end),
        isNull(fitnessEvents.deletedAt),
      ),
    )
    .orderBy(fitnessEvents.occurredAt)
    .limit(500);
  const pageEvents = allEvents.slice(input.offset, input.offset + input.limit);
  const allItems = allEvents.length
    ? await db
        .select({
          id: mealItems.id,
          eventId: mealItems.eventId,
          name: mealItems.name,
          quantity: mealItems.quantity,
          unit: mealItems.unit,
          caloriesKcal: mealItems.caloriesKcal,
          proteinGrams: mealItems.proteinGrams,
          carbsGrams: mealItems.carbsGrams,
          fatGrams: mealItems.fatGrams,
          confidence: mealItems.confidence,
          nutritionSource: mealItems.nutritionSource,
        })
        .from(mealItems)
        .where(
          inArray(
            mealItems.eventId,
            allEvents.map((event) => event.id),
          ),
        )
    : [];
  const itemsByEvent = groupBy(allItems, (item) => item.eventId);
  const totals = nutritionTotals(allItems);
  const days = new Map<string, typeof allItems>();
  for (const event of allEvents) {
    const date = formatDateInTimeZone(event.occurredAt, "America/Sao_Paulo");
    days.set(date, [...(days.get(date) ?? []), ...(itemsByEvent.get(event.id) ?? [])]);
  }

  const comparison =
    input.compare === "previous_period"
      ? await getMealRangeSummary(
          db,
          previousInclusiveRange(input.range.startDate, input.range.endDate),
        )
      : null;

  return {
    range: input.range,
    detail: input.detail,
    totals,
    mealCount: allEvents.length,
    dailyAverageCalories:
      totals.caloriesKcal === null
        ? null
        : totals.caloriesKcal / inclusiveDayCount(input.range.startDate, input.range.endDate),
    days: [...days.entries()].map(([date, items]) => ({ date, totals: nutritionTotals(items) })),
    meals: pageEvents.map((event) => {
      const eventItems = itemsByEvent.get(event.id) ?? [];
      return {
        ref: event.id,
        occurredAt: event.occurredAt,
        summary: event.summary,
        confidence: event.confidence,
        totals: nutritionTotals(eventItems),
        itemNames: eventItems.map((item) => item.name),
        ...(input.detail === "full"
          ? {
              items: eventItems.map((item) => ({
                ref: item.id,
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                caloriesKcal: item.caloriesKcal,
                proteinGrams: item.proteinGrams,
                carbsGrams: item.carbsGrams,
                fatGrams: item.fatGrams,
                confidence: item.confidence,
                nutritionSource: item.nutritionSource,
              })),
            }
          : {}),
      };
    }),
    comparison,
    page: pageInfo(allEvents.length, input.offset, input.limit),
  };
}

export async function queryTraining(db: Database, input: TrainingQuery) {
  const current = await loadTrainingRange(
    db,
    input.range.startDate,
    input.range.endDate,
    input.exercises,
  );
  const pageSessions = current.sessions.slice(input.offset, input.offset + input.limit);
  const comparison =
    input.compare === "previous_period"
      ? summarizeTraining(
          await loadTrainingRange(
            db,
            previousInclusiveRange(input.range.startDate, input.range.endDate).startDate,
            previousInclusiveRange(input.range.startDate, input.range.endDate).endDate,
            input.exercises,
          ),
        )
      : null;

  return {
    range: input.range,
    detail: input.detail,
    summary: summarizeTraining(current),
    sessions: pageSessions.map((session) => ({
      ref: session.id,
      kind: session.kind,
      occurredAt: session.occurredAt,
      summary: session.summary,
      exercises: summarizeExercises(session.sets),
      ...(input.detail === "full"
        ? {
            sets: session.sets.map((set) => ({
              ref: set.id,
              exercise: set.exercise,
              originalName: set.originalName,
              setNumber: set.setNumber,
              reps: set.reps,
              weightKg: set.weightKg,
              durationSeconds: set.durationSeconds,
              distanceMeters: set.distanceMeters,
            })),
          }
        : {}),
    })),
    comparison,
    page: pageInfo(current.sessions.length, input.offset, input.limit),
  };
}

export async function queryMeasurements(db: Database, input: MeasurementQuery) {
  const range = inclusiveDateRange(input.range.startDate, input.range.endDate);
  const rows = await db
    .select({
      id: measurements.id,
      eventId: fitnessEvents.id,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
      metric: measurements.metric,
      value: measurements.value,
      unit: measurements.unit,
    })
    .from(measurements)
    .innerJoin(fitnessEvents, eq(measurements.eventId, fitnessEvents.id))
    .where(
      and(
        gte(fitnessEvents.occurredAt, range.start),
        lt(fitnessEvents.occurredAt, range.end),
        isNull(fitnessEvents.deletedAt),
        ...(input.metrics.length ? [inArray(measurements.metric, input.metrics)] : []),
      ),
    )
    .orderBy(fitnessEvents.occurredAt)
    .limit(500);
  const comparisonRange = previousInclusiveRange(input.range.startDate, input.range.endDate);
  const comparison =
    input.compare === "previous_period"
      ? summarizeMeasurements(
          await loadMeasurementRange(
            db,
            comparisonRange.startDate,
            comparisonRange.endDate,
            input.metrics,
          ),
        )
      : null;

  return {
    range: input.range,
    detail: input.detail,
    summary: summarizeMeasurements(rows),
    records: rows.slice(input.offset, input.offset + input.limit).map((row) => ({
      ref: row.eventId,
      measurementRef: row.id,
      occurredAt: row.occurredAt,
      summary: row.summary,
      metric: row.metric,
      value: row.value,
      unit: row.unit,
    })),
    comparison,
    page: pageInfo(rows.length, input.offset, input.limit),
  };
}

export async function queryTimeline(db: Database, input: TimelineQuery) {
  const range = inclusiveDateRange(input.range.startDate, input.range.endDate);
  const conditions = [
    gte(fitnessEvents.occurredAt, range.start),
    lt(fitnessEvents.occurredAt, range.end),
    isNull(fitnessEvents.deletedAt),
  ];
  if (input.kinds.length) conditions.push(inArray(fitnessEvents.kind, input.kinds));
  if (input.search) conditions.push(like(fitnessEvents.summary, `%${input.search}%`));
  const rows = await db
    .select({
      id: fitnessEvents.id,
      kind: fitnessEvents.kind,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
      confidence: fitnessEvents.confidence,
    })
    .from(fitnessEvents)
    .where(and(...conditions))
    .orderBy(fitnessEvents.occurredAt)
    .limit(500);

  return {
    range: input.range,
    records: rows.slice(input.offset, input.offset + input.limit).map((row) => ({
      ref: row.id,
      kind: row.kind,
      occurredAt: row.occurredAt,
      summary: row.summary,
      ...(input.detail === "full" ? { confidence: row.confidence } : {}),
    })),
    counts: Object.fromEntries(
      ["meal", "workout", "run", "measurement", "note"].map((kind) => [
        kind,
        rows.filter((row) => row.kind === kind).length,
      ]),
    ),
    page: pageInfo(rows.length, input.offset, input.limit),
  };
}

export async function manageRecords(
  db: Database,
  sourceMessageId: string,
  input: ManageRecordsInput,
) {
  const receipts: Array<{ action: string; ref: string; eventRef: string }> = [];
  for (const change of input.changes) {
    if (change.action === "update_event") {
      const [before] = await db
        .select()
        .from(fitnessEvents)
        .where(and(eq(fitnessEvents.id, change.eventRef), isNull(fitnessEvents.deletedAt)))
        .limit(1);
      if (!before) throw new Error(`Active event not found: ${change.eventRef}`);
      const patch = {
        ...(change.occurredAt ? { occurredAt: new Date(change.occurredAt) } : {}),
        ...(change.summary ? { summary: change.summary } : {}),
        updatedAt: new Date(),
      };
      const [after] = await db
        .update(fitnessEvents)
        .set(patch)
        .where(eq(fitnessEvents.id, change.eventRef))
        .returning();
      await auditRecordChange(db, sourceMessageId, change.action, before.id, before, after);
      receipts.push({ action: change.action, ref: change.eventRef, eventRef: before.id });
      continue;
    }

    if (change.action === "delete_event") {
      const [before] = await db
        .select()
        .from(fitnessEvents)
        .where(and(eq(fitnessEvents.id, change.eventRef), isNull(fitnessEvents.deletedAt)))
        .limit(1);
      if (!before) throw new Error(`Active event not found: ${change.eventRef}`);
      const [after] = await db
        .update(fitnessEvents)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(fitnessEvents.id, change.eventRef))
        .returning();
      await auditRecordChange(db, sourceMessageId, change.action, before.id, before, after);
      receipts.push({ action: change.action, ref: change.eventRef, eventRef: before.id });
      continue;
    }

    const child = await getChildRecord(db, change);
    if (!child) throw new Error(`Active child record not found for ${change.action}`);
    const after = await updateChildRecord(db, change);
    await db
      .update(fitnessEvents)
      .set({ updatedAt: new Date() })
      .where(eq(fitnessEvents.id, child.eventId));
    await auditRecordChange(db, sourceMessageId, change.action, child.eventId, child, after);
    const ref =
      "itemRef" in change
        ? change.itemRef
        : "setRef" in change
          ? change.setRef
          : change.measurementRef;
    receipts.push({ action: change.action, ref, eventRef: child.eventId });
  }
  return { changed: receipts.length, receipts };
}

async function getMealRangeSummary(db: Database, range: { startDate: string; endDate: string }) {
  const dates = inclusiveDateRange(range.startDate, range.endDate);
  const events = await db
    .select({ id: fitnessEvents.id })
    .from(fitnessEvents)
    .where(
      and(
        eq(fitnessEvents.kind, "meal"),
        gte(fitnessEvents.occurredAt, dates.start),
        lt(fitnessEvents.occurredAt, dates.end),
        isNull(fitnessEvents.deletedAt),
      ),
    )
    .limit(500);
  const items = events.length
    ? await db
        .select({
          caloriesKcal: mealItems.caloriesKcal,
          proteinGrams: mealItems.proteinGrams,
          carbsGrams: mealItems.carbsGrams,
          fatGrams: mealItems.fatGrams,
        })
        .from(mealItems)
        .where(
          inArray(
            mealItems.eventId,
            events.map((event) => event.id),
          ),
        )
    : [];
  return { range, mealCount: events.length, totals: nutritionTotals(items) };
}

async function loadTrainingRange(
  db: Database,
  startDate: string,
  endDate: string,
  exerciseFilters: string[],
) {
  const range = inclusiveDateRange(startDate, endDate);
  const resolvedFilters = exerciseFilters.length
    ? await resolveExerciseNames(db, exerciseFilters)
    : [];
  const filterIds = new Set(
    resolvedFilters.flatMap((filter) => (filter.exact ? [filter.exact.id] : [])),
  );
  const events = await db
    .select({
      id: fitnessEvents.id,
      kind: fitnessEvents.kind,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
    })
    .from(fitnessEvents)
    .where(
      and(
        or(eq(fitnessEvents.kind, "workout"), eq(fitnessEvents.kind, "run")),
        gte(fitnessEvents.occurredAt, range.start),
        lt(fitnessEvents.occurredAt, range.end),
        isNull(fitnessEvents.deletedAt),
      ),
    )
    .orderBy(fitnessEvents.occurredAt)
    .limit(500);
  const sets = events.length
    ? await db
        .select({
          id: exerciseSets.id,
          eventId: exerciseSets.eventId,
          exerciseId: exerciseSets.exerciseId,
          exercise: exercises.canonicalName,
          originalName: exerciseSets.originalName,
          setNumber: exerciseSets.setNumber,
          reps: exerciseSets.reps,
          weightKg: exerciseSets.weightKg,
          durationSeconds: exerciseSets.durationSeconds,
          distanceMeters: exerciseSets.distanceMeters,
        })
        .from(exerciseSets)
        .innerJoin(exercises, eq(exerciseSets.exerciseId, exercises.id))
        .where(
          inArray(
            exerciseSets.eventId,
            events.map((event) => event.id),
          ),
        )
    : [];
  const setsByEvent = groupBy(sets, (set) => set.eventId);
  const normalizedFilters = exerciseFilters.map(normalizeExerciseKey);
  const sessions = events
    .map((event) => ({ ...event, sets: setsByEvent.get(event.id) ?? [] }))
    .filter(
      (event) =>
        !normalizedFilters.length ||
        event.sets.some(
          (set) =>
            filterIds.has(set.exerciseId) ||
            normalizedFilters.includes(normalizeExerciseKey(set.exercise)) ||
            normalizedFilters.includes(normalizeExerciseKey(set.originalName)),
        ),
    )
    .map((event) => ({
      ...event,
      sets: normalizedFilters.length
        ? event.sets.filter(
            (set) =>
              filterIds.has(set.exerciseId) ||
              normalizedFilters.includes(normalizeExerciseKey(set.exercise)) ||
              normalizedFilters.includes(normalizeExerciseKey(set.originalName)),
          )
        : event.sets,
    }));
  return { sessions };
}

function summarizeTraining(training: Awaited<ReturnType<typeof loadTrainingRange>>) {
  const sets = training.sessions.flatMap((session) => session.sets);
  return {
    sessions: training.sessions.length,
    workouts: training.sessions.filter((session) => session.kind === "workout").length,
    runs: training.sessions.filter((session) => session.kind === "run").length,
    setRows: sets.length,
    totalReps: sets.reduce((total, set) => total + (set.reps ?? 0), 0),
    volumeKg: sets.reduce((total, set) => total + (set.reps ?? 0) * (set.weightKg ?? 0), 0),
    distanceMeters: sets.reduce((total, set) => total + (set.distanceMeters ?? 0), 0),
    durationSeconds: sets.reduce((total, set) => total + (set.durationSeconds ?? 0), 0),
    exercises: summarizeExercises(sets),
  };
}

function summarizeExercises(
  sets: Array<{
    exercise: string;
    reps: number | null;
    weightKg: number | null;
    distanceMeters: number | null;
    durationSeconds: number | null;
  }>,
) {
  const byExercise = groupBy(sets, (set) => set.exercise);
  return [...byExercise.entries()].map(([exercise, records]) => ({
    exercise,
    sets: records.length,
    totalReps: records.reduce((total, set) => total + (set.reps ?? 0), 0),
    maxWeightKg: maximumKnown(records.map((set) => set.weightKg)),
    volumeKg: records.reduce((total, set) => total + (set.reps ?? 0) * (set.weightKg ?? 0), 0),
    distanceMeters: records.reduce((total, set) => total + (set.distanceMeters ?? 0), 0),
    durationSeconds: records.reduce((total, set) => total + (set.durationSeconds ?? 0), 0),
  }));
}

async function loadMeasurementRange(
  db: Database,
  startDate: string,
  endDate: string,
  metrics: MeasurementQuery["metrics"],
) {
  const range = inclusiveDateRange(startDate, endDate);
  return db
    .select({
      id: measurements.id,
      eventId: fitnessEvents.id,
      occurredAt: fitnessEvents.occurredAt,
      summary: fitnessEvents.summary,
      metric: measurements.metric,
      value: measurements.value,
      unit: measurements.unit,
    })
    .from(measurements)
    .innerJoin(fitnessEvents, eq(measurements.eventId, fitnessEvents.id))
    .where(
      and(
        gte(fitnessEvents.occurredAt, range.start),
        lt(fitnessEvents.occurredAt, range.end),
        isNull(fitnessEvents.deletedAt),
        ...(metrics.length ? [inArray(measurements.metric, metrics)] : []),
      ),
    )
    .orderBy(fitnessEvents.occurredAt)
    .limit(500);
}

function summarizeMeasurements(rows: Awaited<ReturnType<typeof loadMeasurementRange>>) {
  const grouped = groupBy(rows, (row) => row.metric);
  return [...grouped.entries()].map(([metric, records]) => ({
    metric,
    count: records.length,
    first: records[0]
      ? { value: records[0].value, unit: records[0].unit, occurredAt: records[0].occurredAt }
      : null,
    latest: records.at(-1)
      ? {
          value: records.at(-1)!.value,
          unit: records.at(-1)!.unit,
          occurredAt: records.at(-1)!.occurredAt,
        }
      : null,
    change: records.length > 1 ? records.at(-1)!.value - records[0]!.value : 0,
  }));
}

async function getChildRecord(db: Database, change: ManageRecordsInput["changes"][number]) {
  if (change.action === "update_meal_item") {
    const [row] = await db
      .select({ item: mealItems, eventId: fitnessEvents.id })
      .from(mealItems)
      .innerJoin(fitnessEvents, eq(mealItems.eventId, fitnessEvents.id))
      .where(and(eq(mealItems.id, change.itemRef), isNull(fitnessEvents.deletedAt)))
      .limit(1);
    return row ? { ...row.item, eventId: row.eventId } : null;
  }
  if (change.action === "update_exercise_set") {
    const [row] = await db
      .select({ set: exerciseSets, eventId: fitnessEvents.id })
      .from(exerciseSets)
      .innerJoin(fitnessEvents, eq(exerciseSets.eventId, fitnessEvents.id))
      .where(and(eq(exerciseSets.id, change.setRef), isNull(fitnessEvents.deletedAt)))
      .limit(1);
    return row ? { ...row.set, eventId: row.eventId } : null;
  }
  if (change.action === "update_measurement") {
    const [row] = await db
      .select({ measurement: measurements, eventId: fitnessEvents.id })
      .from(measurements)
      .innerJoin(fitnessEvents, eq(measurements.eventId, fitnessEvents.id))
      .where(and(eq(measurements.id, change.measurementRef), isNull(fitnessEvents.deletedAt)))
      .limit(1);
    return row ? { ...row.measurement, eventId: row.eventId } : null;
  }
  return null;
}

async function updateChildRecord(db: Database, change: ManageRecordsInput["changes"][number]) {
  if (change.action === "update_meal_item") {
    const patch = {
      ...(change.name !== undefined ? { name: change.name } : {}),
      ...(change.quantity !== undefined ? { quantity: change.quantity } : {}),
      ...(change.unit !== undefined ? { unit: change.unit } : {}),
      ...(change.caloriesKcal !== undefined ? { caloriesKcal: change.caloriesKcal } : {}),
      ...(change.proteinGrams !== undefined ? { proteinGrams: change.proteinGrams } : {}),
      ...(change.carbsGrams !== undefined ? { carbsGrams: change.carbsGrams } : {}),
      ...(change.fatGrams !== undefined ? { fatGrams: change.fatGrams } : {}),
      confidence: 1,
      nutritionSource: "user_provided",
    };
    const [row] = await db
      .update(mealItems)
      .set(patch)
      .where(eq(mealItems.id, change.itemRef))
      .returning();
    return row;
  }
  if (change.action === "update_exercise_set") {
    const resolvedExercise = change.exercise ? await registerExercise(db, change.exercise) : null;
    const patch = {
      ...(resolvedExercise
        ? { exerciseId: resolvedExercise.id, originalName: cleanExerciseName(change.exercise!) }
        : {}),
      ...(change.reps !== undefined ? { reps: change.reps } : {}),
      ...(change.weightKg !== undefined ? { weightKg: change.weightKg } : {}),
      ...(change.durationSeconds !== undefined ? { durationSeconds: change.durationSeconds } : {}),
      ...(change.distanceMeters !== undefined ? { distanceMeters: change.distanceMeters } : {}),
    };
    const [row] = await db
      .update(exerciseSets)
      .set(patch)
      .where(eq(exerciseSets.id, change.setRef))
      .returning();
    return row;
  }
  if (change.action === "update_measurement") {
    const patch = {
      ...(change.value !== undefined ? { value: change.value } : {}),
      ...(change.unit !== undefined ? { unit: change.unit } : {}),
    };
    const [row] = await db
      .update(measurements)
      .set(patch)
      .where(eq(measurements.id, change.measurementRef))
      .returning();
    return row;
  }
  throw new Error(`Unsupported child update: ${change.action}`);
}

async function auditRecordChange(
  db: Database,
  sourceMessageId: string,
  action: ManageRecordsInput["changes"][number]["action"],
  eventId: string,
  before: unknown,
  after: unknown,
) {
  await db.insert(recordChanges).values({
    id: crypto.randomUUID(),
    eventId,
    sourceMessageId,
    action,
    before: jsonRecord(before),
    after: after ? jsonRecord(after) : null,
    createdAt: new Date(),
  });
}

function inclusiveDateRange(startDate: string, endDate: string) {
  const start = localMidnightToUtc(startDate, "America/Sao_Paulo");
  const nextDate = new Date(`${endDate}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = localMidnightToUtc(nextDate.toISOString().slice(0, 10), "America/Sao_Paulo");
  return { start, end };
}

function previousInclusiveRange(startDate: string, endDate: string) {
  const days = inclusiveDayCount(startDate, endDate);
  const previousEnd = new Date(`${startDate}T12:00:00Z`);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
}

function inclusiveDayCount(startDate: string, endDate: string) {
  return (
    Math.round(
      (new Date(`${endDate}T12:00:00Z`).getTime() - new Date(`${startDate}T12:00:00Z`).getTime()) /
        86_400_000,
    ) + 1
  );
}

function pageInfo(total: number, offset: number, limit: number) {
  return {
    total,
    offset,
    limit,
    returned: Math.max(0, Math.min(limit, total - offset)),
    hasMore: offset + limit < total,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

function maximumKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.max(...known) : null;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
