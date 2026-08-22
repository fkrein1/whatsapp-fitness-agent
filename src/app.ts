import { Hono } from "hono";

import type { AppEnvironment } from "./env";
import { processMessage } from "./ingestion/process-message";
import { privacyPolicy } from "./privacy";
import { hasValidMetaSignature } from "./security/meta-signature";
import { extractMessages } from "./whatsapp/types";
import type { WhatsAppWebhook } from "./whatsapp/types";

export const app = new Hono<AppEnvironment>();

app.get("/", (context) => context.json({ status: "ok" }));
app.get("/privacy", (context) => context.html(privacyPolicy()));

app.get("/webhook", (context) => {
  const mode = context.req.query("hub.mode");
  const token = context.req.query("hub.verify_token");
  const challenge = context.req.query("hub.challenge");

  if (mode === "subscribe" && token === context.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return context.text(challenge);
  }
  return context.text("Webhook verification failed", 403);
});

app.post("/webhook", async (context) => {
  const rawBody = await context.req.text();
  const signature = context.req.header("x-hub-signature-256") ?? null;
  if (!(await hasValidMetaSignature(rawBody, signature, context.env.META_APP_SECRET))) {
    return context.text("Invalid signature", 401);
  }

  let payload: WhatsAppWebhook;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhook;
  } catch {
    return context.text("Invalid JSON", 400);
  }

  const messages = extractMessages(payload).filter(
    (message) => message.from === context.env.WHATSAPP_RECIPIENT,
  );
  for (const message of messages) {
    context.executionCtx.waitUntil(processMessage(message, context.env));
  }

  return context.text("EVENT_RECEIVED");
});

app.notFound((context) => context.json({ error: "Not found" }, 404));
