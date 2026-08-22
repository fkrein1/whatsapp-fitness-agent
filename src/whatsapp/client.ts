import type { AppBindings } from "../env";

type MediaDownload = {
  bytes: ArrayBuffer;
  mimeType: string;
};

export async function sendWhatsAppText(to: string, body: string, env: AppBindings) {
  await retryWhatsAppRequest(() =>
    callWhatsApp(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: body.slice(0, 4096) },
      },
      env,
    ),
  );
}

export async function markMessageRead(
  messageId: string,
  env: AppBindings,
  options: { typing?: boolean } = {},
) {
  const body = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    ...(options.typing ? { typing_indicator: { type: "text" } } : {}),
  };

  try {
    await callWhatsApp(body, env);
  } catch (error) {
    if (!options.typing) throw error;
    await callWhatsApp(
      { messaging_product: "whatsapp", status: "read", message_id: messageId },
      env,
    );
  }
}

export async function keepWhatsAppTyping(
  messageId: string,
  env: AppBindings,
  signal: AbortSignal,
  intervalMs = 20_000,
) {
  while (!signal.aborted) {
    await waitForAbortOrTimeout(signal, intervalMs);
    if (signal.aborted) return;
    try {
      await markMessageRead(messageId, env, { typing: true });
    } catch (error) {
      console.warn("Failed to refresh WhatsApp typing indicator", {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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
    throw new WhatsAppRequestError(response.status, await response.text());
  }
}

class WhatsAppRequestError extends Error {
  constructor(
    readonly status: number,
    responseBody: string,
  ) {
    super(`WhatsApp request failed (${status}): ${responseBody}`);
  }
}

async function retryWhatsAppRequest(operation: () => Promise<void>) {
  const delays = [0, 250, 750];
  let lastError: unknown;
  for (const delayMs of delays) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error instanceof WhatsAppRequestError && error.status < 500 && error.status !== 429) {
        throw error;
      }
    }
  }
  throw lastError;
}

function waitForAbortOrTimeout(signal: AbortSignal, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(done, timeoutMs);
    signal.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
