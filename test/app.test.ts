import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("HTTP routes", () => {
  it("returns health status", async () => {
    const response = await exports.default.fetch("https://example.com/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("echoes a valid Meta webhook challenge", async () => {
    const url = new URL("https://example.com/webhook");
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", env.WHATSAPP_VERIFY_TOKEN);
    url.searchParams.set("hub.challenge", "verified");

    const response = await exports.default.fetch(url.toString());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("verified");
  });

  it("rejects an invalid verify token", async () => {
    const response = await exports.default.fetch(
      "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x",
    );

    expect(response.status).toBe(403);
  });
});
