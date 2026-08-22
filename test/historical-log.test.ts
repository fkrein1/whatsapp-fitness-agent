import { describe, expect, it } from "vitest";

import { splitHistoricalLog } from "../src/ingestion/historical-log";

describe("historical workout logs", () => {
  it("splits WhatsApp exports into dated blocks", () => {
    const blocks = splitHistoricalLog(`[07:59, 10/07/2026] Felipe Krein: Bench Press: 3x7 60kg
[13:11, 15/07/2026] Felipe Krein: RDL: 3x9 75kg`);

    expect(blocks).toEqual([
      {
        index: 0,
        occurredAt: "2026-07-10T07:59:00-03:00",
        text: "Bench Press: 3x7 60kg",
      },
      {
        index: 1,
        occurredAt: "2026-07-15T13:11:00-03:00",
        text: "RDL: 3x9 75kg",
      },
    ]);
  });

  it("does not classify an ordinary message as an import", () => {
    expect(splitHistoricalLog("Bench press 3x8 at 65 kg")).toEqual([]);
  });
});
