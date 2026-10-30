import {
  getDatabase,
} from "./conversationDatabase";

import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from "./conversationTypes";

export interface DatabaseConversation {
  id: string;
  title: string;
  model: string | null;
  context_window: number;
}

export interface DatabaseMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  position: number;
}

export async function insertConversation(
  conversation: DatabaseConversation
): Promise<void> {
  const db =
    await getDatabase();

  await db.execute(
    `
    INSERT INTO conversations (
      id,
      title,
      model,
      context_window
    )
    VALUES ($1, $2, $3, $4)
    `,
    [
      conversation.id,
      conversation.title,
      conversation.model,
      conversation.context_window,
    ]
  );
}

export async function insertMessage(
  message: DatabaseMessage
): Promise<void> {
  const db =
    await getDatabase();

  await db.execute(
    `
    INSERT INTO messages (
      id,
      conversation_id,
      role,
      content,
      position
    )
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      message.id,
      message.conversation_id,
      message.role,
      message.content,
      message.position,
    ]
  );
}

export async function getConversation(
  id: string
): Promise<DatabaseConversation | null> {
  const db =
    await getDatabase();

  const rows =
    await db.select<
      DatabaseConversation[]
    >(
      `
      SELECT
        id,
        title,
        model,
        context_window
      FROM conversations
      WHERE id = $1
      `,
      [id]
    );

  return rows[0] ?? null;
}

export async function getMessages(
  conversationId: string
): Promise<DatabaseMessage[]> {
  const db =
    await getDatabase();

  return db.select<
    DatabaseMessage[]
  >(
    `
    SELECT
      id,
      conversation_id,
      role,
      content,
      position
    FROM messages
    WHERE conversation_id = $1
    ORDER BY position ASC
    `,
    [conversationId]
  );
}

export async function updateConversation(
  id: string,
  title: string,
  model: string | null,
  contextWindow: number
): Promise<void> {
  const db =
    await getDatabase();

  await db.execute(
    `
    UPDATE conversations
    SET
      title = $1,
      model = $2,
      context_window = $3
    WHERE id = $4
    `,
    [
      title,
      model,
      contextWindow,
      id,
    ]
  );
}

export async function saveConversation(
  conversation: Conversation,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      DELETE FROM conversations
      WHERE id = $1
    `,
    [conversation.id],
  );

  await db.execute(
    `
      INSERT INTO conversations (
        id,
        title,
        model,
        context_window
      )
      VALUES ($1, $2, $3, $4)
    `,
    [
      conversation.id,
      conversation.title,
      conversation.model,
      conversation.settings.contextWindow,
    ],
  );

  for (
    let index = 0;
    index < conversation.messages.length;
    index += 1
  ) {
    const message =
      conversation.messages[index];

    await db.execute(
      `
        INSERT INTO messages (
          id,
          conversation_id,
          role,
          content,
          position
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        message.id,
        conversation.id,
        message.role,
        message.content,
        index,
      ],
    );
  }
}

export async function getConversationSummaries(): Promise<
  ConversationSummary[]
> {
  const db = await getDatabase();

  const rows = await db.select<
    Array<{
      id: string;
      title: string;
      model: string | null;
      message_count: number | string;
    }>
  >(
    `
      SELECT
        c.id,
        c.title,
        c.model,
        COUNT(m.id) AS message_count
      FROM conversations c
      LEFT JOIN messages m
        ON m.conversation_id = c.id
      GROUP BY
        c.id,
        c.title,
        c.model
      ORDER BY c.rowid DESC
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    model: row.model,
    messageCount: Number(row.message_count),
  }));
}

export async function getFullConversation(
  conversationId: string,
): Promise<Conversation | null> {
  const db = await getDatabase();

  const conversationRows =
    await db.select<
    Array<{
      id: string;
      title: string;
      model: string | null;
      context_window: number;
    }>
  >(
      `
        SELECT
          id,
          title,
          model,
          context_window
        FROM conversations
        WHERE id = $1
        LIMIT 1
      `,
      [conversationId],
    );

  if (conversationRows.length === 0) {
    return null;
  }

  const conversationRow =
    conversationRows[0];

  const messageRows =
    await db.select<
    Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      position: number;
    }>
  >(
      `
        SELECT
          id,
          role,
          content,
          position
        FROM messages
        WHERE conversation_id = $1
        ORDER BY position ASC
      `,
      [conversationId],
    );

  const messages: ConversationMessage[] =
    messageRows.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
    }));

  return {
    id: conversationRow.id,
    title: conversationRow.title,
    model: conversationRow.model,
    settings: {
      contextWindow:
        conversationRow.context_window,
    },
    messages,
  };
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<void> {
  const cleanedTitle = title.trim();

  if (!cleanedTitle) {
    throw new Error(
      "Conversation title cannot be empty.",
    );
  }

  await (
    await getDatabase()
  ).execute(
    `
      UPDATE conversations
      SET title = $1
      WHERE id = $2
    `,
    [
      cleanedTitle,
      conversationId,
    ],
  );
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      DELETE FROM conversations
      WHERE id = $1
    `,
    [conversationId],
  );
}