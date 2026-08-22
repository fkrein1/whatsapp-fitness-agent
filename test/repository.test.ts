import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabase } from "../src/db/client";
import {
  approveLatestMealProposal,
  cancelLatestMealProposal,
  claimSourceMessage,
  createMealProposal,
  getAgentTurnEvents,
  getDailyCalories,
  getDailyMeals,
  getExerciseCatalog,
  getLatestPendingMealProposal,
  getRecentWeights,
  manageRecords,
  queryMeals,
  queryMeasurements,
  queryTimeline,
  queryTraining,
  registerExercise,
  recordAgentTurnEvent,
  resolveExerciseNames,
  saveIngestion,
  updateLatestMealProposal,
} from "../src/db/repository";
import { exerciseSets, fitnessEvents, recordChanges } from "../src/db/schema";

describe("fitness repository", () => {
  it("claims a WhatsApp message only once", async () => {
    const db = createDatabase(env.DB);
    const input = {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId: "5511999999999",
      inputType: "text" as const,
      text: "I weigh 80 kg",
      mediaId: null,
      mimeType: null,
      receivedAt: new Date(),
    };

    expect(await claimSourceMessage(db, input)).toEqual(expect.any(String));
    expect(await claimSourceMessage(db, input)).toBeNull();
  });

  it("persists a content-free timeline for an agent turn", async () => {
    const db = createDatabase(env.DB);
    const sourceMessageId = await claimSourceMessage(db, {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId: "5511999999999",
      inputType: "text",
      text: "private message content",
      mediaId: null,
      mimeType: null,
      receivedAt: new Date(),
    });

    await recordAgentTurnEvent(db, sourceMessageId!, "step_finished", {
      stepNumber: 0,
      durationMs: 123,
    });

    expect(await getAgentTurnEvents(db, sourceMessageId!)).toEqual([
      expect.objectContaining({
        stage: "step_finished",
        details: { stepNumber: 0, durationMs: 123 },
        createdAt: expect.any(Date),
      }),
    ]);
  });

  it("stores queryable meals and weekly weight", async () => {
    const db = createDatabase(env.DB);
    const occurredAt = new Date();
    const sourceMessageId = await claimSourceMessage(db, {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId: "5511999999999",
      inputType: "text",
      text: "80 kg and a 500 calorie lunch",
      mediaId: null,
      mimeType: null,
      receivedAt: occurredAt,
    });
    expect(sourceMessageId).not.toBeNull();

    await saveIngestion(
      db,
      sourceMessageId!,
      {
        events: [
          {
            kind: "measurement",
            occurredAt: occurredAt.toISOString(),
            summary: "Weight 80 kg",
            confidence: 1,
            mealItems: [],
            exerciseSets: [],
            measurements: [{ metric: "weight", value: 80, unit: "kg" }],
          },
          {
            kind: "meal",
            occurredAt: occurredAt.toISOString(),
            summary: "Lunch",
            confidence: 0.8,
            mealItems: [
              {
                name: "Lunch",
                quantity: null,
                unit: null,
                caloriesKcal: 500,
                proteinGrams: null,
                carbsGrams: null,
                fatGrams: null,
                confidence: 0.8,
                nutritionSource: "user_provided",
              },
            ],
            exerciseSets: [],
            measurements: [],
          },
        ],
        query: null,
        reply: "Logged.",
      },
      occurredAt,
    );

    expect(await getDailyCalories(db, occurredAt)).toBe(500);
    expect(await getDailyMeals(db, occurredAt)).toEqual(
      expect.objectContaining({
        meals: [
          expect.objectContaining({
            summary: "Lunch",
            items: [expect.objectContaining({ name: "Lunch", caloriesKcal: 500 })],
            totals: expect.objectContaining({ caloriesKcal: 500 }),
          }),
        ],
        totals: expect.objectContaining({ caloriesKcal: 500 }),
      }),
    );
    expect(await getRecentWeights(db, 7)).toEqual([
      expect.objectContaining({ value: 80, unit: "kg" }),
    ]);
  });

  it("does not save an image meal until the user approves it", async () => {
    const db = createDatabase(env.DB);
    const receivedAt = new Date();
    const approvedAt = new Date(receivedAt.getTime() + 5 * 60 * 1000);
    const senderId = `sender-${crypto.randomUUID()}`;
    const imageSourceId = await claimSourceMessage(db, {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId,
      inputType: "image",
      text: null,
      mediaId: "image-1",
      mimeType: "image/jpeg",
      receivedAt,
    });
    const proposal = {
      events: [
        { ...mealEvent(receivedAt.toISOString(), "Arroz, feijão e frango", 620), occurredAt: null },
      ],
      query: null,
      reply: "Confirme a leitura da foto.",
    };
    const caloriesBefore = await getDailyCalories(db, receivedAt);

    await createMealProposal(db, imageSourceId!, senderId, proposal);

    expect(await getDailyCalories(db, receivedAt)).toBe(caloriesBefore);
    expect(await getLatestPendingMealProposal(db, senderId, receivedAt)).toEqual(
      expect.objectContaining({ sourceMessageId: imageSourceId, payload: proposal }),
    );
    const editedEvents = [
      { ...mealEvent(receivedAt.toISOString(), "Porção corrigida", 700), occurredAt: null },
    ];
    expect(await updateLatestMealProposal(db, senderId, editedEvents, receivedAt)).toEqual(
      expect.objectContaining({ events: editedEvents }),
    );

    const approvalSourceId = await claimSourceMessage(db, {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId,
      inputType: "text",
      text: "confirmar",
      mediaId: null,
      mimeType: null,
      receivedAt,
    });
    expect(await approveLatestMealProposal(db, senderId, approvalSourceId!, approvedAt)).toEqual(
      expect.objectContaining({ insertedEvents: 1 }),
    );
    expect(await getDailyCalories(db, approvedAt)).toBe(caloriesBefore + 700);
    const [savedMeal] = await db
      .select({ occurredAt: fitnessEvents.occurredAt })
      .from(fitnessEvents)
      .where(eq(fitnessEvents.sourceMessageId, imageSourceId!));
    expect(savedMeal?.occurredAt).toEqual(approvedAt);
    expect(await getLatestPendingMealProposal(db, senderId, receivedAt)).toBeNull();
  });

  it("can cancel an image meal without saving it", async () => {
    const db = createDatabase(env.DB);
    const receivedAt = new Date();
    const senderId = `sender-${crypto.randomUUID()}`;
    const imageSourceId = await claimSourceMessage(db, {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId,
      inputType: "image",
      text: null,
      mediaId: "image-2",
      mimeType: "image/jpeg",
      receivedAt,
    });
    const caloriesBefore = await getDailyCalories(db, receivedAt);
    await createMealProposal(db, imageSourceId!, senderId, {
      events: [mealEvent(receivedAt.toISOString(), "Almoço", 500)],
      query: null,
      reply: "Confirme.",
    });
    const cancellationSourceId = await claimSourceMessage(db, {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId,
      inputType: "text",
      text: "cancelar",
      mediaId: null,
      mimeType: null,
      receivedAt,
    });

    expect(await cancelLatestMealProposal(db, senderId, cancellationSourceId!, receivedAt)).toBe(
      true,
    );
    expect(await getDailyCalories(db, receivedAt)).toBe(caloriesBefore);
    expect(await getLatestPendingMealProposal(db, senderId, receivedAt)).toBeNull();
  });

  it("uses Sao Paulo day boundaries for daily calories", async () => {
    const db = createDatabase(env.DB);
    const receivedAt = new Date("2035-08-22T12:00:00Z");
    const sourceMessageId = await claimSourceMessage(db, {
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      senderId: "5511999999999",
      inputType: "text",
      text: "Two meals around midnight",
      mediaId: null,
      mimeType: null,
      receivedAt,
    });

    await saveIngestion(
      db,
      sourceMessageId!,
      {
        events: [
          mealEvent("2035-08-22T02:30:00Z", "Late meal", 100),
          mealEvent("2035-08-22T03:30:00Z", "Breakfast", 200),
        ],
        query: null,
        reply: "Logged.",
      },
      receivedAt,
    );

    expect(await getDailyCalories(db, new Date("2035-08-22T12:00:00Z"))).toBe(200);
    expect(await getDailyCalories(db, new Date("2035-08-21T12:00:00Z"))).toBe(100);
    expect(await getDailyMeals(db, new Date("2035-08-22T12:00:00Z"))).toEqual(
      expect.objectContaining({
        date: "2035-08-22",
        meals: [expect.objectContaining({ summary: "Breakfast" })],
      }),
    );
    expect(await getDailyMeals(db, new Date("2035-08-21T12:00:00Z"))).toEqual(
      expect.objectContaining({
        date: "2035-08-21",
        meals: [expect.objectContaining({ summary: "Late meal" })],
      }),
    );
  });

  it("repairs child rows when an idempotent event is retried", async () => {
    const db = createDatabase(env.DB);
    const occurredAt = new Date();
    const providerMessageId = `wamid.${crypto.randomUUID()}`;
    const sourceMessageId = await claimSourceMessage(db, {
      providerMessageId,
      senderId: "5511999999999",
      inputType: "text",
      text: "Bench Press: 3x8 65kg",
      mediaId: null,
      mimeType: null,
      receivedAt: occurredAt,
    });
    expect(sourceMessageId).not.toBeNull();

    const baseEvent = {
      kind: "workout" as const,
      occurredAt: occurredAt.toISOString(),
      summary: "Bench press",
      confidence: 1,
      mealItems: [],
      measurements: [],
    };
    const options = { externalKeyPrefix: `${providerMessageId}:0`, finalize: false };

    await saveIngestion(
      db,
      sourceMessageId!,
      { events: [{ ...baseEvent, exerciseSets: [] }], query: null, reply: "Recorded." },
      occurredAt,
      options,
    );
    await saveIngestion(
      db,
      sourceMessageId!,
      {
        events: [
          {
            ...baseEvent,
            exerciseSets: Array.from({ length: 15 }, (_, index) => ({
              exercise: "Bench Press",
              setNumber: index + 1,
              reps: 8,
              weightKg: 65,
              durationSeconds: null,
              distanceMeters: null,
            })),
          },
        ],
        query: null,
        reply: "Recorded.",
      },
      occurredAt,
      options,
    );

    const events = await db
      .select({ id: fitnessEvents.id })
      .from(fitnessEvents)
      .where(eq(fitnessEvents.sourceMessageId, sourceMessageId!));
    expect(events).toHaveLength(1);
    expect(
      await db
        .select({ setNumber: exerciseSets.setNumber })
        .from(exerciseSets)
        .where(eq(exerciseSets.eventId, events[0].id)),
    ).toEqual(Array.from({ length: 15 }, (_, index) => ({ setNumber: index + 1 })));
  });

  it("resolves aliases and registers unknown exercises conservatively", async () => {
    const db = createDatabase(env.DB);
    expect(await resolveExerciseNames(db, ["RDL"])).toEqual([
      expect.objectContaining({
        submittedName: "RDL",
        exact: expect.objectContaining({ canonicalName: "Romanian Deadlift" }),
      }),
    ]);

    const unknown = await resolveExerciseNames(db, ["Hack Squat"]);
    expect(unknown[0].exact).toBeNull();
    expect(unknown[0].candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ canonicalName: "Front Squat" })]),
    );

    const created = await registerExercise(db, "Hack Squat");
    expect(created).toEqual(
      expect.objectContaining({ canonicalName: "Hack Squat", created: true }),
    );
    const aliased = await registerExercise(db, "Hack Squats", created.id);
    expect(aliased).toEqual(expect.objectContaining({ id: created.id, created: false }));
    expect(await resolveExerciseNames(db, ["hack squats"])).toEqual([
      expect.objectContaining({
        exact: expect.objectContaining({ id: created.id, canonicalName: "Hack Squat" }),
      }),
    ]);
    expect(await getExerciseCatalog(db)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id, exercise: "Hack Squat" })]),
    );
  });

  it.each([
    ["KT Swing", "Kettlebell Swing"],
    ["HSPU", "Handstand Push Up"],
    ["Barra fixa", "Pull-Up"],
    ["Supino com halteres", "Dumbbell Bench Press"],
    ["Extensão de joelho unilateral", "Single-Leg Extension"],
    ["KT Reverse Lunge", "Kettlebell Reverse Lunge"],
    ["KT Squat", "Kettlebell Squat"],
  ])("resolves consolidated alias %s to %s", async (alias, canonicalName) => {
    const db = createDatabase(env.DB);
    expect(await resolveExerciseNames(db, [alias])).toEqual([
      expect.objectContaining({
        exact: expect.objectContaining({ canonicalName }),
      }),
    ]);
  });

  it("queries meals by range with compact, full, and previous-period views", async () => {
    const db = createDatabase(env.DB);
    const sourceMessageId = await claimSourceMessage(db, sourceMessage("range-meals"));
    await saveIngestion(
      db,
      sourceMessageId!,
      {
        events: [
          mealEvent("2040-01-02T15:00:00Z", "Previous lunch", 400),
          mealEvent("2040-01-08T15:00:00Z", "Current lunch", 600),
          mealEvent("2040-01-09T15:00:00Z", "Current dinner", 800),
        ],
        query: null,
        reply: "Recorded.",
      },
      new Date("2040-01-09T15:00:00Z"),
    );

    const compact = await queryMeals(db, {
      range: { startDate: "2040-01-08", endDate: "2040-01-14" },
      detail: "compact",
      compare: "previous_period",
      limit: 20,
      offset: 0,
    });
    expect(compact).toEqual(
      expect.objectContaining({
        mealCount: 2,
        totals: expect.objectContaining({ caloriesKcal: 1400 }),
        dailyAverageCalories: 200,
        comparison: expect.objectContaining({
          range: { startDate: "2040-01-01", endDate: "2040-01-07" },
          mealCount: 1,
          totals: expect.objectContaining({ caloriesKcal: 400 }),
        }),
      }),
    );
    expect(compact.meals[0]).not.toHaveProperty("items");

    const full = await queryMeals(db, {
      range: { startDate: "2040-01-08", endDate: "2040-01-09" },
      detail: "full",
      compare: "none",
      limit: 1,
      offset: 0,
    });
    expect(full.page).toEqual(expect.objectContaining({ total: 2, returned: 1, hasMore: true }));
    expect(full.meals[0]).toEqual(
      expect.objectContaining({
        ref: expect.any(String),
        items: [expect.objectContaining({ ref: expect.any(String), caloriesKcal: 600 })],
      }),
    );
  });

  it("queries training and measurements with full record references", async () => {
    const db = createDatabase(env.DB);
    const sourceMessageId = await claimSourceMessage(db, sourceMessage("domain-history"));
    await saveIngestion(
      db,
      sourceMessageId!,
      {
        events: [
          {
            kind: "workout",
            occurredAt: "2041-03-10T12:00:00Z",
            summary: "Upper body",
            confidence: 1,
            mealItems: [],
            exerciseSets: [
              {
                exercise: "RDL",
                setNumber: 1,
                reps: 8,
                weightKg: 70,
                durationSeconds: null,
                distanceMeters: null,
              },
            ],
            measurements: [],
          },
          {
            kind: "measurement",
            occurredAt: "2041-03-11T12:00:00Z",
            summary: "Weight 79 kg",
            confidence: 1,
            mealItems: [],
            exerciseSets: [],
            measurements: [{ metric: "weight", value: 79, unit: "kg" }],
          },
        ],
        query: null,
        reply: "Recorded.",
      },
      new Date("2041-03-11T12:00:00Z"),
    );

    const training = await queryTraining(db, {
      range: { startDate: "2041-03-01", endDate: "2041-03-31" },
      detail: "full",
      compare: "none",
      exercises: ["rdls"],
      limit: 20,
      offset: 0,
    });
    expect(training).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ sessions: 1, totalReps: 8, volumeKg: 560 }),
        sessions: [
          expect.objectContaining({
            ref: expect.any(String),
            sets: [
              expect.objectContaining({
                ref: expect.any(String),
                exercise: "Romanian Deadlift",
                weightKg: 70,
              }),
            ],
          }),
        ],
      }),
    );

    const measurements = await queryMeasurements(db, {
      range: { startDate: "2041-03-01", endDate: "2041-03-31" },
      detail: "full",
      compare: "none",
      metrics: ["weight"],
      limit: 20,
      offset: 0,
    });
    expect(measurements.records).toEqual([
      expect.objectContaining({
        ref: expect.any(String),
        measurementRef: expect.any(String),
        value: 79,
      }),
    ]);
  });

  it("audits corrections and hides soft-deleted records from every diary query", async () => {
    const db = createDatabase(env.DB);
    const originalSourceId = await claimSourceMessage(db, sourceMessage("correct-original"));
    await saveIngestion(
      db,
      originalSourceId!,
      {
        events: [mealEvent("2042-05-12T15:00:00Z", "Lunch to correct", 500)],
        query: null,
        reply: "Recorded.",
      },
      new Date("2042-05-12T15:00:00Z"),
    );
    const before = await queryMeals(db, {
      range: { startDate: "2042-05-12", endDate: "2042-05-12" },
      detail: "full",
      compare: "none",
      limit: 20,
      offset: 0,
    });
    const correctionSourceId = await claimSourceMessage(db, sourceMessage("correct-command"));
    const meal = before.meals[0];
    const item = meal.items![0];

    await manageRecords(db, correctionSourceId!, {
      changes: [
        { action: "update_meal_item", itemRef: item.ref, caloriesKcal: 650 },
        { action: "update_event", eventRef: meal.ref, summary: "Corrected lunch" },
      ],
    });
    expect(
      await queryMeals(db, {
        range: { startDate: "2042-05-12", endDate: "2042-05-12" },
        detail: "full",
        compare: "none",
        limit: 20,
        offset: 0,
      }),
    ).toEqual(
      expect.objectContaining({
        totals: expect.objectContaining({ caloriesKcal: 650 }),
        meals: [expect.objectContaining({ summary: "Corrected lunch" })],
      }),
    );

    await manageRecords(db, correctionSourceId!, {
      changes: [{ action: "delete_event", eventRef: meal.ref, reason: "duplicate" }],
    });
    const afterDelete = await queryTimeline(db, {
      range: { startDate: "2042-05-12", endDate: "2042-05-12" },
      detail: "compact",
      kinds: ["meal"],
      search: null,
      limit: 20,
      offset: 0,
    });
    expect(afterDelete.records).toEqual([]);
    expect(
      await db.select().from(recordChanges).where(eq(recordChanges.eventId, meal.ref)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "update_meal_item" }),
        expect.objectContaining({ action: "update_event" }),
        expect.objectContaining({ action: "delete_event" }),
      ]),
    );
  });
});

function sourceMessage(label: string) {
  return {
    providerMessageId: `wamid.${label}.${crypto.randomUUID()}`,
    senderId: "5511999999999",
    inputType: "text" as const,
    text: label,
    mediaId: null,
    mimeType: null,
    receivedAt: new Date(),
  };
}

function mealEvent(occurredAt: string, summary: string, caloriesKcal: number) {
  return {
    kind: "meal" as const,
    occurredAt,
    summary,
    confidence: 1,
    mealItems: [
      {
        name: summary,
        quantity: null,
        unit: null,
        caloriesKcal,
        proteinGrams: null,
        carbsGrams: null,
        fatGrams: null,
        confidence: 1,
        nutritionSource: "user_provided" as const,
      },
    ],
    exerciseSets: [],
    measurements: [],
  };
}
