import { pruneMessages } from "ai";
import type { JSONValue, ModelMessage } from "ai";

export const CONVERSATION_PREVIOUS_USER_TURNS = 5;

export function recentConversationMessages(
  messages: readonly ModelMessage[],
  userTurnLimit = CONVERSATION_PREVIOUS_USER_TURNS + 1,
  mediaUserTurnLimit = 1,
) {
  let userTurns = 0;
  let startIndex = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    userTurns += 1;
    startIndex = index;
    if (userTurns === userTurnLimit) break;
  }

  const selectedMessages = messages.slice(startIndex);
  const userMessageIndexes = selectedMessages
    .map((message, index) => (message.role === "user" ? index : -1))
    .filter((index) => index >= 0);
  const mediaStartIndex = userMessageIndexes.at(-mediaUserTurnLimit) ?? selectedMessages.length;
  const withoutOldMedia = selectedMessages.map((message, index): ModelMessage => {
    if (
      message.role !== "user" ||
      typeof message.content === "string" ||
      index >= mediaStartIndex
    ) {
      return message;
    }
    return {
      ...message,
      content: message.content.filter((part) => part.type !== "file" && part.type !== "image"),
    };
  });

  return pruneMessages({
    messages: withoutOldMedia,
    reasoning: "all",
    toolCalls: "all",
  });
}

export function jsonSafeToolOutput(value: unknown): JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JSONValue;
}
