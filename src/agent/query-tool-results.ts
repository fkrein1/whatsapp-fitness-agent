import type { queryMeals, queryMeasurements, queryTimeline, queryTraining } from "../db/repository";

type MealQueryResult = Awaited<ReturnType<typeof queryMeals>>;
type TrainingQueryResult = Awaited<ReturnType<typeof queryTraining>>;
type MeasurementQueryResult = Awaited<ReturnType<typeof queryMeasurements>>;
type TimelineQueryResult = Awaited<ReturnType<typeof queryTimeline>>;

const EXERCISE_FIELDS = [
  "exercise",
  "sets",
  "totalReps",
  "maxWeightKg",
  "volumeKg",
  "distanceMeters",
  "durationSeconds",
] as const;

export function mealQueryToolResult(result: MealQueryResult) {
  const full = result.detail === "full";
  return {
    summary: {
      mealCount: result.mealCount,
      totals: result.totals,
      dailyAverageCalories: result.dailyAverageCalories,
    },
    ...(result.days.length > 1
      ? {
          dayFields: ["date", "totals"],
          days: result.days.map((day) => [day.date, day.totals]),
        }
      : {}),
    mealFields: full
      ? ["ref", "occurredAt", "summary", "confidence", "totals", "items"]
      : ["occurredAt", "summary", "totals", "itemNames"],
    ...(full
      ? {
          itemFields: [
            "ref",
            "name",
            "quantity",
            "unit",
            "caloriesKcal",
            "proteinGrams",
            "carbsGrams",
            "fatGrams",
            "confidence",
            "nutritionSource",
          ],
        }
      : {}),
    meals: result.meals.map((meal) =>
      full
        ? [
            meal.ref,
            localDateTime(meal.occurredAt),
            meal.summary,
            meal.confidence,
            meal.totals,
            meal.items?.map((item) => [
              item.ref,
              item.name,
              item.quantity,
              item.unit,
              item.caloriesKcal,
              item.proteinGrams,
              item.carbsGrams,
              item.fatGrams,
              item.confidence,
              item.nutritionSource,
            ]) ?? [],
          ]
        : [localDateTime(meal.occurredAt), meal.summary, meal.totals, meal.itemNames],
    ),
    ...(result.comparison ? { comparison: result.comparison } : {}),
    ...morePage(result.page),
  };
}

export function trainingQueryToolResult(result: TrainingQueryResult) {
  const full = result.detail === "full";
  const { exercises, ...summary } = result.summary;
  return {
    summary,
    exerciseFields: EXERCISE_FIELDS,
    exercises: exercises.map(exerciseRow),
    ...(result.filters.length
      ? {
          filterFields: ["submittedName", "matched", "matchedBy", "candidates"],
          filters: result.filters.map((filter) => [
            filter.submittedName,
            filter.matched,
            filter.matchedBy,
            filter.candidates,
          ]),
        }
      : {}),
    sessionFields: full
      ? ["ref", "kind", "occurredAt", "summary", "exercises", "sets"]
      : ["kind", "occurredAt", "summary", "exercises"],
    ...(full
      ? {
          setFields: [
            "ref",
            "exercise",
            "originalName",
            "setNumber",
            "reps",
            "weightKg",
            "durationSeconds",
            "distanceMeters",
          ],
        }
      : {}),
    sessions: result.sessions.map((session) =>
      full
        ? [
            session.ref,
            session.kind,
            localDateTime(session.occurredAt),
            session.summary,
            session.exercises.map(exerciseRow),
            session.sets?.map((set) => [
              set.ref,
              set.exercise,
              set.originalName,
              set.setNumber,
              set.reps,
              set.weightKg,
              set.durationSeconds,
              set.distanceMeters,
            ]) ?? [],
          ]
        : [
            session.kind,
            localDateTime(session.occurredAt),
            session.summary,
            session.exercises.map(exerciseRow),
          ],
    ),
    ...(result.comparison ? { comparison: trainingSummary(result.comparison) } : {}),
    ...morePage(result.page),
  };
}

export function measurementQueryToolResult(result: MeasurementQueryResult) {
  const full = result.detail === "full";
  return {
    measurementFields: [
      "metric",
      "count",
      "firstValue",
      "firstUnit",
      "firstAt",
      "latestValue",
      "latestUnit",
      "latestAt",
      "change",
    ],
    measurements: result.summary.map(measurementSummaryRow),
    ...(full
      ? {
          recordFields: [
            "ref",
            "measurementRef",
            "occurredAt",
            "summary",
            "metric",
            "value",
            "unit",
          ],
          records: result.records.map((record) => [
            record.ref,
            record.measurementRef,
            localDateTime(record.occurredAt),
            record.summary,
            record.metric,
            record.value,
            record.unit,
          ]),
        }
      : {}),
    ...(result.comparison ? { comparison: result.comparison.map(measurementSummaryRow) } : {}),
    ...morePage(result.page),
  };
}

export function timelineQueryToolResult(result: TimelineQueryResult, detail: "compact" | "full") {
  const full = detail === "full";
  return {
    recordFields: full
      ? ["ref", "kind", "occurredAt", "summary", "confidence"]
      : ["kind", "occurredAt", "summary"],
    records: result.records.map((record) =>
      full
        ? [
            record.ref,
            record.kind,
            localDateTime(record.occurredAt),
            record.summary,
            record.confidence,
          ]
        : [record.kind, localDateTime(record.occurredAt), record.summary],
    ),
    counts: Object.fromEntries(Object.entries(result.counts).filter(([, count]) => count > 0)),
    ...morePage(result.page),
  };
}

function exerciseRow(exercise: TrainingQueryResult["summary"]["exercises"][number]) {
  return EXERCISE_FIELDS.map((field) => exercise[field]);
}

function trainingSummary(summary: NonNullable<TrainingQueryResult["comparison"]>) {
  const { exercises, ...totals } = summary;
  return { totals, exerciseFields: EXERCISE_FIELDS, exercises: exercises.map(exerciseRow) };
}

function measurementSummaryRow(summary: MeasurementQueryResult["summary"][number]) {
  return [
    summary.metric,
    summary.count,
    summary.first?.value ?? null,
    summary.first?.unit ?? null,
    summary.first ? localDateTime(summary.first.occurredAt) : null,
    summary.latest?.value ?? null,
    summary.latest?.unit ?? null,
    summary.latest ? localDateTime(summary.latest.occurredAt) : null,
    summary.change,
  ];
}

function morePage(page: { hasMore: boolean; nextOffset: number | null }) {
  return page.hasMore ? { nextOffset: page.nextOffset } : {};
}

function localDateTime(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
