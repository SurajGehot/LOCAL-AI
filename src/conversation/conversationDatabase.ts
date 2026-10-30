import Database from "@tauri-apps/plugin-sql";

const DATABASE_PATH = "sqlite:local_ai_history.db";

let database: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (database) return database;

  console.log("Loading SQLite database:", DATABASE_PATH);

  database = await Database.load(DATABASE_PATH);

  console.log("SQLite database loaded.");

  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) return;

  await database.close();
  database = null;
}

export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();

  await db.execute("DROP TABLE IF EXISTS messages;");
  await db.execute("DROP TABLE IF EXISTS conversations;");

  await db.close();

  database = null;
}