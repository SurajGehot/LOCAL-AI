export type MessageRole = "user" | "assistant";

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
}

export interface ConversationSettings {
  contextWindow: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string | null;
  settings: ConversationSettings;
  messages: ConversationMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: string | null;
  messageCount: number;
}