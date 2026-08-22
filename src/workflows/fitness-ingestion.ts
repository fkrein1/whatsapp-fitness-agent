import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import { createDatabase } from "../db/client";
import {
  markSourceMessageFailed,
  markSourceMessagePartial,
  markSourceMessageProcessed,
  markSourceMessageProcessing,
  saveIngestion,
} from "../db/repository";
import type { AppBindings } from "../env";
import { extractFitnessData } from "../ingestion/agent";
import { splitHistoricalLog } from "../ingestion/historical-log";
import { sendWhatsAppText } from "../whatsapp/client";

export type FitnessIngestionParams = {
  sourceMessageId: string;
  providerMessageId: string;
  senderId: string;
  text: string;
  receivedAt: string;
};

export class FitnessIngestionWorkflow extends WorkflowEntrypoint<
  AppBindings,
  FitnessIngestionParams
> {
  async run(event: WorkflowEvent<FitnessIngestionParams>, step: WorkflowStep) {
    const payload = event.payload;
    const blocks = splitHistoricalLog(payload.text);
    const units = blocks.length
      ? blocks
      : [{ index: 0, occurredAt: payload.receivedAt, text: payload.text }];

    await step.do("mark processing", () =>
      markSourceMessageProcessing(createDatabase(this.env.DB), payload.sourceMessageId),
    );

    const failures: string[] = [];
    let imported = 0;
    for (const unit of units) {
      try {
        const result = await step.do(
          `extract block ${unit.index + 1}`,
          { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },
          () => extractFitnessData(unit.text, new Date(unit.occurredAt), this.env),
        );
        await step.do(`persist block ${unit.index + 1}`, () =>
          saveIngestion(
            createDatabase(this.env.DB),
            payload.sourceMessageId,
            result,
            new Date(unit.occurredAt),
            {
              externalKeyPrefix: `${payload.providerMessageId}:${unit.index}`,
              finalize: false,
            },
          ),
        );
        imported += 1;
      } catch (error) {
        failures.push(
          `Block ${unit.index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const statusText = failures.length
      ? `Imported ${imported} of ${units.length} workout blocks. ${failures.length} failed.`
      : `Imported ${imported} workout${imported === 1 ? "" : "s"}.`;

    await step.do("finalize source message", async () => {
      const db = createDatabase(this.env.DB);
      if (!imported) await markSourceMessageFailed(db, payload.sourceMessageId, failures.join(" "));
      else if (failures.length)
        await markSourceMessagePartial(db, payload.sourceMessageId, failures.join(" "));
      else await markSourceMessageProcessed(db, payload.sourceMessageId);
    });

    await step.do(
      "send result",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      () => sendWhatsAppText(payload.senderId, statusText, this.env),
    );

    return { imported, failed: failures.length, total: units.length };
  }
}
