import {
  ConversationManager,
} from "./conversationManager";

import {
  deleteConversation,
  getConversationSummaries,
  getFullConversation,
  renameConversation,
  saveConversation,
} from "./conversationRepository";

import type {
  Conversation,
  ConversationSummary,
} from "./conversationTypes";

export async function saveCurrentConversation(
    manager: ConversationManager,
): Promise<void> {
    const conversation =
        manager.getConversationSnapshot();

    if (conversation.messages.length === 0) {
        throw new Error(
            "Cannot save an empty conversation.",
        );
    }

    if (
        conversation.title.trim() ===
            "New Chat"
    ) {
        const firstUserMessage =
            conversation.messages.find(
                (message) =>
                    message.role === "user",
            );

        if (firstUserMessage) {
            const cleanedTitle =
                firstUserMessage.content
                    .trim()
                    .replace(/\s+/g, " ");

            const maxTitleLength = 48;

            const title =
                cleanedTitle.length >
                maxTitleLength
                    ? `${cleanedTitle.slice(
                          0,
                          maxTitleLength - 3,
                      )}...`
                    : cleanedTitle;

            manager.setTitle(title);
        }
    }

    await saveConversation(
        manager.getConversationSnapshot(),
    );
}

export async function loadConversationSummaries() {
  return getConversationSummaries();
}

export async function loadConversation(
  conversationId: string,
): Promise<Conversation> {
  const conversation =
    await getFullConversation(
      conversationId,
    );

  if (!conversation) {
    throw new Error(
      "Conversation could not be found.",
    );
  }

  return conversation;
}

export async function loadConversationHistory(): Promise<
  ConversationSummary[]
> {
  return getConversationSummaries();
}

export async function renameSavedConversation(
  conversationId: string,
  title: string,
): Promise<void> {
  await renameConversation(
    conversationId,
    title,
  );
}

export async function deleteSavedConversation(
  conversationId: string,
): Promise<void> {
  await deleteConversation(
    conversationId,
  );
}
