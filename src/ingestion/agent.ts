import { z } from "zod";

import type { AppBindings } from "../env";
import { ingestionResultSchema } from "./types";

const INSTRUCTIONS = `Extract fitness data from one WhatsApp message and write a short reply.
The message may describe meals, strength workouts, runs, body measurements, or ask about stored history.
Create separate events when one message contains unrelated activities.
For meals, estimate nutrition conservatively and lower confidence when portions are unclear.
Convert exercise weights to kilograms and distances to meters. Preserve the stated unit for body measurements.
Use the supplied current time when relative dates such as today or yesterday appear.
For a history question, set query and leave events empty. Otherwise set query to null.
Return plain WhatsApp-friendly reply text. Never invent an exact quantity that the message or image cannot support.`;

type AgentInput = string | ResponseInput;

export async function extractFitnessData(input: AgentInput, currentTime: Date, env: AppBindings) {
  const response = (await env.AI.run(
    "openai/gpt-5.6-luna",
    {
      reasoning: { effort: "high" },
      instructions: `${INSTRUCTIONS}\nCurrent time: ${currentTime.toISOString()}`,
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

  const outputText =
    response.output_text ??
    response.output
      ?.flatMap((item) => (item.type === "message" ? item.content : []))
      .find((item) => item.type === "output_text")?.text;

  if (!outputText) throw new Error("Luna returned no structured output");
  return ingestionResultSchema.parse(JSON.parse(outputText));
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
