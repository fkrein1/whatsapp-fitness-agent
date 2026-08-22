import { getAgentByName } from "agents";

import type { FitnessAgent } from "../agent/fitness-agent";
import { createDatabase } from "../db/client";
import {
  approveLatestMealProposal,
  claimSourceMessage,
  createMealProposal,
  getDailyCalories,
  getLatestPendingMealProposal,
  getRecentEvents,
  getRecentWeights,
  markSourceMessageFailed,
  markSourceMessagePartial,
  recordAgentTurnEvent,
  saveIngestion,
} from "../db/repository";
import type { AppBindings } from "../env";
import { downloadWhatsAppMedia, markMessageRead, sendWhatsAppText } from "../whatsapp/client";
import type { WhatsAppMessage } from "../whatsapp/types";
import { formatNutritionResearch, searchNutrition } from "../nutrition/brave";
import { extractFitnessData, planNutritionResearch, transcribeAudio } from "./agent";
import { hasImmediateMealSaveIntent, isBarePendingMealSaveCommand } from "./meal-intent";

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
  await observeTurn(db, sourceMessageId, "message_claimed", { inputType });

  try {
    await markMessageRead(message.id, env, { typing: true });
    await observeTurn(db, sourceMessageId, "typing_started");
  } catch (error) {
    await observeTurn(db, sourceMessageId, "typing_failed", {
      error: getErrorMessage(error),
    });
    console.warn("Failed to mark WhatsApp message as read", {
      sourceMessageId,
      error: getErrorMessage(error),
    });
  }

  const text = message.text?.body?.trim();

  if (text && isBarePendingMealSaveCommand(text)) {
    const pendingMeal = await getLatestPendingMealProposal(db, message.from, receivedAt);
    if (pendingMeal) {
      let saved: NonNullable<Awaited<ReturnType<typeof approveLatestMealProposal>>>;
      try {
        const result = await approveLatestMealProposal(
          db,
          message.from,
          sourceMessageId,
          receivedAt,
        );
        if (!result) throw new Error("Pending meal was already resolved");
        saved = result;
        await observeTurn(db, sourceMessageId, "pending_meal_saved_directly", {
          proposalSourceMessageId: pendingMeal.sourceMessageId,
          eventCount: saved.payload.events.length,
        });
      } catch (error) {
        const errorText = getErrorMessage(error);
        await markSourceMessageFailed(db, sourceMessageId, errorText);
        await observeTurn(db, sourceMessageId, "pending_meal_direct_save_failed", {
          error: errorText,
        });
        console.error("Failed to save pending meal directly", {
          sourceMessageId,
          error: errorText,
        });
        try {
          await sendWhatsAppText(
            message.from,
            "Não consegui salvar essa refeição. Tenta de novo daqui a pouco.",
            env,
          );
        } catch (deliveryError) {
          console.error("Failed to send pending-meal error response", {
            sourceMessageId,
            error: getErrorMessage(deliveryError),
          });
        }
        return;
      }

      try {
        await sendWhatsAppText(
          message.from,
          buildMealPhotoReply(saved.payload, { savedAt: receivedAt }),
          env,
        );
        await observeTurn(db, sourceMessageId, "pending_meal_reply_sent");
      } catch (error) {
        const errorText = getErrorMessage(error);
        await markSourceMessagePartial(db, sourceMessageId, errorText);
        await observeTurn(db, sourceMessageId, "pending_meal_reply_failed", {
          error: errorText,
        });
        console.error("Pending meal saved but reply delivery failed", {
          sourceMessageId,
          error: errorText,
        });
      }
      return;
    }
  }

  if (text) {
    const startedAt = Date.now();
    try {
      await observeTurn(db, sourceMessageId, "agent_starting");
      const agent = await getAgentByName<AppBindings, FitnessAgent>(
        env.FITNESS_AGENT,
        message.from,
      );
      const response = await agent.fetch(
        new Request("https://fitness-agent.internal/internal/whatsapp-turn", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_VERIFY_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceMessageId,
            providerMessageId: message.id,
            senderId: message.from,
            text,
            receivedAt: receivedAt.toISOString(),
          }),
        }),
      );
      if (!response.ok) {
        throw new Error(`Fitness agent rejected WhatsApp turn (${response.status})`);
      }
      const acceptance = (await response.json()) as {
        accepted?: boolean;
        status?: string;
      };
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
    return;
  }

  let reply: string;
  try {
    const input = await buildAgentInput(message, env);
    const nutritionResearch = await getNutritionResearch(input, receivedAt, message.id, env);
    const result = await extractFitnessData(input, receivedAt, env, nutritionResearch);
    if (message.type === "image" && hasMeal(result)) {
      if (hasImmediateMealSaveIntent(message.image?.caption)) {
        await saveIngestion(db, sourceMessageId, result, receivedAt);
        await observeTurn(db, sourceMessageId, "image_meal_saved_directly", {
          eventCount: result.events.length,
          itemCount: result.events.reduce((total, event) => total + event.mealItems.length, 0),
        });
        reply = buildMealPhotoReply(result, { savedAt: receivedAt });
      } else {
        await createMealProposal(db, sourceMessageId, message.from, result);
        await observeTurn(db, sourceMessageId, "meal_proposal_created", {
          eventCount: result.events.length,
          itemCount: result.events.reduce((total, event) => total + event.mealItems.length, 0),
        });
        reply = buildMealPhotoReply(result);
      }
    } else {
      await saveIngestion(db, sourceMessageId, result, receivedAt);
      reply = await buildReply(result, db, receivedAt);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await markSourceMessageFailed(db, sourceMessageId, messageText);
    console.error("Failed to process WhatsApp message", {
      messageId: message.id,
      error: messageText,
    });
    try {
      await sendWhatsAppText(
        message.from,
        "Não consegui analisar essa mensagem. Tente enviar novamente.",
        env,
      );
    } catch (deliveryError) {
      console.error("Failed to send WhatsApp processing error", {
        messageId: message.id,
        error: getErrorMessage(deliveryError),
      });
    }
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

async function getNutritionResearch(
  input: string | ResponseInput,
  receivedAt: Date,
  messageId: string,
  env: AppBindings,
) {
  try {
    const queries = await planNutritionResearch(input, receivedAt, env);
    if (!queries.length) return null;
    return formatNutritionResearch(await searchNutrition(queries, env));
  } catch (error) {
    console.warn("Nutrition research failed; using model estimate", {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
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
              "Analise o alimento, treino, medida ou outra informação de saúde visível. Se for comida, separe cada componente do prato.",
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

function hasMeal(result: Awaited<ReturnType<typeof extractFitnessData>>) {
  return result.events.some((event) => event.kind === "meal" && event.mealItems.length > 0);
}

function buildMealPhotoReply(
  result: Awaited<ReturnType<typeof extractFitnessData>>,
  options: { savedAt?: Date } = {},
) {
  const items = result.events.flatMap((event) => event.mealItems);
  const estimated = items.some((item) => item.confidence < 0.9);
  const approximation = estimated ? "~" : "";
  const lines = items.map((item) => {
    const quantity =
      item.quantity === null
        ? "porção incerta"
        : `${approximation}${formatNumber(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`;
    const calories =
      item.caloriesKcal === null
        ? "calorias incertas"
        : `${approximation}${formatNumber(item.caloriesKcal)} kcal`;
    return `• ${item.name}, ${quantity}: ${calories}`;
  });

  const totalCalories = sumKnown(items.map((item) => item.caloriesKcal));
  const totalProtein = sumKnown(items.map((item) => item.proteinGrams));
  const totalCarbs = sumKnown(items.map((item) => item.carbsGrams));
  const totalFat = sumKnown(items.map((item) => item.fatGrams));
  const totals = [
    totalCalories === null ? null : `${approximation}${formatNumber(totalCalories)} kcal`,
    totalCarbs === null ? null : `C ${formatNumber(totalCarbs)} g`,
    totalFat === null ? null : `G ${formatNumber(totalFat)} g`,
    totalProtein === null ? null : `P ${formatNumber(totalProtein)} g`,
  ].filter(Boolean);

  return [
    options.savedAt
      ? `Salvei em ${new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
        }).format(options.savedAt)}:`
      : "Minha leitura da foto:",
    ...lines,
    totals.length
      ? `${estimated ? "Total estimado" : "Total"}: ${totals.join(" | ")}`
      : "Total ainda incerto.",
    ...(options.savedAt ? [] : ["Ainda não salvei."]),
  ].join("\n");
}

function sumKnown(values: (number | null)[]) {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + value!, 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
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
