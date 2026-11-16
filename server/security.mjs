import { Buffer } from "node:buffer";
import { isIP } from "node:net";

const minute = 60_000;
const maxRateKeys = 20_000;
const allowedRequestHeaders = new Set(["content-type", "x-trader-session"]);

export function httpError(statusCode, message, options = {}) {
  return Object.assign(new Error(message), options, { statusCode });
}

export function canonicalIp(value) {
  if (typeof value !== "string" || value.includes("%")) return null;
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6) return null;

  const address = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(address);
  if (!mapped) return address;

  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function createRateLimit(limit, now) {
  const buckets = new Map();
  let sweepAt = 0;

  return (key) => {
    const timestamp = now();
    if (timestamp >= sweepAt) {
      for (const [item, bucket] of buckets) {
        if (bucket.expiresAt <= timestamp) buckets.delete(item);
      }
      sweepAt = timestamp + minute;
    }

    let bucket = buckets.get(key);
    if (!bucket && buckets.size >= maxRateKeys) {
      throw httpError(429, "Too many requests", {
        retryAfter: Math.max(1, Math.ceil((sweepAt - timestamp) / 1000)),
      });
    }
    if (!bucket || bucket.expiresAt <= timestamp) {
      bucket = { count: 0, expiresAt: timestamp + minute };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      throw httpError(429, "Too many requests", {
        retryAfter: Math.max(
          1,
          Math.ceil((bucket.expiresAt - timestamp) / 1000),
        ),
      });
    }
    bucket.count += 1;
  };
}

export function createRequestSecurity(config, { now = Date.now } = {}) {
  const origins = new Set(config.allowedOrigins);
  const trustedProxies = new Set(config.trustedProxies);
  const limitIp = createRateLimit(config.requestRatePerMinute, now);
  const limitLogin = createRateLimit(config.loginRatePerMinute, now);
  const limitUser = createRateLimit(config.requestRatePerMinute, now);

  function getClientIp(request) {
    const peer = canonicalIp(request.socket.remoteAddress);
    if (!peer) throw httpError(400, "Unknown client address");
    if (!trustedProxies.has(peer)) return peer;

    // A trusted ingress must append the actual connecting client address last.
    const forwarded = request.headers["x-forwarded-for"];
    const clientIp =
      typeof forwarded === "string" &&
      canonicalIp(forwarded.slice(forwarded.lastIndexOf(",") + 1).trim());
    if (!clientIp) throw httpError(400, "Invalid forwarded client address");
    return clientIp;
  }

  return {
    getClientIp,

    checkTransport(request) {
      if (!config.production) return;
      const peer = canonicalIp(request.socket.remoteAddress);
      if (
        !trustedProxies.has(peer) ||
        request.headers["x-forwarded-proto"] !== "https"
      ) {
        throw httpError(403, "HTTPS ingress required");
      }
    },

    checkOrigin(request, response) {
      response.setHeader("Vary", "Origin");
      const origin = request.headers.origin;
      if (origin === undefined) return;
      if (!origins.has(origin)) throw httpError(403, "Origin not allowed");
      response.setHeader("Access-Control-Allow-Origin", origin);
    },

    preflight(request, response, methods = ["GET", "POST"]) {
      const origin = request.headers.origin;
      const method = request.headers["access-control-request-method"];
      const requestedHeaders =
        request.headers["access-control-request-headers"];
      const headers =
        typeof requestedHeaders === "string"
          ? requestedHeaders
              .split(",")
              .map((header) => header.trim().toLowerCase())
          : [];
      response.setHeader(
        "Vary",
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      );
      if (
        !origins.has(origin) ||
        !methods.includes(method) ||
        headers.some((header) => !allowedRequestHeaders.has(header))
      ) {
        throw httpError(403, "Preflight not allowed");
      }
      response.setHeader("Access-Control-Allow-Methods", methods.join(", "));
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Trader-Session",
      );
      response.writeHead(204);
      response.end();
    },

    checkRate(request, { login = false } = {}) {
      const ip = getClientIp(request);
      limitIp(ip);
      if (login) limitLogin(ip);
    },

    checkUserRate(userId) {
      limitUser(userId);
    },
  };
}

export async function readJson(request, maxBytes) {
  const tooLarge = () =>
    httpError(413, "Request body too large", { closeConnection: true });
  if (Number(request.headers["content-length"]) > maxBytes) throw tooLarge();
  const encoding = request.headers["content-encoding"];
  if (encoding !== undefined && encoding !== "identity") {
    throw httpError(415, "Unsupported content encoding", {
      closeConnection: true,
    });
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  if (size === 0) return {};

  const contentType = request.headers["content-type"];
  if (contentType?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw httpError(415, "Content-Type must be application/json");
  }
  let body;
  try {
    body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks, size),
      ),
    );
  } catch {
    throw httpError(400, "Invalid JSON request body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Request body must be a JSON object");
  }
  return body;
}
