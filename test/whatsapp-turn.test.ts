import { afterEach, describe, expect, it, vi } from "vitest";

import { whatsappTurnSchema, type WhatsAppTurn } from "../src/agent/whatsapp-turn";
import type { AppBindings } from "../src/env";
import { prepareWhatsAppParts } from "../src/ingestion/media";

const baseTurn = {
  sourceMessageId: "9fdb08c5-840a-4f1b-b830-4125dedcc598",
  providerMessageId: "wamid.1",
  senderId: "5511999999999",
  receivedAt: "2026-08-22T12:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("WhatsApp agent turns", () => {
  it("accepts text, image, and audio inputs for the same agent queue", () => {
    expect(
      whatsappTurnSchema.parse({
        ...baseTurn,
        inputType: "text",
        text: "treinei hoje",
        mediaId: null,
        mimeType: null,
      }).inputType,
    ).toBe("text");

    for (const inputType of ["image", "audio"] as const) {
      expect(
        whatsappTurnSchema.parse({
          ...baseTurn,
          inputType,
          text: null,
          mediaId: `${inputType}-1`,
          mimeType: inputType === "image" ? "image/jpeg" : "audio/ogg",
        }).inputType,
      ).toBe(inputType);
    }
  });

  it("rejects media turns without a media ID", () => {
    expect(
      whatsappTurnSchema.safeParse({
        ...baseTurn,
        inputType: "image",
        text: null,
        mediaId: null,
        mimeType: "image/jpeg",
      }).success,
    ).toBe(false);
  });

  it("normalizes a text turn into a Think UI message part", async () => {
    const turn: WhatsAppTurn = {
      ...baseTurn,
      inputType: "text",
      text: "  adiciona  ",
      mediaId: null,
      mimeType: null,
    };

    await expect(prepareWhatsAppParts(turn, {} as AppBindings)).resolves.toEqual([
      { type: "text", text: "adiciona" },
    ]);
  });

  it("downloads an image into the same Think message format", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ url: "https://media.example/photo", mime_type: "image/jpeg" }),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]))),
    );
    const turn = whatsappTurnSchema.parse({
      ...baseTurn,
      inputType: "image",
      text: "meu almoço",
      mediaId: "image-1",
      mimeType: "image/jpeg",
    });
    const env = {
      WHATSAPP_API_VERSION: "v26.0",
      META_ACCESS_TOKEN: "test-token",
    } as AppBindings;

    await expect(prepareWhatsAppParts(turn, env)).resolves.toEqual([
      { type: "text", text: "meu almoço" },
      { type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,AQID" },
    ]);
  });

  it("transcribes audio before adding it to the Think turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ url: "https://media.example/audio", mime_type: "audio/ogg" }),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]))),
    );
    const run = vi.fn().mockResolvedValue({ text: "corri cinco quilômetros" });
    const turn = whatsappTurnSchema.parse({
      ...baseTurn,
      inputType: "audio",
      text: null,
      mediaId: "audio-1",
      mimeType: "audio/ogg",
    });
    const env = {
      WHATSAPP_API_VERSION: "v26.0",
      META_ACCESS_TOKEN: "test-token",
      AI: { run },
    } as unknown as AppBindings;

    await expect(prepareWhatsAppParts(turn, env)).resolves.toEqual([
      { type: "text", text: "Mensagem de áudio transcrita:\ncorri cinco quilômetros" },
    ]);
    expect(run).toHaveBeenCalledOnce();
  });
});
