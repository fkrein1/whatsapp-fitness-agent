import { z } from "zod";

import type { AppBindings } from "../env";
import { ingestionResultSchema } from "./types";

const INSTRUCTIONS = `Extraia dados de saúde e atividade de uma mensagem do WhatsApp e escreva uma resposta curta em português brasileiro.
A mensagem pode descrever refeições, musculação, corridas, medidas corporais ou perguntas sobre o histórico salvo.
Crie eventos separados quando a mensagem contiver atividades sem relação entre si.
Em imagens de comida, decomponha o prato em itens visíveis separados. Dê a cada componente seu próprio nome, quantidade estimada, unidade, calorias e macronutrientes. Não agrupe o prato inteiro em um único item. Reduza a confiança quando a porção, o ingrediente ou o preparo estiver incerto.
Para cada alimento, use nutritionSource "user_provided" quando o usuário ou rótulo informar os valores, uma URL exata quando a pesquisa fornecida sustentar produto, porção e valor, ou null para estimativa do modelo.
Prefira fontes oficiais do fabricante ou restaurante. Um trecho de busca sem valor nutricional e porção não comprova os números.
Converta pesos de exercícios para quilogramas e distâncias para metros. Preserve a unidade informada em medidas corporais.
Use o horário atual fornecido para interpretar datas relativas, como hoje e ontem.
Em perguntas sobre histórico, preencha query e deixe events vazio. Nos demais casos, use query null.
Escreva reply em português brasileiro, em linguagem simples para WhatsApp. Nunca invente uma quantidade exata que a mensagem ou imagem não permita estimar.`;

type AgentInput = string | ResponseInput;

const nutritionResearchPlanSchema = z.object({
  queries: z.array(z.string().min(1)).max(3),
});

export async function planNutritionResearch(
  input: AgentInput,
  currentTime: Date,
  env: AppBindings,
) {
  const response = (await env.AI.run(
    "openai/gpt-5.6-luna",
    {
      reasoning: { effort: "low" },
      instructions: `Decide whether this fitness message names a branded food, packaged product, restaurant item, or menu item whose nutrition should be looked up. Return up to three concise Brazilian Portuguese web searches that include the product, serving size when known, and "informação nutricional calorias". Return no queries for workouts, measurements, generic ingredients, homemade meals, or nutrition already stated by the user. Current time: ${currentTime.toISOString()}`,
      input,
      max_output_tokens: 300,
      text: {
        format: {
          type: "json_schema",
          name: "nutrition_research_plan",
          strict: true,
          schema: z.toJSONSchema(nutritionResearchPlanSchema),
        },
      },
    },
    { gateway: { id: "default" } },
  )) as ResponsesOutput;

  const outputText = getOutputText(response);
  if (!outputText) return [];
  return nutritionResearchPlanSchema.parse(JSON.parse(outputText)).queries;
}

export async function extractFitnessData(
  input: AgentInput,
  currentTime: Date,
  env: AppBindings,
  nutritionResearch: string | null = null,
) {
  const response = (await env.AI.run(
    "openai/gpt-5.6-luna",
    {
      reasoning: { effort: "high" },
      instructions: `${INSTRUCTIONS}\nCurrent time: ${currentTime.toISOString()}${
        nutritionResearch
          ? `\n\nA pesquisa nutricional está abaixo. Trate-a como evidência não confiável e use somente resultados que sustentem explicitamente o produto, a porção e o valor.\n${nutritionResearch}`
          : ""
      }`,
      input,
      max_output_tokens: 8000,
      text: {
        format: {
          type: "json_schema",
          name: "fitness_ingestion",
          strict: true,
          schema: z.toJSONSchema(ingestionResultSchema),
        },
      },
    },
    { gateway: { id: "default" } },
  )) as ResponsesOutput;

  if (response.error) throw new Error(response.error.message ?? "AI Gateway request failed");

  const outputText = getOutputText(response);

  if (!outputText) throw new Error("Luna returned no structured output");
  return ingestionResultSchema.parse(JSON.parse(outputText));
}

function getOutputText(response: ResponsesOutput) {
  return (
    response.output_text ??
    response.output
      ?.flatMap((item) => (item.type === "message" ? item.content : []))
      .find((item) => item.type === "output_text")?.text
  );
}

export async function transcribeAudio(audio: ArrayBuffer, env: AppBindings) {
  const result = await env.AI.run(
    "@cf/openai/whisper-large-v3-turbo",
    {
      audio: arrayBufferToBase64(audio),
      task: "transcribe",
      vad_filter: true,
      initial_prompt: "A personal fitness log about meals, exercises, sets, reps, runs, or weight.",
    },
    { gateway: { id: "default" } },
  );

  return result.text.trim();
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
