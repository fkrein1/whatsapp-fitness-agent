import { Think } from "@cloudflare/think";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  ChatErrorContext,
  ChatResponseResult,
  PrepareStepContext,
  StepContext,
  ToolCallContext,
  ToolCallResultContext,
  ThinkSubmissionInspection,
  TurnConfig,
  TurnContext,
} from "@cloudflare/think";
import { tool } from "ai";
import type { ToolSet, UIMessage } from "ai";
import { createGatewayProvider } from "workers-ai-provider/gateway";
import { z } from "zod";

import { createDatabase } from "../db/client";
import {
  approveLatestMealProposal,
  cancelLatestMealProposal,
  getLatestPendingMealProposal,
  getSourceMessageStatus,
  manageRecords,
  markSourceMessageFailed,
  markSourceMessagePartial,
  markSourceMessageProcessing,
  markSourceMessageProcessed,
  queryMeals,
  queryMeasurements,
  queryTimeline,
  queryTraining,
  recordAgentTurnEvent,
  saveIngestion,
  updateLatestMealProposal,
} from "../db/repository";
import type { IngestionResult } from "../ingestion/types";
import { searchNutrition } from "../nutrition/brave";
import { sendWhatsAppText } from "../whatsapp/client";
import {
  logEventsInputSchema,
  manageRecordsInputSchema,
  mealQuerySchema,
  measurementQuerySchema,
  pendingMealActionSchema,
  timelineQuerySchema,
  trainingQuerySchema,
} from "./fitness-tool-schemas";
import type { LogEventsInput } from "./fitness-tool-schemas";
import {
  CONVERSATION_PREVIOUS_USER_TURNS,
  jsonSafeToolOutput,
  recentConversationMessages,
} from "./model-context";

const whatsappTurnSchema = z.object({
  sourceMessageId: z.string().uuid(),
  providerMessageId: z.string().min(1),
  senderId: z.string().min(1),
  text: z.string().min(1),
  receivedAt: z.string().datetime(),
});

type WhatsAppTurn = z.infer<typeof whatsappTurnSchema>;

const CORE_TOOL_NAMES = [
  "log_events",
  "research_nutrition",
  "query_meals",
  "query_training",
  "query_measurements",
  "query_timeline",
  "manage_records",
];

const whatsappTurnMetadataSchema = whatsappTurnSchema.omit({ text: true }).extend({
  sourceMessageIds: z.array(z.string().uuid()).min(1).max(8),
  providerMessageIds: z.array(z.string().min(1)).min(1).max(8),
  channel: z.literal("whatsapp"),
});

type WhatsAppTurnMetadata = z.infer<typeof whatsappTurnMetadataSchema>;

type PendingBurstRow = {
  source_message_id: string;
  provider_message_id: string;
  sender_id: string;
  text: string;
  received_at: string;
};

const WHATSAPP_BURST_QUIET_SECONDS = 1.5;
const WHATSAPP_BURST_LIMIT = 8;

export class FitnessAgent extends Think<Env> {
  workspaceBash = false;
  includeMcpTools = false;
  sendReasoning = false;
  maxSteps = 12;
  chatStreamStallTimeoutMs = 60_000;
  chatRecovery = {
    maxAttempts: 5,
    noProgressTimeoutMs: 180_000,
    maxRecoveryWork: 250,
    terminalMessage: "Tive um problema ao concluir essa resposta. Pode tentar novamente?",
  };

  getModel() {
    const openai = createGatewayProvider(createOpenAI, {
      binding: this.env.AI,
      gateway: "default",
    });
    return openai.responses("gpt-5.6-luna");
  }

  getSystemPrompt() {
    return `Você é o parceiro de treino e alimentação do Felipe. Converse de forma natural e curta, como no WhatsApp.

O banco é o diário. Consulte-o quando a resposta depender do histórico. Registre, corrija ou remova dados quando Felipe pedir. Interprete datas no fuso America/Sao_Paulo e use quilogramas por padrão.

Escolha consultas compactas normalmente. Use a visão completa quando ele pedir detalhes, itens, séries ou fontes. Para comparações, consulte os períodos necessários e deixe as ferramentas calcularem totais e tendências.

Trate mensagens enviadas em sequência como uma única fala. A intenção mais recente pode completar ou corrigir as anteriores. Aja quando o pedido estiver claro. Pergunte somente quando mais de uma interpretação mudaria o registro.

Responda em português brasileiro, salvo pedido contrário. Seja próximo e neutro sobre alimentação, peso e treinos. Identifique estimativas. Mantenha referências internas fora da resposta e não faça diagnóstico médico.`;
  }

  async beforeTurn(context: TurnContext): Promise<TurnConfig> {
    const turn = this.getWhatsAppTurnMetadata();
    const db = createDatabase(this.env.DB);
    let pendingMealContext = "";
    let hasPendingMeal = false;
    const currentBurstSize = turn?.sourceMessageIds.length ?? 1;
    const modelMessages = recentConversationMessages(
      context.messages,
      CONVERSATION_PREVIOUS_USER_TURNS + currentBurstSize,
    );
    if (turn) {
      await Promise.all(turn.sourceMessageIds.map((id) => markSourceMessageProcessing(db, id)));
      await this.observeTurn("turn_started", {
        burstSize: turn.sourceMessageIds.length,
        storedMessageCount: context.messages.length,
        modelMessageCount: modelMessages.length,
        model: "openai/gpt-5.6-luna",
        transport: "responses",
      });
      const pendingMeal = await getLatestPendingMealProposal(db, turn.senderId, new Date());
      if (pendingMeal) {
        hasPendingMeal = true;
        pendingMealContext = `\n\nHá uma refeição pendente. Use resolve_pending_meal para salvar, editar ou descartar conforme o pedido atual. Um pedido claro como "adiciona" salva de imediato. Preserve os itens que Felipe não corrigiu.\n${JSON.stringify(pendingMeal.payload.events)}`;
      }
    }
    const trustedContext = turn
      ? `\n\nContexto confiável da requisição:\nEsta rodada contém ${turn.sourceMessageIds.length} mensagem(ns) nova(s) recebida(s) em sequência. A mais recente chegou em ${turn.receivedAt}. Interprete datas relativas no fuso America/Sao_Paulo.`
      : "";
    return {
      instructions: `${this.getSystemPrompt()}${trustedContext}${pendingMealContext}`,
      messages: modelMessages,
      maxOutputTokens: 1500,
      maxRetries: 1,
      maxSteps: 12,
      activeTools: hasPendingMeal ? [...CORE_TOOL_NAMES, "resolve_pending_meal"] : CORE_TOOL_NAMES,
      providerOptions: {
        openai: {
          reasoningEffort: "high",
          store: false,
        },
      },
      ...(turn
        ? {
            headers: {
              "cf-aig-metadata": JSON.stringify({
                source_message_id: turn.sourceMessageId,
                source_message_count: turn.sourceMessageIds.length,
                channel: turn.channel,
              }),
            },
          }
        : {}),
    };
  }

  async beforeStep(context: PrepareStepContext) {
    const turn = this.getWhatsAppTurnMetadata();
    if (!turn) return {};
    const statuses = await this.getTurnStatuses(turn);
    await this.observeTurn("step_started", {
      stepNumber: context.stepNumber,
      sourceStatuses: statuses.map((source) => source?.status ?? "missing"),
    });
    return {};
  }

  async beforeToolCall(context: ToolCallContext) {
    await this.observeTurn("tool_started", {
      toolName: context.toolName,
      toolCallId: context.toolCallId,
      stepNumber: context.stepNumber ?? null,
    });
  }

  async afterToolCall(context: ToolCallResultContext) {
    await this.observeTurn("tool_finished", {
      toolName: context.toolName,
      toolCallId: context.toolCallId,
      stepNumber: context.stepNumber ?? null,
      durationMs: context.durationMs,
      success: context.success,
      ...(context.success ? {} : { error: getErrorMessage(context.error) }),
    });
  }

  async onStepFinish(context: StepContext) {
    await this.observeTurn("step_finished", {
      stepNumber: context.stepNumber,
      finishReason: context.finishReason,
      toolNames: context.toolCalls.map((call) => call.toolName),
      inputTokens: context.usage.inputTokens ?? null,
      outputTokens: context.usage.outputTokens ?? null,
      totalTokens: context.usage.totalTokens ?? null,
    });
  }

  getTools(): ToolSet {
    return {
      log_events: tool({
        description:
          "Log meals, workouts, runs, measurements, or notes from the current WhatsApp turn. Use every distinct event the user clearly asked to save. Exercise aliases are normalized automatically. Research branded nutrition first unless the label values came from the user or image.",
        inputSchema: logEventsInputSchema,
        execute: async ({ events }) => {
          const turn = this.requireWhatsAppTurnMetadata();
          const normalizedEvents = events.map(normalizeLogEvent);
          const result = await saveIngestion(
            createDatabase(this.env.DB),
            turn.sourceMessageId,
            { events: normalizedEvents, query: null, reply: "Recorded." },
            new Date(turn.receivedAt),
            { externalKeyPrefix: turn.sourceMessageId },
          );
          await this.markTurnProcessed(turn, { except: turn.sourceMessageId });
          return {
            saved: true,
            eventCount: normalizedEvents.length,
            insertedEvents: result.insertedEvents,
            reusedEvents: result.reusedEvents,
            receipt: normalizedEvents.map((event) => ({
              kind: event.kind,
              occurredAt: event.occurredAt ?? turn.receivedAt,
              summary: event.summary,
              exerciseSetCount: event.exerciseSets.length,
              mealItemCount: event.mealItems.length,
              measurementCount: event.measurements.length,
            })),
          };
        },
      }),
      research_nutrition: tool({
        description:
          "Research calories and macros for branded, packaged, restaurant, or menu foods in Brazil before logging them. Skip this when Felipe supplied label values. Prefer queries containing product, serving size, and informação nutricional.",
        inputSchema: z.object({
          queries: z
            .array(z.string().min(1))
            .min(1)
            .max(3)
            .describe("Up to three concise Brazilian Portuguese nutrition searches."),
        }),
        execute: ({ queries }) => searchNutrition(queries, this.env),
      }),
      query_meals: tool({
        description:
          "Query meals over any inclusive date range. Compact returns meal names, foods, calories, daily totals, and averages. Full adds portions, macros, confidence, nutrition sources, and record references for corrections.",
        inputSchema: mealQuerySchema,
        execute: async (input) =>
          jsonSafeToolOutput(await queryMeals(createDatabase(this.env.DB), input)),
      }),
      query_training: tool({
        description:
          "Query workouts, runs, exercise history, progression, volume, best weights, distance, and duration over any inclusive date range. Compact summarizes sessions and exercises. Full returns every set and record references for corrections.",
        inputSchema: trainingQuerySchema,
        execute: async (input) =>
          jsonSafeToolOutput(await queryTraining(createDatabase(this.env.DB), input)),
      }),
      query_measurements: tool({
        description:
          "Query weight, body fat, waist, or other body measurements over any inclusive date range. Compact returns first, latest, and change. Full returns every measurement and references for corrections.",
        inputSchema: measurementQuerySchema,
        execute: async (input) =>
          jsonSafeToolOutput(await queryMeasurements(createDatabase(this.env.DB), input)),
      }),
      query_timeline: tool({
        description:
          "Query the mixed health diary over any inclusive date range. Use when the user asks what was logged, what happened on a date, or for several record types together. Returns chronological records and references.",
        inputSchema: timelineQuerySchema,
        execute: async (input) =>
          jsonSafeToolOutput(await queryTimeline(createDatabase(this.env.DB), input)),
      }),
      manage_records: tool({
        description:
          "Correct or soft-delete records that Felipe explicitly identified. Query first to obtain exact references. Apply a clear correction directly. When several records could match, query them and ask one short question instead of guessing.",
        inputSchema: manageRecordsInputSchema,
        execute: async (input) => {
          const turn = this.requireWhatsAppTurnMetadata();
          return manageRecords(createDatabase(this.env.DB), turn.sourceMessageId, input);
        },
      }),
      resolve_pending_meal: tool({
        description:
          "Resolve the currently pending meal photo. Save on a clear instruction such as adiciona, edit only the fields Felipe corrected, or discard when he asks. Do not request another confirmation after a clear save instruction.",
        inputSchema: pendingMealActionSchema,
        execute: async (input) => {
          const turn = this.requireWhatsAppTurnMetadata();
          const db = createDatabase(this.env.DB);
          if (input.action === "save") {
            const result = await approveLatestMealProposal(
              db,
              turn.senderId,
              turn.sourceMessageId,
              new Date(turn.receivedAt),
            );
            if (!result) throw new Error("Não há proposta de refeição pendente");
            await this.markTurnProcessed(turn, { except: turn.sourceMessageId });
            return {
              action: "saved",
              insertedEvents: result.insertedEvents,
              reusedEvents: result.reusedEvents,
            };
          }
          if (input.action === "discard") {
            const discarded = await cancelLatestMealProposal(
              db,
              turn.senderId,
              turn.sourceMessageId,
              new Date(turn.receivedAt),
            );
            if (!discarded) throw new Error("Não há proposta de refeição pendente");
            await this.markTurnProcessed(turn, { except: turn.sourceMessageId });
            return { action: "discarded" };
          }
          const events = input.events.map(normalizeLogEvent);
          const updated = await updateLatestMealProposal(
            db,
            turn.senderId,
            events,
            new Date(turn.receivedAt),
          );
          if (!updated) throw new Error("Não há proposta de refeição pendente");
          if (input.saveNow) {
            const result = await approveLatestMealProposal(
              db,
              turn.senderId,
              turn.sourceMessageId,
              new Date(turn.receivedAt),
            );
            if (!result) throw new Error("Não foi possível salvar a proposta atualizada");
            await this.markTurnProcessed(turn, { except: turn.sourceMessageId });
            return { action: "edited_and_saved", events: updated.events };
          }
          await this.markTurnProcessed(turn);
          return { action: "edited", events: updated.events };
        },
      }),
    };
  }

  async onRequest(request: Request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/internal/whatsapp-turn") {
      return super.onRequest(request);
    }
    if (request.headers.get("Authorization") !== `Bearer ${this.env.WHATSAPP_VERIFY_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const input = whatsappTurnSchema.parse(await request.json());
    await this.enqueueWhatsAppBurst(input);
    return Response.json({ accepted: true, status: "debouncing" }, { status: 202 });
  }

  private ensureWhatsAppBurstStorage() {
    void this.sql`
      CREATE TABLE IF NOT EXISTS cf_whatsapp_burst_messages (
        provider_message_id TEXT PRIMARY KEY,
        source_message_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        text TEXT NOT NULL,
        received_at TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
    void this.sql`
      CREATE TABLE IF NOT EXISTS cf_whatsapp_burst_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        generation TEXT NOT NULL
      )
    `;
  }

  private async enqueueWhatsAppBurst(input: WhatsAppTurn) {
    this.ensureWhatsAppBurstStorage();
    void this.sql`
      INSERT OR IGNORE INTO cf_whatsapp_burst_messages (
        provider_message_id, source_message_id, sender_id, text, received_at, created_at
      ) VALUES (
        ${input.providerMessageId}, ${input.sourceMessageId}, ${input.senderId},
        ${input.text}, ${input.receivedAt}, ${Date.now()}
      )
    `;
    const generation = crypto.randomUUID();
    void this.sql`
      INSERT INTO cf_whatsapp_burst_state (singleton, generation)
      VALUES (1, ${generation})
      ON CONFLICT(singleton) DO UPDATE SET generation = excluded.generation
    `;
    await this.observeTurnForId(input.sourceMessageId, "burst_buffered", {
      quietPeriodMs: WHATSAPP_BURST_QUIET_SECONDS * 1000,
    });
    await this.schedule(
      WHATSAPP_BURST_QUIET_SECONDS,
      "flushWhatsAppBurst",
      { generation },
      {
        retry: { maxAttempts: 3 },
      },
    );
  }

  async flushWhatsAppBurst(payload: unknown) {
    const parsed = z.object({ generation: z.string().uuid() }).safeParse(payload);
    if (!parsed.success) throw new Error("Invalid WhatsApp burst payload");
    this.ensureWhatsAppBurstStorage();
    const state = this.sql<{ generation: string }>`
      SELECT generation FROM cf_whatsapp_burst_state WHERE singleton = 1
    `[0];
    if (!state || state.generation !== parsed.data.generation) return;

    const rows = this.sql<PendingBurstRow>`
      SELECT source_message_id, provider_message_id, sender_id, text, received_at
      FROM cf_whatsapp_burst_messages
      ORDER BY received_at ASC, created_at ASC
      LIMIT ${WHATSAPP_BURST_LIMIT}
    `;
    if (!rows.length) return;

    const latest = rows.at(-1)!;
    const metadata: WhatsAppTurnMetadata = {
      sourceMessageId: latest.source_message_id,
      providerMessageId: latest.provider_message_id,
      sourceMessageIds: rows.map((row) => row.source_message_id),
      providerMessageIds: rows.map((row) => row.provider_message_id),
      senderId: latest.sender_id,
      receivedAt: latest.received_at,
      channel: "whatsapp",
    };
    const messages: UIMessage[] = rows.map((row) => ({
      id: row.provider_message_id,
      role: "user",
      parts: [{ type: "text", text: row.text }],
      metadata: { turnMetadata: metadata },
    }));
    const submission = await this.submitMessages(messages, {
      idempotencyKey: `whatsapp-burst:${parsed.data.generation}`,
      metadata,
    });

    for (const row of rows) {
      void this.sql`
        DELETE FROM cf_whatsapp_burst_messages
        WHERE provider_message_id = ${row.provider_message_id}
      `;
    }
    void this.sql`
      DELETE FROM cf_whatsapp_burst_state
      WHERE singleton = 1 AND generation = ${parsed.data.generation}
    `;
    await this.observeTurnFor(metadata, "burst_submitted", {
      burstSize: rows.length,
      submissionId: submission.submissionId,
      accepted: submission.accepted,
      status: submission.status,
    });

    const remaining = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM cf_whatsapp_burst_messages
    `[0]?.count;
    if (remaining) {
      const generation = crypto.randomUUID();
      void this.sql`
        INSERT INTO cf_whatsapp_burst_state (singleton, generation)
        VALUES (1, ${generation})
        ON CONFLICT(singleton) DO UPDATE SET generation = excluded.generation
      `;
      await this.schedule(
        WHATSAPP_BURST_QUIET_SECONDS,
        "flushWhatsAppBurst",
        { generation },
        {
          retry: { maxAttempts: 3 },
        },
      );
    }
  }

  async onChatResponse(result: ChatResponseResult) {
    if (result.status !== "completed") return;
    const turn = this.getWhatsAppTurnMetadata();
    if (!turn) return;
    await this.observeTurn("response_ready");

    const db = createDatabase(this.env.DB);
    await this.markTurnProcessed(turn);

    const text = result.message.parts
      .filter(
        (part): part is Extract<(typeof result.message.parts)[number], { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    try {
      await this.observeTurn("reply_sending");
      await sendWhatsAppText(turn.senderId, text || "Concluído.", this.env);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      await Promise.all(
        turn.sourceMessageIds.map((id) => markSourceMessagePartial(db, id, errorText)),
      );
      await this.observeTurn("reply_failed", { error: errorText });
      console.error("Fitness data handled but WhatsApp reply delivery failed", {
        sourceMessageId: turn.sourceMessageId,
        error: errorText,
      });
      return;
    }
    await this.observeTurn("reply_sent");
  }

  onChatError(error: unknown, context?: ChatErrorContext) {
    const turn = this.getWhatsAppTurnMetadata();
    console.error("Fitness agent turn failed", {
      requestId: context?.requestId,
      stage: context?.stage,
      sourceMessageId: turn?.sourceMessageId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (turn) {
      this.ctx.waitUntil(
        this.observeTurnFor(turn, "chat_error", {
          requestId: context?.requestId ?? null,
          stage: context?.stage ?? null,
          error: getErrorMessage(error),
        }),
      );
    }
    return error;
  }

  async onSubmissionStatus(submission: ThinkSubmissionInspection) {
    if (
      submission.status !== "error" &&
      submission.status !== "aborted" &&
      submission.status !== "skipped"
    )
      return;
    const parsed = whatsappTurnMetadataSchema.safeParse(submission.metadata);
    if (!parsed.success) return;
    await this.handleWhatsAppTurnFailure(
      parsed.data,
      submission.error ?? `Submission ended with status ${submission.status}`,
    );
  }

  private async handleWhatsAppTurnFailure(turn: WhatsAppTurnMetadata, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const db = createDatabase(this.env.DB);
    const sources = await this.getTurnStatuses(turn);
    if (sources.every((source) => source?.status === "failed" || source?.status === "partial"))
      return;
    await Promise.all(
      turn.sourceMessageIds.map((id, index) =>
        sources[index]?.status === "processed"
          ? markSourceMessagePartial(db, id, message)
          : markSourceMessageFailed(db, id, message),
      ),
    );
    await this.observeTurnFor(turn, "failure_recorded", {
      sourceStatuses: sources.map((source) => source?.status ?? "missing"),
      error: getErrorMessage(error),
    });
    try {
      await sendWhatsAppText(
        turn.senderId,
        "Tive um problema ao processar isso. Envie a mensagem novamente.",
        this.env,
      );
    } catch (deliveryError) {
      console.error("Failed to send WhatsApp agent error response", {
        sourceMessageId: turn.sourceMessageId,
        error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
      });
    }
  }

  private getWhatsAppTurnMetadata() {
    const parsed = whatsappTurnMetadataSchema.safeParse(this.activeTurnMetadata);
    return parsed.success ? parsed.data : null;
  }

  private requireWhatsAppTurnMetadata() {
    const turn = this.getWhatsAppTurnMetadata();
    if (!turn) throw new Error("Missing trusted WhatsApp turn metadata");
    return turn;
  }

  private async observeTurn(stage: string, details: Record<string, unknown> = {}) {
    const turn = this.getWhatsAppTurnMetadata();
    if (!turn) return;
    await this.observeTurnFor(turn, stage, details);
  }

  private async observeTurnFor(
    turn: WhatsAppTurnMetadata,
    stage: string,
    details: Record<string, unknown> = {},
  ) {
    await Promise.all(
      turn.sourceMessageIds.map((id) =>
        this.observeTurnForId(id, stage, {
          ...details,
          burstSize: turn.sourceMessageIds.length,
          primarySourceMessageId: turn.sourceMessageId,
        }),
      ),
    );
  }

  private getTurnStatuses(turn: WhatsAppTurnMetadata) {
    const db = createDatabase(this.env.DB);
    return Promise.all(turn.sourceMessageIds.map((id) => getSourceMessageStatus(db, id)));
  }

  private async markTurnProcessed(turn: WhatsAppTurnMetadata, options: { except?: string } = {}) {
    const db = createDatabase(this.env.DB);
    await Promise.all(
      turn.sourceMessageIds
        .filter((id) => id !== options.except)
        .map((id) => markSourceMessageProcessed(db, id)),
    );
  }

  private async observeTurnForId(
    sourceMessageId: string,
    stage: string,
    details: Record<string, unknown> = {},
  ) {
    console.info("Fitness agent turn", { sourceMessageId, stage, ...details });
    try {
      await recordAgentTurnEvent(createDatabase(this.env.DB), sourceMessageId, stage, details);
    } catch (error) {
      console.error("Failed to persist fitness agent turn event", {
        sourceMessageId,
        stage,
        error: getErrorMessage(error),
      });
    }
  }
}

function normalizeLogEvent(
  event: LogEventsInput["events"][number],
): IngestionResult["events"][number] {
  const base = {
    kind: event.kind,
    occurredAt: event.occurredAt,
    summary: event.summary,
    confidence: event.confidence,
    mealItems: [],
    exerciseSets: [],
    measurements: [],
  } satisfies IngestionResult["events"][number];

  if (event.kind === "meal") return { ...base, mealItems: event.items };
  if (event.kind === "workout") return { ...base, exerciseSets: event.sets };
  if (event.kind === "measurement") return { ...base, measurements: event.measurements };
  if (event.kind === "run") {
    return {
      ...base,
      exerciseSets:
        event.distanceMeters === null && event.durationSeconds === null
          ? []
          : [
              {
                exercise: "Run",
                setNumber: 1,
                reps: null,
                weightKg: null,
                durationSeconds: event.durationSeconds,
                distanceMeters: event.distanceMeters,
              },
            ],
    };
  }
  return base;
}

function getErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
