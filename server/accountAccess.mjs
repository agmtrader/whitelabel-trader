import { createHash } from "node:crypto";

const identifierPattern = /^[A-Za-z0-9_.-]{1,64}$/;
const accountPattern = /^(?:U|DU)\d+$/;
const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return identifierPattern.test(username) ? username.toLowerCase() : null;
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) return null;
  const [local, domain] = email.split("@");
  if (
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    domain
      .split(".")
      .some(
        (label) =>
          label.length > 63 || label.startsWith("-") || label.endsWith("-"),
      )
  )
    return null;
  return email;
}

export function createAccountAccess(records) {
  if (!Array.isArray(records))
    throw new Error("Account links must be an array");

  const byUsername = new Map();
  const bySubject = new Map();
  const userIds = new Set();
  const emails = new Set();
  const accountIds = new Set();

  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      Object.keys(record).some(
        (key) =>
          !["userId", "ibkrUsername", "accountId", "email"].includes(key),
      )
    ) {
      throw new Error("Invalid account link configuration");
    }
    const { userId, ibkrUsername, accountId } = record;
    const email = normalizeEmail(record.email);
    if (
      typeof userId !== "string" ||
      !identifierPattern.test(userId) ||
      typeof ibkrUsername !== "string" ||
      !identifierPattern.test(ibkrUsername) ||
      typeof accountId !== "string" ||
      !accountPattern.test(accountId) ||
      !email
    ) {
      throw new Error("Invalid account link configuration");
    }
    const usernameKey = ibkrUsername.toLowerCase();
    if (
      userIds.has(userId) ||
      byUsername.has(usernameKey) ||
      accountIds.has(accountId) ||
      emails.has(email)
    ) {
      throw new Error("Duplicate account link configuration");
    }

    // Changed email or account links invalidate existing sessions after reload.
    const subject = createHash("sha256")
      .update(JSON.stringify([userId, ibkrUsername, accountId, email]))
      .digest("hex");
    const link = Object.freeze({
      userId,
      ibkrUsername,
      accountId,
      email: record.email.trim(),
      subject,
    });
    userIds.add(userId);
    emails.add(email);
    accountIds.add(accountId);
    byUsername.set(usernameKey, link);
    bySubject.set(subject, link);
  }

  return {
    findAccount(username) {
      return byUsername.get(username) ?? null;
    },
    getLink(subject) {
      return bySubject.get(subject) ?? null;
    },
  };
}

export function orderBelongsToAccount(order, accountId) {
  if (!order || typeof order !== "object") return false;
  const values = [
    order.acct,
    order.account,
    order.accountCode,
    order.acctId,
    order.accountId,
  ].filter((value) => value != null);
  return values.length > 0 && values.every((value) => value === accountId);
}
