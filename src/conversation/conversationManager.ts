import type {
  Conversation,
  ConversationMessage,
  ConversationSettings,
} from "./conversationTypes";

import {
  getContextMessages,
} from "./contextManager";

const DEFAULT_CONTEXT_WINDOW = 8;

function generateId(): string {
  return crypto.randomUUID();
}

function createDefaultTitle(): string {
  return "New Chat";
}

export class ConversationManager {
  private conversation: Conversation;

  constructor(
    model: string | null = null,
    contextWindow: number = DEFAULT_CONTEXT_WINDOW,
  ) {
    this.conversation = {
      id: generateId(),
      title: createDefaultTitle(),
      model,
      settings: {
        contextWindow,
      },
      messages: [],
    };
  }

  getConversation(): Conversation {
    return {
      ...this.conversation,
      settings: {
        ...this.conversation.settings,
      },
      messages: [
        ...this.conversation.messages,
      ],
    };
  }

  getId(): string {
    return this.conversation.id;
  }

  getTitle(): string {
    return this.conversation.title;
  }

  getModel(): string | null {
    return this.conversation.model;
  }

  getSettings(): ConversationSettings {
    return {
      ...this.conversation.settings,
    };
  }

  getMessages(): ConversationMessage[] {
    return [
      ...this.conversation.messages,
    ];
  }

  addUserMessage(
    content: string,
  ): ConversationMessage {
    const cleanedContent = content.trim();

    if (!cleanedContent) {
      throw new Error(
        "User message cannot be empty.",
      );
    }

    const lastMessage =
      this.conversation.messages[
      this.conversation.messages.length - 1
      ];

    if (lastMessage?.role === "user") {
      throw new Error(
        "Cannot add a user message before an assistant response.",
      );
    }

    const message: ConversationMessage = {
      id: generateId(),
      role: "user",
      content: cleanedContent,
    };

    this.conversation.messages.push(message);

    return message;
  }

  addAssistantMessage(
    content: string,
  ): ConversationMessage {
    const cleanedContent = content.trim();

    if (!cleanedContent) {
      throw new Error(
        "Assistant message cannot be empty.",
      );
    }

    const lastMessage =
      this.conversation.messages[
      this.conversation.messages.length - 1
      ];

    if (
      !lastMessage ||
      lastMessage.role !== "user"
    ) {
      throw new Error(
        "Assistant response must follow a user message.",
      );
    }

    const message: ConversationMessage = {
      id: generateId(),
      role: "assistant",
      content: cleanedContent,
    };

    this.conversation.messages.push(message);

    return message;
  }

  setTitle(title: string): void {
    const cleanedTitle = title.trim();

    if (!cleanedTitle) {
      return;
    }

    this.conversation.title = cleanedTitle;
  }

  setModel(model: string | null): void {
    this.conversation.model = model;
  }

  setContextWindow(contextWindow: number): void {
    if (!Number.isInteger(contextWindow)) {
      throw new Error(
        "Context window must be an integer.",
      );
    }

    if (contextWindow <= 0) {
      throw new Error(
        "Context window must be greater than zero.",
      );
    }

    this.conversation.settings.contextWindow =
      contextWindow;
  }

  getContextMessages(): ConversationMessage[] {
    return getContextMessages(
      this.conversation.messages,
      this.conversation.settings.contextWindow,
    );
  }

  clearMessages(): void {
    this.conversation.messages = [];
  }

  removeLastMessage(): void {
    this.conversation.messages.pop();
  }

  getConversationSnapshot(): Conversation {
    return {
      id: this.conversation.id,
      title: this.conversation.title,
      model: this.conversation.model,
      settings: {
        contextWindow:
          this.conversation.settings.contextWindow,
      },
      messages: this.conversation.messages.map(
        message => ({
          id: message.id,
          role: message.role,
          content: message.content,
        }),
      ),
    };
  }

  loadConversation(
    conversation: Conversation,
  ): void {
    this.conversation = {
      id: conversation.id,
      title: conversation.title,
      model: conversation.model,
      settings: {
        contextWindow:
          conversation.settings.contextWindow,
      },
      messages:
        conversation.messages.map(
          (message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
          }),
        ),
    };
  }

}


