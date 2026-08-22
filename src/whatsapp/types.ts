export type WhatsAppMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type: "text" | "image" | "audio" | string;
  text?: { body?: string };
  image?: { id: string; mime_type?: string; caption?: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
};

export type WhatsAppWebhook = {
  entry?: Array<{ changes?: Array<{ value?: { messages?: WhatsAppMessage[] } }> }>;
};

export function extractMessages(payload: WhatsAppWebhook): WhatsAppMessage[] {
  return (
    payload.entry?.flatMap(
      (entry) => entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? [],
    ) ?? []
  );
}
