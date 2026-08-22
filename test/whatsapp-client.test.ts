import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markMessageRead, sendWhatsAppText } from "../src/whatsapp/client";

describe("WhatsApp client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("marks an inbound message read and shows the typing indicator", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await markMessageRead("wamid.test", env, { typing: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.test",
      typing_indicator: { type: "text" },
    });
  });

  it("falls back to a plain read receipt when typing is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unsupported", { status: 400 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await markMessageRead("wamid.test", env, { typing: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.test",
    });
  });

  it("retries transient reply failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const sending = sendWhatsAppText("5511999999999", "Saved.", env);
    await vi.runAllTimersAsync();
    await sending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
