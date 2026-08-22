type Bindings = {
  AI: Ai;
  META_ACCESS_TOKEN: string;
  META_APP_SECRET: string;
  WHATSAPP_API_VERSION: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_RECIPIENT: string;
  WHATSAPP_VERIFY_TOKEN: string;
};

type WhatsAppMessage = {
  from: string;
  id: string;
  text?: { body?: string };
  type: string;
};

type WhatsAppWebhook = {
  entry?: Array<{ changes?: Array<{ value?: { messages?: WhatsAppMessage[] } }> }>;
};

type OpenAIResponse = {
  error?: { message?: string };
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
};

const AGENT_INSTRUCTIONS = `You are a concise personal fitness assistant talking to one user over WhatsApp.
Answer naturally and directly. Prefer short replies that are easy to read on a phone.
Use plain text and simple lists when useful. Do not use markdown tables.`;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "GET") {
      return verifyWebhook(url, env);
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      return receiveWebhook(request, env, ctx);
    }

    if (url.pathname === "/privacy" && request.method === "GET") {
      return privacyPolicy();
    }

    return Response.json({ status: "ok" });
  },
} satisfies ExportedHandler<Bindings>;

function privacyPolicy(): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Fitness Agent Privacy Policy</title>
    <style>
      body { max-width: 720px; margin: 48px auto; padding: 0 20px; font: 16px/1.6 system-ui, sans-serif; color: #202124; }
      h1, h2 { line-height: 1.25; }
    </style>
  </head>
  <body>
    <h1>Fitness Agent Privacy Policy</h1>
    <p>Last updated: August 22, 2026</p>
    <p>Fitness Agent is a private WhatsApp assistant operated for personal testing.</p>
    <h2>Data processed</h2>
    <p>When you message the assistant, it processes your WhatsApp phone number, message text, and WhatsApp message identifier to generate and deliver a reply.</p>
    <h2>How data is used</h2>
    <p>Messages are sent through Meta's WhatsApp Business Platform and processed through Cloudflare AI Gateway using an OpenAI model. The application does not maintain its own message-history database. Platform providers may process or retain technical logs according to their policies and account settings.</p>
    <h2>Sharing</h2>
    <p>Data is shared only with Meta, Cloudflare, and the model provider as needed to receive messages, generate replies, and send responses.</p>
    <h2>Deletion and contact</h2>
    <p>To request deletion or ask a privacy question, contact the app operator through the same WhatsApp conversation.</p>
  </body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function verifyWebhook(url: URL, env: Bindings): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Webhook verification failed", { status: 403 });
}

async function receiveWebhook(
  request: Request,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!(await hasValidMetaSignature(rawBody, signature, env.META_APP_SECRET))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WhatsAppWebhook;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhook;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const messages = extractMessages(payload).filter(
    (message) => message.from === env.WHATSAPP_RECIPIENT,
  );

  for (const message of messages) {
    ctx.waitUntil(handleMessage(message, env));
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

function extractMessages(payload: WhatsAppWebhook): WhatsAppMessage[] {
  return (
    payload.entry?.flatMap(
      (entry) => entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? [],
    ) ?? []
  );
}

async function handleMessage(message: WhatsAppMessage, env: Bindings): Promise<void> {
  try {
    await markMessageRead(message.id, env);

    if (message.type !== "text" || !message.text?.body?.trim()) {
      await sendWhatsAppText(message.from, "For now I can only answer text messages.", env);
      return;
    }

    const reply = await createAgentReply(message.text.body.trim(), env);
    await sendWhatsAppText(message.from, reply, env);
  } catch (error) {
    console.error("Failed to process WhatsApp message", {
      messageId: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function createAgentReply(message: string, env: Bindings): Promise<string> {
  const data = (await env.AI.run(
    "openai/gpt-5.6-luna",
    {
      reasoning: { effort: "high" },
      instructions: AGENT_INSTRUCTIONS,
      input: message,
      max_output_tokens: 1200,
    },
    { gateway: { id: "default" } },
  )) as OpenAIResponse;

  if (data.error) throw new Error(data.error.message ?? "AI Gateway request failed");

  const text = data.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")
    ?.text?.trim();

  if (!text) throw new Error("OpenAI returned no text");
  return text.slice(0, 4096);
}

async function sendWhatsAppText(to: string, body: string, env: Bindings): Promise<void> {
  await callWhatsApp(
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    },
    env,
  );
}

async function markMessageRead(messageId: string, env: Bindings): Promise<void> {
  await callWhatsApp({ messaging_product: "whatsapp", status: "read", message_id: messageId }, env);
}

async function callWhatsApp(body: object, env: Bindings): Promise<void> {
  const response = await fetch(
    `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`WhatsApp request failed (${response.status}): ${await response.text()}`);
  }
}

async function hasValidMetaSignature(
  body: string,
  signature: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = `sha256=${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;

  if (signature.length !== expected.length) return false;

  let mismatch = 0;
  for (let index = 0; index < signature.length; index += 1) {
    mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}
