import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { loadConfig } from "../server/config.mjs";
import { createRequestSecurity, readJson } from "../server/security.mjs";
import { createSessionStore } from "../server/sessionStore.mjs";

test("idle and absolute deadlines expire independently of cleanup", () => {
  let timestamp = 0;
  const store = createSessionStore({
    filename: ":memory:",
    idleMs: 30,
    absoluteMs: 70,
    now: () => timestamp,
  });
  try {
    const idle = store.create("alice");
    const busy = store.create("bob");
    timestamp = 25;
    assert.deepEqual(store.get(idle.token, { touch: false }), {
      id: idle.id,
      userId: "alice",
    });
    assert.equal(store.get(busy.token).userId, "bob");
    timestamp = 30;
    assert.equal(store.get(idle.token), null);
    assert.deepEqual(store.prune(), [idle.id]);
    timestamp = 50;
    assert.ok(store.isActive(busy.id, { touch: true }));
    timestamp = 69;
    assert.ok(store.get(busy.token));
    timestamp = 70;
    assert.equal(store.get(busy.token), null);
    assert.equal(store.isActive(busy.id), false);
  } finally {
    store.close();
  }
});

test("session storage survives restart without writing tokens and refuses overlapping stores", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "trader-security-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "sessions.sqlite");
  const options = { filename, idleMs: 1_000, absoluteMs: 2_000, now: () => 0 };
  const first = createSessionStore(options);
  let active;
  let revoked;
  try {
    active = first.create("alice");
    revoked = first.create("bob");
    assert.equal(first.revoke(revoked.token), true);
    assert.throws(() => createSessionStore(options), /locked/i);
  } finally {
    first.close();
  }
  assert.equal(statSync(filename).mode & 0o077, 0);
  assert.equal(readFileSync(filename).includes(active.token), false);
  assert.equal(readFileSync(filename).includes(revoked.token), false);
  const restarted = createSessionStore(options);
  try {
    assert.equal(restarted.get(active.token).userId, "alice");
    assert.equal(restarted.get(revoked.token), null);
    assert.equal(restarted.get("x".repeat(43)), null);
    assert.equal(restarted.revokeUser("alice"), 1);
    assert.equal(restarted.get(active.token), null);
  } finally {
    restarted.close();
  }
});

const securitySettings = {
  production: true,
  allowedOrigins: ["https://trader.example.com"],
  trustedProxies: ["10.0.0.1"],
  requestRatePerMinute: 3,
  loginRatePerMinute: 1,
};

function request(headers = {}, remoteAddress = "10.0.0.1") {
  return { headers, socket: { remoteAddress } };
}

function response() {
  const headers = new Map();
  return {
    headers,
    setHeader(name, value) {
      headers.set(name, value);
    },
    writeHead(status) {
      this.statusCode = status;
    },
    end() {},
  };
}

test("origin and preflight rules deny foreign origins, methods and headers", () => {
  const security = createRequestSecurity(securitySettings);
  for (const origin of [
    "null",
    "https://trader.example.com.example.net",
    "http://trader.example.com",
  ]) {
    assert.throws(() => security.checkOrigin(request({ origin }), response()), {
      statusCode: 403,
    });
  }
  const headers = {
    origin: securitySettings.allowedOrigins[0],
    "access-control-request-method": "DELETE",
    "access-control-request-headers": "content-type, X-Trader-Session",
  };
  const allowed = response();
  security.checkOrigin(request(headers), allowed);
  security.preflight(request(headers), allowed, ["DELETE"]);
  assert.equal(allowed.statusCode, 204);
  assert.equal(
    allowed.headers.get("Access-Control-Allow-Origin"),
    headers.origin,
  );
  assert.equal(allowed.headers.get("Access-Control-Allow-Methods"), "DELETE");
  assert.throws(() => security.preflight(request(headers), response()), {
    statusCode: 403,
  });
  const wrongHeader = {
    ...headers,
    "access-control-request-headers": "X-Unapproved",
  };
  assert.throws(
    () => security.preflight(request(wrongHeader), response(), ["DELETE"]),
    {
      statusCode: 403,
    },
  );
});

test("only an explicit HTTPS ingress can forward the client address", () => {
  const security = createRequestSecurity(securitySettings);
  const forwarded = {
    "x-forwarded-for": "203.0.113.10, 192.0.2.10",
    "x-forwarded-proto": "https",
  };
  const trusted = request(forwarded, "::ffff:10.0.0.1");
  assert.doesNotThrow(() => security.checkTransport(trusted));
  assert.equal(security.getClientIp(trusted), "192.0.2.10");
  const direct = request(forwarded, "192.0.2.20");
  assert.throws(() => security.checkTransport(direct), { statusCode: 403 });
  assert.equal(security.getClientIp(direct), "192.0.2.20");
  assert.throws(() => security.checkTransport(request()), { statusCode: 403 });
  assert.throws(
    () =>
      security.getClientIp(
        request({ "x-forwarded-for": "192.0.2.10, bad-address" }),
      ),
    { statusCode: 400 },
  );
});

test("login, client and app-user rates have independent counters and reset", () => {
  let timestamp = 0;
  const security = createRequestSecurity(securitySettings, {
    now: () => timestamp,
  });
  const aliceRequest = request({}, "192.0.2.20");
  const bobRequest = request({}, "192.0.2.21");
  security.checkRate(aliceRequest, { login: true });
  assert.throws(() => security.checkRate(aliceRequest, { login: true }), {
    statusCode: 429,
    retryAfter: 60,
  });
  security.checkRate(aliceRequest);
  assert.throws(() => security.checkRate(aliceRequest), { statusCode: 429 });
  security.checkRate(bobRequest, { login: true });
  for (let count = 0; count < 3; count += 1) security.checkUserRate("alice");
  assert.throws(() => security.checkUserRate("alice"), { statusCode: 429 });
  security.checkUserRate("bob");
  timestamp = 60_000;
  security.checkRate(aliceRequest, { login: true });
  security.checkUserRate("alice");
});

function jsonStream(chunks, headers = {}) {
  return Object.assign(
    Readable.from(chunks.map((chunk) => Buffer.from(chunk))),
    {
      headers: { "content-type": "application/json", ...headers },
    },
  );
}

test("JSON reader bounds declared and streamed bodies and rejects ambiguous inputs", async () => {
  assert.deepEqual(await readJson(jsonStream(['{"a":1}']), 8), { a: 1 });
  await assert.rejects(readJson(jsonStream([], { "content-length": "9" }), 8), {
    statusCode: 413,
    closeConnection: true,
  });
  await assert.rejects(readJson(jsonStream(["1234", "56789"]), 8), {
    statusCode: 413,
    closeConnection: true,
  });
  await assert.rejects(readJson(jsonStream(["not-json"]), 20), {
    statusCode: 400,
  });
  await assert.rejects(readJson(jsonStream(["[]"]), 8), { statusCode: 400 });
  await assert.rejects(
    readJson(jsonStream(["{}"], { "content-type": "text/plain" }), 8),
    {
      statusCode: 415,
    },
  );
});

test("production checks configuration before reading the explicit secrets", async () => {
  const production = {
    NODE_ENV: "production",
    GCLOUD_PROJECT: "trader-example",
    TRADER_API_HOST: "127.0.0.1",
    TRADER_ALLOWED_ORIGINS: "https://trader.example.com",
    TRADER_TRUSTED_PROXIES: "127.0.0.1",
    TRADER_SESSION_FILE: "/private/var/lib/trader/sessions.sqlite",
    TRADER_ACCOUNT_LINKS_SECRET_VERSION:
      "projects/trader-example/secrets/links/versions/2",
    TRADER_SMTP_SECRET_VERSION:
      "projects/trader-example/secrets/smtp/versions/1",
    IBKR_PRIVATE_KEY_SECRET_VERSION:
      "projects/trader-example/secrets/key/versions/1",
    IBKR_FD_MASTER_ACCOUNT: "I90000",
    IBKR_FD_CLIENT_ID: "example-fd",
    IBKR_FD_KEY_ID: "example-key",
    IBKR_BASE_URL: "https://api.ibkr.com",
  };
  const links = [{ userId: "test-user" }];
  const smtp = {
    host: "mail.example.test",
    port: 587,
    username: "fixture-user",
    password: "fixture-pass",
    from: "trader@example.test",
  };
  const agmMailResource = "projects/trader-example/secrets/agm-mail/versions/1";
  const agmMail = {
    baseUrl: "https://agm-api.example.test",
    email: "trader@example.test",
    password: "fixture-service-credential",
  };
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const resources = [];
  const secretClient = {
    async accessSecretVersion({ name }) {
      resources.push(name);
      const data =
        name === production.TRADER_ACCOUNT_LINKS_SECRET_VERSION
          ? JSON.stringify(links)
          : name === production.TRADER_SMTP_SECRET_VERSION
            ? JSON.stringify(smtp)
            : name === agmMailResource
              ? JSON.stringify(agmMail)
              : privateKey;
      return [{ payload: { data: Buffer.from(data) } }];
    },
  };
  for (const change of [
    { TRADER_ALLOWED_ORIGINS: "*" },
    { TRADER_TRUSTED_PROXIES: "127.0.0.0/8" },
    { TRADER_SESSION_FILE: ":memory:" },
    { TRADER_IBKR_CLIENT_IP: "192.0.2.10" },
    { TRADER_ACCOUNT_LINKS_SECRET_VERSION: undefined },
    { IBKR_FD_MASTER_ACCOUNT: undefined },
    { TRADER_SMTP_SECRET_VERSION: undefined },
    { TRADER_SMTP_CONFIG_FILE: "/tmp/production-forbidden.json" },
    { TRADER_AGM_MAIL_CONFIG_FILE: "/tmp/production-forbidden.json" },
    { TRADER_AGM_MAIL_SECRET_VERSION: agmMailResource },
    { IBKR_BASE_URL: "https://broker.example.com" },
    { IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY: "inline-development-only" },
  ]) {
    await assert.rejects(
      loadConfig({ env: { ...production, ...change }, secretClient }),
    );
  }
  assert.deepEqual(resources, []);
  const config = await loadConfig({ env: production, secretClient });
  assert.deepEqual(config.accountLinks, links);
  assert.deepEqual(config.smtp, smtp);
  assert.equal(config.privateKey.asymmetricKeyType, "rsa");
  assert.equal(config.fdMasterAccount, production.IBKR_FD_MASTER_ACCOUNT);
  assert.deepEqual(resources, [
    production.TRADER_ACCOUNT_LINKS_SECRET_VERSION,
    production.TRADER_SMTP_SECRET_VERSION,
    production.IBKR_PRIVATE_KEY_SECRET_VERSION,
  ]);
  resources.length = 0;
  const agmConfig = await loadConfig({
    env: {
      ...production,
      TRADER_SMTP_SECRET_VERSION: undefined,
      TRADER_AGM_MAIL_SECRET_VERSION: agmMailResource,
    },
    secretClient,
  });
  assert.deepEqual(agmConfig.agmMail, agmMail);
  assert.equal(agmConfig.smtp, undefined);
  assert.deepEqual(resources, [
    production.TRADER_ACCOUNT_LINKS_SECRET_VERSION,
    agmMailResource,
    production.IBKR_PRIVATE_KEY_SECRET_VERSION,
  ]);
});
