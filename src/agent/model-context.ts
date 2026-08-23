import { pruneMessages } from "ai";
import type { JSONValue, ModelMessage } from "ai";

export const CONVERSATION_PREVIOUS_USER_TURNS = 4;

export function recentConversationMessages(
  messages: readonly ModelMessage[],
  userTurnLimit = CONVERSATION_PREVIOUS_USER_TURNS + 1,
) {
  let userTurns = 0;
  let startIndex = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    userTurns += 1;
    startIndex = index;
    if (userTurns === userTurnLimit) break;
  }

  return pruneMessages({
    messages: messages.slice(startIndex),
    reasoning: "all",
    toolCalls: "before-last-12-messages",
  });
}

export function jsonSafeToolOutput(value: unknown): JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JSONValue;
}
