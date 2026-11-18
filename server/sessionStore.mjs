import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createOrderStore } from "./orderStore.mjs";

function sessionId(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return null;
  return createHash("sha256").update(token).digest("hex");
}

function prepareSessionFile(filename) {
  if (filename === ":memory:") return;
  if (!isAbsolute(filename))
    throw new Error("Session store requires an absolute path");
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const directory = lstatSync(dirname(filename));
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0)
    throw new Error("Session store directory must be private");
  if (!lstatSync(filename, { throwIfNoEntry: false })) {
    const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY;
    try {
      closeSync(openSync(filename, flags, 0o600));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const metadata = lstatSync(filename);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Session store must be a private regular file");
  }
}

export function createSessionStore({
  filename,
  idleMs,
  absoluteMs,
  now = Date.now,
}) {
  if (
    !Number.isSafeInteger(idleMs) ||
    !Number.isSafeInteger(absoluteMs) ||
    idleMs <= 0 ||
    idleMs > absoluteMs
  ) {
    throw new Error("Invalid session expiration configuration");
  }
  prepareSessionFile(filename);
  const database = new DatabaseSync(filename);
  try {
    database.exec(`
      PRAGMA busy_timeout = 2500;
      PRAGMA locking_mode = EXCLUSIVE;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS app_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        idle_until INTEGER NOT NULL,
        absolute_until INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS app_sessions_user ON app_sessions(user_id);
      CREATE INDEX IF NOT EXISTS app_sessions_expiry ON app_sessions(idle_until);
    `);
  } catch (error) {
    database.close();
    if ([5, 6].includes(error.errcode & 0xff)) {
      throw Object.assign(
        new Error("Session database is locked by another Trader API process", {
          cause: error,
        }),
        { code: "SESSION_STORE_LOCKED" },
      );
    }
    throw error;
  }

  const insert = database.prepare(`
    INSERT INTO app_sessions (id, user_id, idle_until, absolute_until)
    VALUES (?, ?, ?, ?)
  `);
  const select = database.prepare(`
    SELECT user_id FROM app_sessions
    WHERE id = ? AND idle_until > ? AND absolute_until > ?
  `);
  const refresh = database.prepare(`
    UPDATE app_sessions
    SET idle_until = min(absolute_until, max(idle_until, ?))
    WHERE id = ? AND idle_until > ? AND absolute_until > ?
    RETURNING user_id
  `);
  const remove = database.prepare("DELETE FROM app_sessions WHERE id = ?");
  const removeUser = database.prepare(
    "DELETE FROM app_sessions WHERE user_id = ?",
  );
  const removeExpired = database.prepare(`
    DELETE FROM app_sessions WHERE idle_until <= ? RETURNING id
  `);

  function find(id, touch) {
    const timestamp = now();
    return touch
      ? refresh.get(timestamp + idleMs, id, timestamp, timestamp)
      : select.get(id, timestamp, timestamp);
  }

  return {
    orders: createOrderStore(database, now),
    create(userId) {
      if (typeof userId !== "string" || !userId)
        throw new Error("Session requires a user");
      const token = randomBytes(32).toString("base64url");
      const id = sessionId(token);
      const timestamp = now();
      insert.run(id, userId, timestamp + idleMs, timestamp + absoluteMs);
      return { token, id };
    },

    get(token, { touch = true } = {}) {
      const id = sessionId(token);
      const row = id && find(id, touch);
      return row ? { id, userId: row.user_id } : null;
    },

    isActive(id, { touch = false } = {}) {
      return Boolean(find(id, touch));
    },

    revoke(token) {
      const id = sessionId(token);
      return Boolean(id && remove.run(id).changes);
    },

    revokeUser(userId) {
      return removeUser.run(userId).changes;
    },

    prune() {
      return removeExpired.all(now()).map(({ id }) => id);
    },

    close() {
      database.close();
    },
  };
}
