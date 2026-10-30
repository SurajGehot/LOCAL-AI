import type {
  ConversationMessage,
} from "./conversationTypes";

export function getContextMessages(
  messages: ConversationMessage[],
  contextWindow: number,
): ConversationMessage[] {
  if (contextWindow <= 0) {
    return [];
  }

  if (messages.length === 0) {
    return [];
  }

  const limit = Math.min(
    contextWindow,
    messages.length,
  );

  let startIndex =
    messages.length - limit;

  /*
   * Never start a context with an assistant message.
   *
   * If the selected window begins with an assistant,
   * move forward one message.
   */
  if (
    messages[startIndex]?.role ===
    "assistant"
  ) {
    startIndex += 1;
  }

  return messages.slice(startIndex);
}