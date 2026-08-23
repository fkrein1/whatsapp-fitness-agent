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
  createMealProposal,
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
import { prepareWhatsAppParts } from "../ingestion/media";
import { searchNutrition } from "../nutrition/brave";
import { sendWhatsAppText } from "../whatsapp/client";
import {
  logEventsInputSchema,
  manageRecordsInputSchema,
  mealQuerySchema,
  measurementQuerySchema,
  pendingMealActionSchema,
  proposeMealInputSchema,
  timelineQuerySchema,
  trainingQuerySchema,
} from "./fitness-tool-schemas";
import type { LogEventsInput } from "./fitness-tool-schemas";
import {
  CONVERSATION_PREVIOUS_USER_TURNS,
  jsonSafeToolOutput,
  recentConversationMessages,
} from "./model-context";
import { whatsappInputTypeSchema, whatsappTurnSchema, type WhatsAppTurn } from "./whatsapp-turn";

const CORE_TOOL_NAMES = [
  "log_events",
  "propose_meal",
  "research_nutrition",
  "query_meals",
  "query_training",
  "query_measurements",
  "query_timeline",
  "manage_records",
];

const whatsappTurnMetadataSchema = z.object({
  sourceMessageId: z.string().uuid(),
  providerMessageId: z.string().min(1),
  sourceMessageIds: z.array(z.string().uuid()).min(1).max(8),
  providerMessageIds: z.array(z.string().min(1)).min(1).max(8),
  inputTypes: z.array(whatsappInputTypeSchema).min(1).max(8),
  senderId: z.string().min(1),
  receivedAt: z.string().datetime(),
  channel: z.literal("whatsapp"),
});

type WhatsAppTurnMetadata = z.infer<typeof whatsappTurnMetadataSchema>;

type PendingBurstRow = {
  source_message_id: string;
  provider_message_id: string;
  sender_id: string;
  text: string;
  received_at: string;
  payload_json: string | null;
};

const WHATSAPP_BURST_QUIET_SECONDS = 1.5;
const WHATSAPP_BURST_LIMIT = 8;

export class FitnessAgent extends Think<Env> {
  workspaceBash = false;
  includeMcpTools = false;
  sendReasoning = false;
  maxSteps = 8;
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
    return `Você é o parceiro de treino e alimentação do Felipe. Converse em português brasileiro, de forma natural e curta, como no WhatsApp. Felipe nasceu em 11 de janeiro de 1989 e é homem.

Felipe mede 1,80 m e tem bastante massa muscular. Como referência pessoal, aos 90 kg ele estima estar perto de 15% de gordura corporal. Isso é uma estimativa, não uma medição; não extrapole automaticamente para outros pesos.

O banco é o diário confiável. Use as ferramentas quando a resposta ou ação depender dele. Registre pedidos claros sem pedir confirmação. Para corrigir ou remover algo existente, consulte quando precisar da referência e use manage_records. Nunca crie compensações, estornos ou nutrientes negativos.

Entenda mensagens enviadas em sequência como uma fala só. Datas usam America/Sao_Paulo e pesos de treino usam quilogramas por padrão. Pergunte apenas quando mais de uma interpretação mudaria o registro.

Em foto de comida sem pedido para registrar, use propose_meal para guardar a leitura como rascunho. Mostre os componentes e apenas o total de calorias, carboidratos, gorduras e proteína. Não peça confirmação. Se Felipe mandar uma instrução clara para adicionar, salve sem perguntar de novo.

Use research_nutrition quando calorias ou macros dependerem de marca, rótulo, restaurante ou produto que você não conhece com segurança. Em comida caseira ou porção visual, estime e diga que é estimativa.

Consultas compactas bastam normalmente. Use full quando Felipe pedir itens, séries, fontes ou detalhes. Ao relatar alimentação, use os registros ativos de query_meals e respeite o campo complete. Seja neutro sobre comida, peso e treino. Não mostre referências internas nem faça diagnóstico médico.`;
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
      const turnReceivedAt = new Date(turn.receivedAt);
      const pendingMeal = await getLatestPendingMealProposal(db, turn.senderId, turnReceivedAt);
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
      maxSteps: 8,
      activeTools: hasPendingMeal ? [...CORE_TOOL_NAMES, "resolve_pending_meal"] : CORE_TOOL_NAMES,
      providerOptions: {
        openai: {
          reasoningEffort: "medium",
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
          "Registra fatos novos do turno atual: refeições, treinos, corridas, medidas ou notas. Não use para corrigir ou apagar registros existentes.",
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
      propose_meal: tool({
        description:
          "Guarda como rascunho uma refeição identificada em foto quando Felipe ainda não pediu para registrar. Uma nova proposta substitui a anterior.",
        inputSchema: proposeMealInputSchema,
        execute: async ({ events: inputEvents }) => {
          const turn = this.requireWhatsAppTurnMetadata();
          const events = inputEvents.map(normalizeLogEvent);
          const imageIndex = turn.inputTypes.lastIndexOf("image");
          const proposalSourceMessageId = turn.sourceMessageIds[imageIndex] ?? turn.sourceMessageId;
          const payload: IngestionResult = {
            events,
            query: null,
            reply: "Leitura da foto guardada como rascunho.",
          };
          await createMealProposal(
            createDatabase(this.env.DB),
            proposalSourceMessageId,
            turn.senderId,
            payload,
          );
          await this.markTurnProcessed(turn, { except: proposalSourceMessageId });
          return { proposed: true, events };
        },
      }),
      research_nutrition: tool({
        description:
          "Pesquisa calorias e macros quando marca, rótulo, restaurante ou produto não são conhecidos com segurança. Não use se Felipe ou a foto do rótulo já forneceram os valores.",
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
          "Consulta refeições ativas em qualquer período. compact traz refeições e totais; full acrescenta porções, macros, fontes e referências para correção.",
        inputSchema: mealQuerySchema,
        execute: async (input) =>
          jsonSafeToolOutput(await queryMeals(createDatabase(this.env.DB), input)),
      }),
      query_training: tool({
        description:
          "Consulta treinos, corridas, progressão, volume, cargas, distância e duração. full traz cada série e referências para correção.",
        inputSchema: trainingQuerySchema,
        execute: async (input) =>
          jsonSafeToolOutput(await queryTraining(createDatabase(this.env.DB), input)),
      }),
      query_measurements: tool({
        description:
          "Consulta peso e outras medidas corporais. compact traz primeira, última e variação; full traz cada medida e suas referências.",
        inputSchema: measurementQuerySchema,
        execute: async (input) =>
          jsonSafeToolOutput(await queryMeasurements(createDatabase(this.env.DB), input)),
      }),
      query_timeline: tool({
        description:
          "Consulta vários tipos do diário em ordem cronológica. Use para saber o que foi registrado ou o que aconteceu em uma data.",
        inputSchema: timelineQuerySchema,
        execute: async (input) =>
          jsonSafeToolOutput(await queryTimeline(createDatabase(this.env.DB), input)),
      }),
      manage_records: tool({
        description:
          "Corrige ou remove registros existentes por referência. Consulte primeiro se a conversa recente não trouxer a referência exata; não adivinhe entre vários candidatos.",
        inputSchema: manageRecordsInputSchema,
        execute: async (input) => {
          const turn = this.requireWhatsAppTurnMetadata();
          return manageRecords(createDatabase(this.env.DB), turn.sourceMessageId, input);
        },
      }),
      resolve_pending_meal: tool({
        description:
          "Salva, edita ou descarta a refeição pendente. Uma instrução clara como 'adiciona' deve salvar sem nova confirmação.",
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
        created_at INTEGER NOT NULL,
        payload_json TEXT
      )
    `;
    const columns = this.sql<{ name: string }>`PRAGMA table_info(cf_whatsapp_burst_messages)`;
    if (!columns.some((column) => column.name === "payload_json")) {
      void this.sql`ALTER TABLE cf_whatsapp_burst_messages ADD COLUMN payload_json TEXT`;
    }
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
        provider_message_id, source_message_id, sender_id, text, received_at, created_at,
        payload_json
      ) VALUES (
        ${input.providerMessageId}, ${input.sourceMessageId}, ${input.senderId},
        ${input.text ?? ""}, ${input.receivedAt}, ${Date.now()}, ${JSON.stringify(input)}
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
      SELECT source_message_id, provider_message_id, sender_id, text, received_at, payload_json
      FROM cf_whatsapp_burst_messages
      ORDER BY received_at ASC, created_at ASC
      LIMIT ${WHATSAPP_BURST_LIMIT}
    `;
    if (!rows.length) return;

    const turns = rows.map((row) =>
      whatsappTurnSchema.parse(
        row.payload_json
          ? JSON.parse(row.payload_json)
          : {
              sourceMessageId: row.source_message_id,
              providerMessageId: row.provider_message_id,
              senderId: row.sender_id,
              inputType: "text",
              text: row.text,
              mediaId: null,
              mimeType: null,
              receivedAt: row.received_at,
            },
      ),
    );

    const latest = rows.at(-1)!;
    const metadata: WhatsAppTurnMetadata = {
      sourceMessageId: latest.source_message_id,
      providerMessageId: latest.provider_message_id,
      sourceMessageIds: rows.map((row) => row.source_message_id),
      providerMessageIds: rows.map((row) => row.provider_message_id),
      inputTypes: turns.map((turn) => turn.inputType),
      senderId: latest.sender_id,
      receivedAt: latest.received_at,
      channel: "whatsapp",
    };

    let messages: UIMessage[];
    try {
      messages = await Promise.all(
        turns.map(async (turn) => ({
          id: turn.providerMessageId,
          role: "user" as const,
          parts: await prepareWhatsAppPartsWithRetry(turn, this.env),
          metadata: { turnMetadata: metadata },
        })),
      );
      await this.observeTurnFor(metadata, "input_prepared", {
        inputTypes: metadata.inputTypes,
      });
    } catch (error) {
      await this.handleWhatsAppTurnFailure(metadata, error);
      this.removeBufferedRows(rows, parsed.data.generation);
      await this.scheduleRemainingBurst();
      return;
    }

    const submission = await this.submitMessages(messages, {
      idempotencyKey: `whatsapp-burst:${metadata.providerMessageIds.join(":")}`,
      metadata,
    });

    this.removeBufferedRows(rows, parsed.data.generation);
    await this.observeTurnFor(metadata, "burst_submitted", {
      burstSize: rows.length,
      submissionId: submission.submissionId,
      accepted: submission.accepted,
      status: submission.status,
    });

    await this.scheduleRemainingBurst();
  }

  private removeBufferedRows(rows: PendingBurstRow[], generation: string) {
    for (const row of rows) {
      void this.sql`
        DELETE FROM cf_whatsapp_burst_messages
        WHERE provider_message_id = ${row.provider_message_id}
      `;
    }
    void this.sql`
      DELETE FROM cf_whatsapp_burst_state
      WHERE singleton = 1 AND generation = ${generation}
    `;
  }

  private async scheduleRemainingBurst() {
    const remaining = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM cf_whatsapp_burst_messages
    `[0]?.count;
    if (!remaining) return;

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
      { retry: { maxAttempts: 3 } },
    );
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

async function prepareWhatsAppPartsWithRetry(turn: WhatsAppTurn, env: Env) {
  const delays = [0, 250, 750];
  let lastError: unknown;
  for (const delayMs of delays) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await prepareWhatsAppParts(turn, env);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function getErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
