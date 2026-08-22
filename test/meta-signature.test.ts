import { describe, expect, it } from "vitest";

import { hasValidMetaSignature } from "../src/security/meta-signature";

async function sign(body: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

describe("Meta webhook signatures", () => {
  it("accepts the matching body and secret", async () => {
    const body = '{"event":"message"}';
    const signature = await sign(body, "test-secret");

    expect(await hasValidMetaSignature(body, signature, "test-secret")).toBe(true);
  });

  it("rejects modified content", async () => {
    const signature = await sign("original", "test-secret");

    expect(await hasValidMetaSignature("modified", signature, "test-secret")).toBe(false);
  });
});
