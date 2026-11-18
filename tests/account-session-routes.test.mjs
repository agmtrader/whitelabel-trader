import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createTraderServer } from "../server/index.mjs";
import { createDatabaseAccountAccess } from "../server/databaseAccountAccess.mjs";

const aliceEmail = "alice@example.test";
const bobEmail = "bob@example.test";
const aliceUsername = "alice_ibkr";
const bobUsername = "bob_ibkr";
const aliceAccount = "DU11111";
const bobAccount = "DU22222";
const trustedOrigin = "http://127.0.0.1:8082";
const baseConfig = {
  accountLinks: [
    {
      userId: "alice",
      ibkrUsername: aliceUsername,
      accountId: aliceAccount,
      email: aliceEmail,
    },
    {
      userId: "bob",
      ibkrUsername: bobUsername,
      accountId: bobAccount,
      email: bobEmail,
    },
  ],
  security: {
    production: false,
    allowedOrigins: [trustedOrigin],
    trustedProxies: [],
    sessionFile: ":memory:",
    sessionIdleMs: 10_000,
    sessionAbsoluteMs: 30_000,
    maxBodyBytes: 256,
    requestTimeoutMs: 10_000,
    requestRatePerMinute: 120,
    loginRatePerMinute: 8,
  },
};
const ibkr = "/accounts/ibkr";

function databaseDirectory(rows) {
  return createDatabaseAccountAccess(
    {},
    {
      pool: {
        async query(sql, values) {
          return {
            rows: rows
              .filter((row) =>
                sql.includes("where a.id")
                  ? row.id === values[0]
                  : row.ibkr_username.trim().toLowerCase() === values[0],
              )
              .slice(0, 2),
          };
        },
        async end() {},
      },
    },
  );
}

// These fields match the existing AGM account/account_contact/contact schema.
const databaseAlice = {
  id: "0947957d-e8bc-4d86-aefb-e05094d6b05a",
  ibkr_username: " Alice_IBKR ",
  ibkr_account_number: aliceAccount,
  customer_email: aliceEmail,
  temporal_email: null,
  contact_emails: [aliceEmail],
};

test("database usernames receive codes without enrollment, including accounts added while running", async (t) => {
  const rows = [{ ...databaseAlice }];
  const fixture = brokerFixture();
  const api = await listen(
    t,
    { ...baseConfig, accountLinks: [] },
    {
      ...fixture,
      accountAccess: databaseDirectory(rows),
    },
  );
  for (const username of ["unknown_ibkr", "ALICE_IBKR", bobUsername]) {
    if (username === bobUsername)
      rows.push({
        ...databaseAlice,
        id: "0947957d-e8bc-4d86-aefb-e05094d6b05b",
        ibkr_username: bobUsername,
        ibkr_account_number: "F22222",
        customer_email: null,
        contact_emails: [bobEmail],
      });
    const issued = await api.requestCode(username);
    assert.equal(issued.status, 202);
    const { challengeId } = await issued.json();
    assert.deepEqual(Object.keys({ challengeId }), ["challengeId"]);
    if (username === "unknown_ibkr") {
      assert.equal(api.inbox.size, 0);
      continue;
    }
    const email = username === bobUsername ? bobEmail : aliceEmail;
    assert.match(api.inbox.get(email), /^\d{8}$/);
    const signedIn = await api.verify(challengeId, api.inbox.get(email));
    assert.equal(signedIn.status, 200);
    const { sessionId } = await signedIn.json();
    const status = await api.request(ibkr + "/sso/status", {
      token: sessionId,
    });
    await assertError(status, 409, "BROKER_RECONNECT");
  }
  assert.deepEqual(fixture.calls, []);
});

test("database email edits invalidate pending codes and issued sessions", async (t) => {
  const rows = [{ ...databaseAlice }];
  const api = await listen(
    t,
    { ...baseConfig, accountLinks: [] },
    {
      accountAccess: databaseDirectory(rows),
    },
  );
  const issued = await api.requestCode(aliceUsername).then((r) => r.json());
  rows[0].customer_email = bobEmail;
  await assertError(
    await api.verify(issued.challengeId, api.inbox.get(aliceEmail)),
    401,
    "INVALID_LOGIN_CODE",
  );

  const directory = databaseDirectory(rows);
  const link = await directory.findAccount(aliceUsername);
  // A fresh instance can resolve a persisted identity after an API restart.
  assert.deepEqual(await databaseDirectory(rows).getLink(link.subject), link);
  rows[0].ibkr_username = "changed_ibkr";
  assert.equal(await directory.getLink(link.subject), null);
  assert.equal(await directory.findAccount(aliceUsername), null);
});

test("ambiguous database users and missing mailboxes receive no code, lookup failures report unavailability", async (t) => {
  const rows = [
    { ...databaseAlice },
    { ...databaseAlice, id: "0947957d-e8bc-4d86-aefb-e05094d6b05b" },
  ];
  const directory = databaseDirectory(rows);
  assert.equal(await directory.findAccount(aliceUsername), null);
  rows.pop();
  rows[0].customer_email = null;
  rows[0].contact_emails = [aliceEmail, bobEmail];
  assert.equal(await directory.findAccount(aliceUsername), null);
  rows[0].customer_email = "temporary@example.test";
  rows[0].temporal_email = "temporary@example.test";
  assert.equal(await directory.findAccount(aliceUsername), null);
  const api = await listen(
    t,
    { ...baseConfig, accountLinks: [] },
    {
      accountAccess: createDatabaseAccountAccess(
        {},
        {
          pool: {
            async query() {
              throw new Error("private database details");
            },
            async end() {},
          },
        },
      ),
    },
  );
  await assertError(
    await api.requestCode(aliceUsername),
    503,
    "ACCOUNT_DIRECTORY_UNAVAILABLE",
  );
  assert.equal(api.inbox.size, 0);
});

function brokerFixture(overrides) {
  const calls = [];
  return {
    calls,
    createBroker() {
      let username;
      const ownAccount = () =>
        username === "alice_ibkr" ? aliceAccount : bobAccount;
      return {
        async createSsoSession(credential, ip) {
          username = credential;
          calls.push(["sso", credential, ip]);
        },
        async initializeBrokerageSession() {},
        async tickle() {
          return {
            connected: true,
            authenticated: true,
            competing: false,
            established: true,
          };
        },
        async getBrokerageAccounts() {
          return {
            accounts: [aliceAccount, bobAccount],
            selectedAccount: bobAccount,
            aliases: {
              [aliceAccount]: "Alice account",
              [bobAccount]: "Bob account",
            },
          };
        },
        async logout() {
          calls.push(["logout", username]);
        },
        async getOpenOrders() {
          return {
            orders: [
              { orderId: "alice-order", acct: aliceAccount },
              { orderId: "bob-order", account: bobAccount },
              {
                orderId: "conflicting",
                acct: aliceAccount,
                account: bobAccount,
              },
              { orderId: "unscoped" },
            ],
          };
        },
        async getAllWatchlists() {
          return {
            data: {
              user_lists: [{ id: ownAccount() }],
              system_lists: [{ id: "system" }],
            },
          };
        },
        async getWatchlistInformation(id) {
          calls.push(["watchlist", id]);
          return { id };
        },
        async getPortfolioAnalystPerformance(ids) {
          calls.push(["portfolio", ids]);
          return { ids };
        },
        async getMarketDataSnapshot() {
          return [];
        },
        ...overrides,
      };
    },
  };
}

async function listen(t, config, deps) {
  const inbox = new Map();
  const server = createTraderServer(config, {
    sendLoginCode: async (email, code) => {
      inbox.set(email, code);
    },
    ...deps,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  t.after(close);
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (path, { token, body, headers, ...init } = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        ...(token ? { "X-Trader-Session": token } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const requestCode = (username) =>
    request("/auth/challenge", { method: "POST", body: { username } });
  const verify = (challengeId, code) =>
    request("/auth/session", {
      method: "POST",
      body: { challengeId, code },
    });
  async function signIn(username) {
    const issued = await requestCode(username);
    const { email } = config.accountLinks.find(
      (link) => link.ibkrUsername === username,
    );
    assert.equal(issued.status, 202);
    assert.equal(issued.headers.get("cache-control"), "no-store");
    const { challengeId } = await issued.json();
    assert.match(inbox.get(email), /^\d{8}$/);
    const response = await verify(challengeId, inbox.get(email));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.deepEqual(Object.keys(result), ["sessionId"]);
    return result.sessionId;
  }
  const connect = (token, body = {}) =>
    request(ibkr + "/sso/connect", { token, method: "POST", body });
  return { request, requestCode, verify, inbox, signIn, connect, close };
}

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  if (code) assert.equal((await response.json()).code, code);
}

test("the route boundary authenticates before FD SSO and scopes reads for two accounts", async (t) => {
  const fixture = brokerFixture();
  const { request, signIn, connect } = await listen(t, baseConfig, fixture);

  await assertError(await connect(), 401, "APP_SESSION_REQUIRED");
  await assertError(await connect("x".repeat(43)), 401, "APP_SESSION_REQUIRED");
  await assertError(
    await request("/auth/session", {
      method: "POST",
      body: { accessKey: "alice_ibkr" },
    }),
    400,
  );
  await assertError(
    await request(ibkr + "/sso/create", {
      method: "POST",
      body: { credential: "alice_ibkr", ip: "192.0.2.123" },
    }),
    404,
  );
  assert.deepEqual(fixture.calls, []);

  const alice = await signIn(aliceUsername);
  const bob = await signIn(bobUsername);
  await assertError(
    await request(ibkr + "/orders", { token: alice }),
    409,
    "BROKER_RECONNECT",
  );
  await assertError(await connect(alice, { credential: "bob_ibkr" }), 400);
  assert.deepEqual(fixture.calls, []);

  const connectedAlice = await connect(alice);
  const connectedBob = await connect(bob);
  assert.equal(connectedAlice.status, 200);
  assert.equal(connectedBob.status, 200);
  assert.deepEqual(await connectedAlice.json(), {
    accounts: [aliceAccount],
    aliases: { [aliceAccount]: "Alice account" },
    allowFeatures: { allowedAssetTypes: "" },
    selectedAccount: aliceAccount,
    username: "alice_ibkr",
  });
  assert.deepEqual((await connectedBob.json()).accounts, [bobAccount]);
  assert.deepEqual(fixture.calls, [
    ["sso", "alice_ibkr", "127.0.0.1"],
    ["sso", "bob_ibkr", "127.0.0.1"],
  ]);

  for (const [token, account, otherAccount, orderId] of [
    [alice, aliceAccount, bobAccount, "alice-order"],
    [bob, bobAccount, aliceAccount, "bob-order"],
  ]) {
    const orders = await request(ibkr + "/orders", { token }).then((response) =>
      response.json(),
    );
    assert.deepEqual(
      orders.orders.map((row) => row.orderId),
      [orderId],
    );
    await assertError(
      await request(ibkr + "/portfolio-analyst", {
        token,
        method: "POST",
        body: { acctIds: [otherAccount] },
      }),
      403,
      "RESOURCE_DENIED",
    );
    assert.equal(
      (
        await request(ibkr + "/portfolio-analyst", {
          token,
          method: "POST",
          body: { acctIds: [account] },
        })
      ).status,
      200,
    );
    await assertError(
      await request(ibkr + "/watchlist?id=" + otherAccount, { token }),
      403,
      "RESOURCE_DENIED",
    );
    assert.equal(
      (await request(ibkr + "/watchlist?id=" + account, { token })).status,
      200,
    );
  }
  assert.deepEqual(fixture.calls.slice(2), [
    ["portfolio", [aliceAccount]],
    ["watchlist", aliceAccount],
    ["portfolio", [bobAccount]],
    ["watchlist", bobAccount],
  ]);
  for (const [method, path] of [
    ["POST", "/orders"],
    ["POST", "/orders/reply/another-account"],
    ["DELETE", "/orders/another-account"],
  ]) {
    await assertError(
      await request(ibkr + path, { token: alice, method }),
      404,
    );
  }
});

test("a provider mismatch or incomplete brokerage session grants no account data", async (t) => {
  let established = false;
  const fixture = brokerFixture({
    async tickle() {
      return {
        connected: true,
        authenticated: true,
        competing: false,
        established,
      };
    },
    async getBrokerageAccounts() {
      return { accounts: [bobAccount] };
    },
  });
  const { request, signIn, connect } = await listen(t, baseConfig, fixture);
  const token = await signIn(aliceUsername);
  await assertError(await connect(token), 409, "BROKER_RECONNECT");
  established = true;
  await assertError(await connect(token), 403, "ACCOUNT_MISMATCH");
  await assertError(
    await request(ibkr + "/sso/accounts", { token }),
    409,
    "BROKER_RECONNECT",
  );
});

test("logout revokes immediately despite a failed broker logout and suppresses an in-flight read", async (t) => {
  let readStarted;
  let finishRead;
  const started = new Promise((resolve) => {
    readStarted = resolve;
  });
  const pending = new Promise((resolve) => {
    finishRead = resolve;
  });
  const fixture = brokerFixture({
    async getOpenOrders() {
      readStarted();
      return pending;
    },
    async logout() {
      throw new Error("upstream response with sensitive account data");
    },
  });
  const { request, signIn, connect } = await listen(t, baseConfig, fixture);
  const token = await signIn(aliceUsername);
  assert.equal((await connect(token)).status, 200);
  const inFlight = request(ibkr + "/orders", { token });
  await started;
  try {
    const signedOut = await request("/auth/session", {
      token,
      method: "DELETE",
    });
    assert.equal(signedOut.status, 200);
    assert.deepEqual(await signedOut.json(), { brokerLogoutConfirmed: false });
    await assertError(await connect(token), 401, "APP_SESSION_REQUIRED");
  } finally {
    finishRead({ orders: [{ orderId: "order", acct: aliceAccount }] });
  }
  await assertError(await inFlight, 401, "APP_SESSION_REQUIRED");
});

test("responses and structured logs omit provider errors and session secrets", async (t) => {
  const privateResponse = "private-provider-token-and-account";
  const logs = [];
  t.mock.method(console, "info", (entry) => logs.push(entry));
  const fixture = brokerFixture({
    async createSsoSession() {
      throw new Error(privateResponse);
    },
  });
  const { signIn, connect } = await listen(t, baseConfig, fixture);
  const token = await signIn(aliceUsername);
  const response = await connect(token);
  assert.equal(response.status, 502);
  const body = await response.text();
  const recorded = logs.join("\n") + body;
  for (const secret of [
    aliceEmail,
    token,
    aliceAccount,
    "alice_ibkr",
    privateResponse,
  ]) {
    assert.equal(recorded.includes(secret), false);
  }
  assert.deepEqual(logs.map(JSON.parse), [
    {
      service: "trader-server",
      event: "request_failed",
      route: "connect",
      statusCode: 502,
    },
  ]);
});

test("idle and absolute expiry, reconnect after restart, durable revocation and link rotation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "trader-sessions-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = {
    ...baseConfig,
    security: {
      ...baseConfig.security,
      sessionFile: join(directory, "sessions.sqlite"),
    },
  };
  let time = 1_000;
  const deps = { ...brokerFixture(), now: () => time };

  const first = await listen(t, config, deps);
  const idle = await first.signIn(aliceUsername);
  assert.equal((await first.connect(idle)).status, 200);
  time += 9_999;
  assert.equal(
    (await first.request(ibkr + "/sso/status", { token: idle })).status,
    200,
  );
  time++;
  await assertError(await first.connect(idle), 401, "APP_SESSION_REQUIRED");

  time += 60_000;
  const absolute = await first.signIn(aliceUsername);
  assert.equal((await first.connect(absolute)).status, 200);
  for (let refresh = 0; refresh < 3; refresh++) {
    time += 9_000;
    assert.equal(
      (await first.request(ibkr + "/orders", { token: absolute })).status,
      200,
    );
  }
  time += 3_000;
  await assertError(await first.connect(absolute), 401, "APP_SESSION_REQUIRED");
  time += 60_000;
  const reconnect = await first.signIn(aliceUsername);
  const rotated = await first.signIn(bobUsername);
  await first.close();

  const second = await listen(t, config, deps);
  await assertError(
    await second.request(ibkr + "/orders", { token: reconnect }),
    409,
    "BROKER_RECONNECT",
  );
  assert.equal((await second.connect(reconnect)).status, 200);
  assert.equal(
    (
      await second.request("/auth/session", {
        token: reconnect,
        method: "DELETE",
      })
    ).status,
    204,
  );
  await second.close();

  const third = await listen(
    t,
    {
      ...config,
      accountLinks: [
        config.accountLinks[0],
        { ...config.accountLinks[1], email: "bob-new@example.test" },
      ],
    },
    deps,
  );
  await assertError(
    await third.connect(reconnect),
    401,
    "APP_SESSION_REQUIRED",
  );
  await assertError(await third.connect(rotated), 401, "APP_SESSION_REQUIRED");
});

test("origin and request limits run before a broker call and valid logout survives rate limits", async (t) => {
  const fixture = brokerFixture();
  const config = {
    ...baseConfig,
    security: {
      ...baseConfig.security,
      loginRatePerMinute: 3,
      requestRatePerMinute: 7,
    },
  };
  const { request, signIn, connect } = await listen(t, config, fixture);
  await assertError(
    await request("/auth/challenge", {
      method: "POST",
      headers: { Origin: "https://untrusted.test" },
      body: { username: aliceUsername },
    }),
    403,
  );
  await assertError(
    await request("/auth/challenge", {
      method: "POST",
      headers: { Origin: "null" },
      body: { username: aliceUsername },
    }),
    403,
  );
  const preflight = await request("/auth/session", {
    method: "OPTIONS",
    headers: {
      Origin: trustedOrigin,
      "Access-Control-Request-Method": "DELETE",
      "Access-Control-Request-Headers": "content-type,x-trader-session",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    trustedOrigin,
  );
  await assertError(
    await request("/auth/challenge", {
      method: "POST",
      body: { username: "x".repeat(500) },
    }),
    413,
  );
  const token = await signIn(aliceUsername);
  await assertError(
    await request("/auth/challenge", {
      method: "POST",
      body: { username: "not a username" },
    }),
    400,
    "INVALID_USERNAME",
  );
  const limit = await request("/auth/challenge", {
    method: "POST",
    body: { username: bobUsername },
  });
  assert.equal(limit.status, 429);
  assert.match(limit.headers.get("retry-after"), /^\d+$/);
  assert.equal((await connect(token)).status, 200);
  assert.equal((await connect(token)).status, 429);
  assert.equal(
    (await request("/auth/session", { token, method: "DELETE" })).status,
    204,
  );
});

test("username challenges deliver only to the verified email and disclose no account details", async (t) => {
  const fixture = brokerFixture();
  const { request, inbox, requestCode, verify, connect } = await listen(
    t,
    baseConfig,
    fixture,
  );
  await assertError(
    await request("/auth/challenge", {
      method: "POST",
      body: { username: aliceUsername, email: bobEmail },
    }),
    400,
  );
  await assertError(await requestCode(aliceEmail), 400, "INVALID_USERNAME");
  assert.deepEqual([...inbox.keys()], []);
  const registered = await requestCode(" ALICE_IBKR ");
  const unregistered = await requestCode("unknown_user");
  assert.equal(registered.status, 202);
  assert.equal(unregistered.status, registered.status);
  const known = await registered.json();
  const unknown = await unregistered.json();
  assert.deepEqual(Object.keys(known), ["challengeId"]);
  assert.deepEqual(Object.keys(unknown), Object.keys(known));
  assert.match(known.challengeId, /^[A-Za-z0-9_-]{43}$/);
  assert.match(unknown.challengeId, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual([...inbox.keys()], [aliceEmail]);
  const code = inbox.get(aliceEmail);
  assert.match(code, /^\d{8}$/);
  assert.deepEqual(fixture.calls, []);
  await assertError(
    await verify(unknown.challengeId, code),
    401,
    "INVALID_LOGIN_CODE",
  );
  const wrong = code === "00000000" ? "00000001" : "00000000";
  await assertError(
    await verify(known.challengeId, wrong),
    401,
    "INVALID_LOGIN_CODE",
  );
  const verified = await verify(known.challengeId, code);
  assert.equal(verified.status, 200);
  const { sessionId } = await verified.json();
  await assertError(
    await verify(known.challengeId, code),
    401,
    "INVALID_LOGIN_CODE",
  );
  const account = await connect(sessionId).then((response) => response.json());
  assert.deepEqual(account.accounts, [aliceAccount]);
});

test("login codes expire, stop after five misses, and are replaced by resend", async (t) => {
  let time = 10_000;
  const { requestCode, verify, inbox } = await listen(t, baseConfig, {
    ...brokerFixture(),
    now: () => time,
  });
  const issue = async () => {
    const response = await requestCode(aliceUsername);
    assert.equal(response.status, 202);
    const { challengeId } = await response.json();
    return { challengeId, code: inbox.get(aliceEmail) };
  };

  const first = await issue();
  const cooldown = await requestCode(" ALICE_IBKR ");
  assert.equal(cooldown.status, 429);
  assert.equal(cooldown.headers.get("retry-after"), "60");
  time += 60_000;
  const resent = await issue();
  await assertError(
    await verify(first.challengeId, first.code),
    401,
    "INVALID_LOGIN_CODE",
  );
  const wrong = resent.code === "00000000" ? "00000001" : "00000000";
  for (let attempt = 0; attempt < 5; attempt++) {
    await assertError(
      await verify(resent.challengeId, wrong),
      401,
      "INVALID_LOGIN_CODE",
    );
  }
  await assertError(
    await verify(resent.challengeId, resent.code),
    401,
    "INVALID_LOGIN_CODE",
  );

  time += 60_000;
  const expiring = await issue();
  time += 10 * 60_000;
  await assertError(
    await verify(expiring.challengeId, expiring.code),
    401,
    "INVALID_LOGIN_CODE",
  );
});

test("the app reports unavailable delivery without identifying registered usernames", async (t) => {
  const { requestCode } = await listen(t, baseConfig, {
    ...brokerFixture(),
    sendLoginCode: undefined,
  });
  for (const username of [aliceUsername, "unknown_user"]) {
    await assertError(await requestCode(username), 503, "EMAIL_UNAVAILABLE");
  }
});
