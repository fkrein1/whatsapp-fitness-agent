import { describe, expect, it } from "vitest";

import { cleanExerciseName, normalizeExerciseKey } from "../src/exercises/normalize";

describe("exercise lookup keys", () => {
  it.each([
    ["RDL", "rdl"],
    ["Romanian Deadlift (RDL)", "romanian deadlift rdl"],
    ["Single-Leg Curl", "single leg curl"],
    ["Elevação Lateral", "elevacao lateral"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeExerciseKey(input)).toBe(expected);
  });

  it("preserves an unknown trimmed exercise", () => {
    expect(cleanExerciseName("  Sissy   Squat  ")).toBe("Sissy Squat");
  });
});
