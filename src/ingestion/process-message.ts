import { getAgentByName } from "agents";

import type { FitnessAgent } from "../agent/fitness-agent";
import type { WhatsAppTurn } from "../agent/whatsapp-turn";
import { createDatabase } from "../db/client";
import {
  claimSourceMessage,
  markSourceMessageFailed,
  recordAgentTurnEvent,
} from "../db/repository";
import type { AppBindings } from "../env";
import { markMessageRead, sendWhatsAppText } from "../whatsapp/client";
import type { WhatsAppMessage } from "../whatsapp/types";

export async function processMessage(message: WhatsAppMessage, env: AppBindings) {
  const inputType = getInputType(message);
  if (!inputType) return;

  const db = createDatabase(env.DB);
  const receivedAt = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();
  const text = message.text?.body?.trim() ?? message.image?.caption?.trim() ?? null;
  const mediaId = message.image?.id ?? message.audio?.id ?? null;
  const mimeType = message.image?.mime_type ?? message.audio?.mime_type ?? null;
  const sourceMessageId = await claimSourceMessage(db, {
    providerMessageId: message.id,
    senderId: message.from,
    inputType,
    text,
    mediaId,
    mimeType,
    receivedAt,
  });
  if (!sourceMessageId) return;
  await observeTurn(db, sourceMessageId, "message_claimed", { inputType });

  try {
    await markMessageRead(message.id, env, { typing: true });
    await observeTurn(db, sourceMessageId, "typing_started");
  } catch (error) {
    await observeTurn(db, sourceMessageId, "typing_failed", { error: getErrorMessage(error) });
  }

  const turn: WhatsAppTurn = {
    sourceMessageId,
    providerMessageId: message.id,
    senderId: message.from,
    inputType,
    text,
    mediaId,
    mimeType,
    receivedAt: receivedAt.toISOString(),
  };

  const startedAt = Date.now();
  try {
    await observeTurn(db, sourceMessageId, "agent_starting");
    const agent = await getAgentByName<AppBindings, FitnessAgent>(env.FITNESS_AGENT, message.from);
    const response = await agent.fetch(
      new Request("https://fitness-agent.internal/internal/whatsapp-turn", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_VERIFY_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(turn),
      }),
    );
    if (!response.ok) throw new Error(`Fitness agent rejected WhatsApp turn (${response.status})`);
    const acceptance = (await response.json()) as { accepted?: boolean; status?: string };
    await observeTurn(db, sourceMessageId, "agent_started", {
      accepted: acceptance.accepted ?? null,
      status: acceptance.status ?? null,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const errorText = getErrorMessage(error);
    await markSourceMessageFailed(db, sourceMessageId, errorText);
    await observeTurn(db, sourceMessageId, "agent_start_failed", {
      durationMs: Date.now() - startedAt,
      error: errorText,
    });
    console.error("Failed to start WhatsApp agent turn", {
      sourceMessageId,
      error: errorText,
    });
    try {
      await sendWhatsAppText(
        message.from,
        "Não consegui iniciar esse pedido. Envie a mensagem novamente.",
        env,
      );
    } catch (deliveryError) {
      console.error("Failed to send WhatsApp turn-start error", {
        sourceMessageId,
        error: getErrorMessage(deliveryError),
      });
    }
  }
}

function getInputType(message: WhatsAppMessage) {
  if (message.type === "text" && message.text?.body?.trim()) return "text" as const;
  if (message.type === "image" && message.image?.id) return "image" as const;
  if (message.type === "audio" && message.audio?.id) return "audio" as const;
  return null;
}

async function observeTurn(
  db: ReturnType<typeof createDatabase>,
  sourceMessageId: string,
  stage: string,
  details: Record<string, unknown> = {},
) {
  console.info("WhatsApp agent turn", { sourceMessageId, stage, ...details });
  try {
    await recordAgentTurnEvent(db, sourceMessageId, stage, details);
  } catch (error) {
    console.error("Failed to persist WhatsApp agent turn event", {
      sourceMessageId,
      stage,
      error: getErrorMessage(error),
    });
  }
}

function getErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
