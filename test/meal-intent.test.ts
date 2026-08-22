import { describe, expect, it } from "vitest";

import {
  hasImmediateMealSaveIntent,
  isBarePendingMealSaveCommand,
} from "../src/ingestion/meal-intent";

describe("meal save intent", () => {
  it.each(["Adiciona esse iogurte", "salva pra hoje", "Registre isso", "add this yogurt"])(
    "recognizes a direct image-caption command: %s",
    (text) => expect(hasImmediateMealSaveIntent(text)).toBe(true),
  );

  it.each(["não adiciona", "quanto tem antes de adicionar?", "o que é isso?"])(
    "does not turn a non-command into a save: %s",
    (text) => expect(hasImmediateMealSaveIntent(text)).toBe(false),
  );

  it.each(["adiciona", "Salva isso", "pode adicionar", "anota aí", "save"])(
    "recognizes a bare pending-meal command: %s",
    (text) => expect(isBarePendingMealSaveCommand(text)).toBe(true),
  );

  it.each(["adiciona mais arroz", "salva amanhã", "não salva", "agora"])(
    "leaves edits and date changes to the agent: %s",
    (text) => expect(isBarePendingMealSaveCommand(text)).toBe(false),
  );
});
