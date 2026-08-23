import type { FileUIPart, TextUIPart } from "ai";

import type { WhatsAppTurn } from "../agent/whatsapp-turn";
import type { AppBindings } from "../env";
import { downloadWhatsAppMedia } from "../whatsapp/client";

export type WhatsAppAgentPart = TextUIPart | FileUIPart;

export async function prepareWhatsAppParts(
  turn: WhatsAppTurn,
  env: AppBindings,
): Promise<WhatsAppAgentPart[]> {
  if (turn.inputType === "text") {
    return [{ type: "text", text: turn.text!.trim() }];
  }

  const media = await downloadWhatsAppMedia(
    turn.mediaId!,
    turn.mimeType ?? (turn.inputType === "image" ? "image/jpeg" : "audio/ogg"),
    env,
  );

  if (turn.inputType === "audio") {
    const transcript = await transcribeAudio(media.bytes, env);
    if (!transcript) throw new Error("Audio transcription was empty");
    return [{ type: "text", text: `Mensagem de áudio transcrita:\n${transcript}` }];
  }

  return [
    {
      type: "text",
      text: turn.text?.trim() || "Foto enviada sem legenda.",
    },
    {
      type: "file",
      mediaType: media.mimeType,
      url: `data:${media.mimeType};base64,${arrayBufferToBase64(media.bytes)}`,
    },
  ];
}

async function transcribeAudio(audio: ArrayBuffer, env: AppBindings) {
  const result = await env.AI.run(
    "@cf/openai/whisper-large-v3-turbo",
    {
      audio: arrayBufferToBase64(audio),
      task: "transcribe",
      vad_filter: true,
      initial_prompt:
        "Diário pessoal em português sobre refeições, exercícios, séries, repetições, corridas ou peso.",
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
