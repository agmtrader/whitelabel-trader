import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { httpError } from "./security.mjs";

const minute = 60_000;
export const loginCodeMinutes = 10;
const codeLifetime = loginCodeMinutes * minute;
const resendAfter = minute;
const recipientWindow = 60 * minute;
const maxRequests = 5;
const maxAttempts = 5;
const maxRecipients = 10_000;
const maxDeliveries = 25;
const idPattern = /^[A-Za-z0-9_-]{43}$/;
const codePattern = /^\d{8}$/;

export function createLoginChallenges({
  findAccount,
  sendLoginCode,
  onDeliveryError,
  now = Date.now,
}) {
  const secret = randomBytes(32);
  const recipients = new Map();
  const pending = new Map();
  let nextSweep = 0;
  let deliveries = 0;
  const digest = (...parts) =>
    createHmac("sha256", secret).update(JSON.stringify(parts)).digest();

  function request(username) {
    if (!sendLoginCode || deliveries >= maxDeliveries) {
      throw httpError(503, "Email delivery unavailable", {
        code: "EMAIL_UNAVAILABLE",
      });
    }
    const timestamp = now();
    if (timestamp >= nextSweep) {
      for (const [id, challenge] of pending) {
        if (challenge.expiresAt <= timestamp) pending.delete(id);
      }
      for (const [key, recipient] of recipients) {
        if (
          recipient.expiresAt <= timestamp &&
          !pending.has(recipient.challengeId)
        ) {
          recipients.delete(key);
        }
      }
      nextSweep = timestamp + minute;
    }

    const key = digest("username", username).toString("hex");
    let recipient = recipients.get(key);
    if (!recipient || recipient.expiresAt <= timestamp) {
      if (!recipient && recipients.size >= maxRecipients) {
        throw httpError(429, "Too many code requests", { retryAfter: 60 });
      }
      recipient = {
        count: 0,
        expiresAt: timestamp + recipientWindow,
        challengeId: recipient?.challengeId,
      };
      recipients.set(key, recipient);
    }

    const blockedUntil =
      recipient.count >= maxRequests
        ? recipient.expiresAt
        : (recipient.nextRequestAt ?? 0);
    if (blockedUntil > timestamp) {
      throw httpError(429, "Too many code requests", {
        retryAfter: Math.ceil((blockedUntil - timestamp) / 1000),
      });
    }

    const link = findAccount(username);
    const id = randomBytes(32).toString("base64url");
    const code = String(randomInt(100_000_000)).padStart(8, "0");
    if (recipient.challengeId) pending.delete(recipient.challengeId);
    Object.assign(recipient, {
      count: recipient.count + 1,
      nextRequestAt: timestamp + resendAfter,
      challengeId: id,
    });
    pending.set(id, {
      digest: digest("code", id, code),
      expiresAt: timestamp + codeLifetime,
      attempts: 0,
      link,
    });

    if (link) {
      deliveries++;
      // Send after the HTTP response, keeping the response independent of email delivery.
      setImmediate(async () => {
        try {
          await sendLoginCode(link.email, code);
        } catch {
          pending.delete(id);
          onDeliveryError();
        } finally {
          deliveries--;
        }
      });
    }
    return id;
  }

  function consume(id, code) {
    if (
      typeof id !== "string" ||
      !idPattern.test(id) ||
      typeof code !== "string" ||
      !codePattern.test(code)
    )
      return null;
    const challenge = pending.get(id);
    if (!challenge) return null;
    if (challenge.expiresAt <= now()) {
      pending.delete(id);
      return null;
    }

    const matches = timingSafeEqual(challenge.digest, digest("code", id, code));
    challenge.attempts++;
    if (matches || challenge.attempts >= maxAttempts) pending.delete(id);
    return matches ? challenge.link : null;
  }

  return { request, consume };
}
