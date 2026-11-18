import { randomUUID } from "node:crypto";

export function createOrderStore(database, now = Date.now) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS order_intents (
      id TEXT PRIMARY KEY NOT NULL,
      scope TEXT NOT NULL,
      payload TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS order_intents_scope ON order_intents(scope);
    CREATE TABLE IF NOT EXISTS order_events (
      intent_id TEXT NOT NULL,
      state TEXT NOT NULL,
      recorded_at INTEGER NOT NULL
    ) STRICT;
  `);
  const select = database.prepare(
    "SELECT payload FROM order_intents WHERE scope = ? AND id = ?",
  );
  const all = database.prepare(
    "SELECT payload FROM order_intents WHERE scope = ? ORDER BY rowid DESC",
  );
  const upsert = database.prepare(`INSERT INTO order_intents VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload WHERE scope = excluded.scope`);
  const event = database.prepare("INSERT INTO order_events VALUES (?, ?, ?)");
  function save(scope, intent) {
    const updated = { ...intent, updatedAt: now() };
    database.exec("BEGIN IMMEDIATE");
    try {
      upsert.run(updated.id, scope, JSON.stringify(updated));
      event.run(updated.id, updated.state, updated.updatedAt);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return updated;
  }
  return {
    save,
    create(scope, values) {
      return save(scope, {
        ...values,
        id: randomUUID(),
        reference: randomUUID(),
        createdAt: now(),
      });
    },
    get(scope, id) {
      const row = select.get(scope, id);
      return row ? JSON.parse(row.payload) : null;
    },
    list(scope) {
      return all.all(scope).map((row) => JSON.parse(row.payload));
    },
  };
}
