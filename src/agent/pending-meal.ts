import type { IngestionResult } from "../ingestion/types";
import type { PendingMealAction } from "./fitness-tool-schemas";

type PendingMealEdit = Extract<PendingMealAction, { action: "edit" }>;
type MealEvent = IngestionResult["events"][number];
type MealItem = MealEvent["mealItems"][number];

const NUTRITION_FIELDS = [
  "caloriesKcal",
  "proteinGrams",
  "carbsGrams",
  "fatGrams",
] as const satisfies readonly (keyof MealItem)[];

export function compactPendingMealContext(events: IngestionResult["events"], receivedAt: Date) {
  return `\n\nHá um rascunho de refeição pendente criado a partir da mensagem de ${receivedAt.toISOString()}. Use resolve_pending_meal para salvar, alterar ou descartar. Um pedido claro como "adiciona" salva sem nova confirmação. Ao editar, envie apenas as mudanças e use os índices abaixo. Preserve o restante.\n${compactMealSummary(events)}`;
}

export function compactMealSummary(events: IngestionResult["events"]) {
  const meals = events.map((event, eventIndex) => {
    const items = event.mealItems.map((item, itemIndex) => {
      const amount =
        item.quantity === null
          ? "porção não informada"
          : `${formatNumber(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`;
      return `  m${eventIndex}.i${itemIndex} | ${item.name} | ${amount} | ${formatNutrition(item)}`;
    });
    return [`m${eventIndex} | ${event.summary}`, ...items].join("\n");
  });
  const allItems = events.flatMap((event) => event.mealItems);

  return `${meals.join("\n")}\nTotal | ${formatNutritionTotals(allItems)}`;
}

export function applyPendingMealChanges(
  events: IngestionResult["events"],
  changes: PendingMealEdit["changes"],
) {
  const updated = structuredClone(events);

  for (const change of changes) {
    const event = getMealEvent(updated, change.eventIndex);

    if (change.type === "update_meal") {
      if (change.occurredAt !== undefined) event.occurredAt = change.occurredAt;
      if (change.summary !== undefined) event.summary = change.summary;
      continue;
    }

    if (change.type === "add_item") {
      event.mealItems.push(change.item);
      continue;
    }

    const item = event.mealItems[change.itemIndex];
    if (!item) {
      throw new Error(`Item pendente inexistente: m${change.eventIndex}.i${change.itemIndex}`);
    }

    if (change.type === "remove_item") {
      if (event.mealItems.length === 1) {
        throw new Error("Uma refeição pendente precisa manter pelo menos um item");
      }
      event.mealItems.splice(change.itemIndex, 1);
      continue;
    }

    const previousQuantity = item.quantity;
    const previousUnit = item.unit;
    const nutritionWasProvided = NUTRITION_FIELDS.some((field) => change[field] !== undefined);
    const quantityChanged = change.quantity !== undefined && change.quantity !== previousQuantity;
    const unitChanged = change.unit !== undefined && change.unit !== previousUnit;

    for (const field of [
      "name",
      "quantity",
      "unit",
      "caloriesKcal",
      "proteinGrams",
      "carbsGrams",
      "fatGrams",
    ] as const) {
      const value = change[field];
      if (value !== undefined) Object.assign(item, { [field]: value });
    }

    if (
      quantityChanged &&
      !unitChanged &&
      !nutritionWasProvided &&
      previousQuantity !== null &&
      previousQuantity > 0 &&
      item.quantity !== null
    ) {
      const ratio = item.quantity / previousQuantity;
      for (const field of NUTRITION_FIELDS) {
        const value = item[field];
        if (typeof value === "number") Object.assign(item, { [field]: round(value * ratio) });
      }
    }
  }

  return updated;
}

function getMealEvent(events: IngestionResult["events"], eventIndex: number) {
  const event = events[eventIndex];
  if (!event || event.kind !== "meal") {
    throw new Error(`Refeição pendente inexistente: m${eventIndex}`);
  }
  return event;
}

function formatNutrition(item: MealItem) {
  return `${formatMetric(item.caloriesKcal, "kcal")}; C ${formatMetric(item.carbsGrams, "g")}; G ${formatMetric(item.fatGrams, "g")}; P ${formatMetric(item.proteinGrams, "g")}`;
}

function formatNutritionTotals(items: MealItem[]) {
  return `${formatTotal(items, "caloriesKcal", "kcal")}; C ${formatTotal(items, "carbsGrams", "g")}; G ${formatTotal(items, "fatGrams", "g")}; P ${formatTotal(items, "proteinGrams", "g")}`;
}

function formatTotal(items: MealItem[], field: (typeof NUTRITION_FIELDS)[number], unit: string) {
  const values = items.map((item) => item[field]);
  if (values.some((value) => value === null)) return `? ${unit}`;
  return `${formatNumber(values.reduce<number>((sum, value) => sum + (value ?? 0), 0))} ${unit}`;
}

function formatMetric(value: number | null, unit: string) {
  return value === null ? `? ${unit}` : `${formatNumber(value)} ${unit}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
