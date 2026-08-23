import { z } from "zod";

export const whatsappInputTypeSchema = z.enum(["text", "image", "audio"]);

export const whatsappTurnSchema = z
  .object({
    sourceMessageId: z.string().uuid(),
    providerMessageId: z.string().min(1),
    senderId: z.string().min(1),
    inputType: whatsappInputTypeSchema,
    text: z.string().nullable(),
    mediaId: z.string().nullable(),
    mimeType: z.string().nullable(),
    receivedAt: z.string().datetime(),
  })
  .superRefine((turn, context) => {
    if (turn.inputType === "text" && !turn.text?.trim()) {
      context.addIssue({ code: "custom", message: "Text messages require text", path: ["text"] });
    }
    if (turn.inputType !== "text" && !turn.mediaId) {
      context.addIssue({
        code: "custom",
        message: "Media messages require a media ID",
        path: ["mediaId"],
      });
    }
  });

export type WhatsAppTurn = z.infer<typeof whatsappTurnSchema>;
