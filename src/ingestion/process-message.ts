import { createDatabase } from "../db/client";
import {
  claimSourceMessage,
  getDailyCalories,
  getRecentEvents,
  getRecentWeights,
  markSourceMessageFailed,
  saveIngestion,
} from "../db/repository";
import type { AppBindings } from "../env";
import { downloadWhatsAppMedia, markMessageRead, sendWhatsAppText } from "../whatsapp/client";
import type { WhatsAppMessage } from "../whatsapp/types";
import { extractFitnessData, transcribeAudio } from "./agent";

export async function processMessage(message: WhatsAppMessage, env: AppBindings) {
  const db = createDatabase(env.DB);
  const receivedAt = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();
  const inputType = getInputType(message);
  if (!inputType) return;

  const sourceMessageId = await claimSourceMessage(db, {
    providerMessageId: message.id,
    senderId: message.from,
    inputType,
    text: message.text?.body ?? message.image?.caption ?? null,
    mediaId: message.image?.id ?? message.audio?.id ?? null,
    mimeType: message.image?.mime_type ?? message.audio?.mime_type ?? null,
    receivedAt,
  });
  if (!sourceMessageId) return;

  try {
    await markMessageRead(message.id, env);
  } catch (error) {
    console.warn("Failed to mark WhatsApp message as read", {
      messageId: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let reply: string;
  try {
    const input = await buildAgentInput(message, env);
    const result = await extractFitnessData(input, receivedAt, env);
    await saveIngestion(db, sourceMessageId, result, receivedAt);
    reply = await buildReply(result, db, receivedAt);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await markSourceMessageFailed(db, sourceMessageId, messageText);
    console.error("Failed to process WhatsApp message", {
      messageId: message.id,
      error: messageText,
    });
    return;
  }

  try {
    await sendWhatsAppText(message.from, reply, env);
  } catch (error) {
    console.warn("Fitness data saved but WhatsApp reply failed", {
      messageId: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function getInputType(message: WhatsAppMessage) {
  if (message.type === "text" && message.text?.body?.trim()) return "text" as const;
  if (message.type === "image" && message.image?.id) return "image" as const;
  if (message.type === "audio" && message.audio?.id) return "audio" as const;
  return null;
}

async function buildAgentInput(
  message: WhatsAppMessage,
  env: AppBindings,
): Promise<string | ResponseInput> {
  if (message.type === "text") return message.text?.body?.trim() ?? "";

  if (message.type === "audio" && message.audio) {
    const media = await downloadWhatsAppMedia(
      message.audio.id,
      message.audio.mime_type ?? "audio/ogg",
      env,
    );
    return transcribeAudio(media.bytes, env);
  }

  if (message.type === "image" && message.image) {
    const media = await downloadWhatsAppMedia(
      message.image.id,
      message.image.mime_type ?? "image/jpeg",
      env,
    );
    return [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              message.image.caption?.trim() ||
              "Log the food, workout, measurement, or other fitness information visible here.",
          },
          {
            type: "input_image",
            detail: "auto",
            image_url: `data:${media.mimeType};base64,${arrayBufferToBase64(media.bytes)}`,
          },
        ],
      },
    ];
  }

  throw new Error(`Unsupported WhatsApp message type: ${message.type}`);
}

async function buildReply(
  result: Awaited<ReturnType<typeof extractFitnessData>>,
  db: ReturnType<typeof createDatabase>,
  receivedAt: Date,
) {
  if (!result.query) return result.reply;

  if (result.query.type === "daily_calories") {
    const calories = await getDailyCalories(db, receivedAt);
    return `${result.reply}\nEstimated calories logged today: ${Math.round(calories)} kcal.`;
  }
  if (result.query.type === "recent_weight") {
    const weights = await getRecentWeights(db, result.query.days);
    if (!weights.length) return `${result.reply}\nNo weight entries found in that period.`;
    return `${result.reply}\n${weights
      .map(
        (weight) =>
          `${weight.occurredAt.toISOString().slice(0, 10)}: ${weight.value} ${weight.unit}`,
      )
      .join("\n")}`;
  }

  const events = await getRecentEvents(db, ["workout", "run"], result.query.days);
  if (!events.length) return `${result.reply}\nNo exercise entries found in that period.`;
  return `${result.reply}\n${events
    .map((event) => `${event.occurredAt.toISOString().slice(0, 10)}: ${event.summary}`)
    .join("\n")}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
