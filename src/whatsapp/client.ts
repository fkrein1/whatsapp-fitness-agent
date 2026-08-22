import type { AppBindings } from "../env";

type MediaDownload = {
  bytes: ArrayBuffer;
  mimeType: string;
};

export async function sendWhatsAppText(to: string, body: string, env: AppBindings) {
  await callWhatsApp(
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: body.slice(0, 4096) },
    },
    env,
  );
}

export async function markMessageRead(messageId: string, env: AppBindings) {
  await callWhatsApp({ messaging_product: "whatsapp", status: "read", message_id: messageId }, env);
}

export async function downloadWhatsAppMedia(
  mediaId: string,
  fallbackMimeType: string,
  env: AppBindings,
): Promise<MediaDownload> {
  const metadataResponse = await fetch(
    `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } },
  );
  if (!metadataResponse.ok) {
    throw new Error(`WhatsApp media lookup failed (${metadataResponse.status})`);
  }

  const metadata = (await metadataResponse.json()) as { mime_type?: string; url?: string };
  if (!metadata.url) throw new Error("WhatsApp media lookup returned no URL");

  const mediaResponse = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
  });
  if (!mediaResponse.ok) {
    throw new Error(`WhatsApp media download failed (${mediaResponse.status})`);
  }

  return {
    bytes: await mediaResponse.arrayBuffer(),
    mimeType: metadata.mime_type ?? fallbackMimeType,
  };
}

async function callWhatsApp(body: object, env: AppBindings) {
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
