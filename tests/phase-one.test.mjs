import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { IBKRTradingAPI } from "../server/ibkrTradingApi.mjs";
import { links, startHarness } from "./fixtures/trader.mjs";

const prefix = "/accounts/ibkr";
const ticket = {
  conid: 265598,
  side: "BUY",
  quantity: 1,
  orderType: "LMT",
  price: 100,
};
async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
async function review(harness, token, input = ticket, modifyOrderId) {
  return json(
    await harness.request(prefix + "/orders/preview", {
      token,
      body: { ticket: input, modifyOrderId },
    }),
  );
}
async function submit(harness, token, id) {
  return json(
    await harness.request(prefix + `/orders/${id}/submit`, {
      token,
      body: { confirmed: true },
    }),
  );
}
const writes = (harness) =>
  harness.calls.filter(
    ([, method, path]) =>
      method === "DELETE" ||
      (method === "POST" &&
        (/\/orders$/.test(path) ||
          path.startsWith("/iserver/reply/") ||
          /\/order\/\d+$/.test(path))),
  );

test("live, paper and other verified account prefixes use the same ownership boundary", async (t) => {
  const h = await startHarness(t);
  for (const link of links) {
    const token = await h.signIn(link.ibkrUsername);
    const portfolio = await json(
      await h.request(prefix + "/portfolio", { token }),
    );
    assert.equal(portfolio.accountId, link.accountId);
    assert.equal(portfolio.summary.netLiquidation.value, 0);
    assert.equal(portfolio.summary.availableFunds.value, null);
    assert.deepEqual(
      portfolio.cash.map((row) => row.currency),
      ["USD", "EUR"],
    );
    assert.equal(portfolio.cash[1].balance, 0);
    assert.equal(portfolio.positions[0].unrealizedPnl, 0);
    assert.equal((await review(h, token)).state, "previewed");
    const override = await h.request(prefix + "/portfolio?accountId=U99999", {
      token,
    });
    assert.equal(override.status, 400);
  }
  assert.equal(
    (await h.request(prefix + "/portfolio", { token: "x".repeat(43) })).status,
    401,
  );
});

test("portfolio reads every page and retains non-stock holdings without invented values", async (t) => {
  const h = await startHarness(t, { state: { positionCount: 201 } });
  const token = await h.signIn();
  const result = await json(await h.request(prefix + "/portfolio", { token }));
  assert.equal(result.positions.length, 201);
  assert.equal(result.positions[1].assetClass, "BOND");
  assert.equal(result.positions[1].tradableAsset, false);
  assert.equal(result.positions[0].averageCost, null);
  assert.equal(
    h.calls.filter(([, , path]) => path.includes("/positions/")).length,
    3,
  );
  const firstRead = h.calls.findIndex(
    ([, , path]) => path === "/portfolio/accounts",
  );
  assert.ok(
    firstRead < h.calls.findIndex(([, , path]) => path.includes("/positions/")),
  );
});

test("portfolio partial failures and cross-account rows remain explicit", async (t) => {
  const h = await startHarness(t);
  const token = await h.signIn();
  const state = h.states.get("alice_ibkr");
  state.failPath = "/summary";
  state.failStatus = 429;
  const partial = await json(await h.request(prefix + "/portfolio", { token }));
  assert.deepEqual(partial.errors, ["summary"]);
  assert.equal(partial.summary, null);
  assert.equal(partial.positions.length, 1);
  state.failPath = null;
  state.foreignPosition = true;
  const rejected = await json(
    await h.request(prefix + "/portfolio", { token }),
    403,
  );
  assert.equal(rejected.code, "ACCOUNT_MISMATCH");
});

test("preview primes quotes, validates real rule strings, precision, scope, cash and holdings", async (t) => {
  const h = await startHarness(t);
  const token = await h.signIn();
  const preview = await review(h, token);
  assert.equal(preview.estimates.amount.total, "101 USD");
  assert.equal(preview.quote.availability, "D");
  assert.equal(preview.sessionId, undefined);
  assert.ok(
    h.calls.findIndex(([, method]) => method === "snapshot") <
      h.calls.findIndex(([, , path]) => path?.endsWith("/whatif")),
  );
  for (const change of [
    { quantity: 0.5 },
    { orderType: "STP" },
    { price: 100.001 },
    { outsideRTH: true },
    { accountId: "U99999" },
  ]) {
    assert.equal(
      (
        await h.request(prefix + "/orders/preview", {
          token,
          body: { ticket: { ...ticket, ...change } },
        })
      ).status,
      400,
    );
  }
  const state = h.states.get("alice_ibkr");
  state.cash = 0;
  assert.equal(
    (await h.request(prefix + "/orders/preview", { token, body: { ticket } }))
      .status,
    400,
  );
  state.cash = 10000;
  assert.equal(
    (
      await h.request(prefix + "/orders/preview", {
        token,
        body: { ticket: { ...ticket, side: "SELL", quantity: 11 } },
      })
    ).status,
    400,
  );
  state.permission = false;
  assert.equal(
    (await h.request(prefix + "/orders/preview", { token, body: { ticket } }))
      .status,
    400,
  );
  assert.equal(writes(h).length, 0);
});

test("warning chains block all background broker requests and repeated submissions", async (t) => {
  const h = await startHarness(t);
  const token = await h.signIn();
  const bob = await h.signIn("bob_ibkr");
  const preview = await review(h, token);
  const state = h.states.get("alice_ibkr");
  state.responses.push(
    [{ id: "warning-1", message: ["First warning", "Second line"] }],
    [{ id: "warning-2", message: ["Another warning"] }],
  );
  const [first, repeated] = await Promise.all([
    submit(h, token, preview.id),
    submit(h, token, preview.id),
  ]);
  assert.equal(first.state, "warning");
  assert.equal(repeated.state, "warning");
  assert.equal(first.replyId, undefined);
  assert.equal(writes(h).length, 1);
  const count = h.calls.length;
  assert.equal(
    (await h.request(prefix + "/marketdata/snapshot?conids=265598", { token }))
      .status,
    409,
  );
  const activity = await json(
    await h.request(prefix + "/orders/activity", { token }),
  );
  assert.equal(activity.intents[0].state, "warning");
  assert.equal(h.calls.length, count);
  assert.equal(
    (
      await h.request(prefix + `/orders/${preview.id}/reply`, {
        token: bob,
        body: { confirmed: true, warningVersion: 1 },
      })
    ).status,
    404,
  );
  const next = await json(
    await h.request(prefix + `/orders/${preview.id}/reply`, {
      token,
      body: { confirmed: true, warningVersion: 1 },
    }),
  );
  assert.equal(next.warningVersion, 2);
  assert.equal(
    (
      await h.request(prefix + `/orders/${preview.id}/reply`, {
        token,
        body: { confirmed: true, warningVersion: 1 },
      })
    ).status,
    409,
  );
  const acknowledged = await json(
    await h.request(prefix + `/orders/${preview.id}/reply`, {
      token,
      body: { confirmed: true, warningVersion: 2 },
    }),
  );
  assert.equal(acknowledged.state, "acknowledged");
  assert.equal(acknowledged.orderId, "12345");
  assert.equal(writes(h).length, 3);
});

test("timeout leaves a durable unknown outcome and prevents replay across restarts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "trader-orders-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const filename = join(dir, "sessions.sqlite");
  const first = await startHarness(t, { filename });
  const token = await first.signIn();
  const preview = await review(first, token);
  first.states
    .get("alice_ibkr")
    .responses.push(new Error("transport timeout after possible submission"));
  assert.equal((await submit(first, token, preview.id)).state, "unknown");
  assert.equal((await submit(first, token, preview.id)).state, "unknown");
  assert.equal(writes(first).length, 1);
  await first.close();
  const next = await startHarness(t, { filename });
  await json(await next.request(prefix + "/sso/connect", { token, body: {} }));
  assert.equal((await submit(next, token, preview.id)).state, "unknown");
  assert.equal(
    (
      await next.request(prefix + "/orders/preview", {
        token,
        body: { ticket },
      })
    ).status,
    409,
  );
  const state = next.states.get("alice_ibkr");
  state.orders.push({
    acct: "U11111",
    orderId: 12345,
    conid: ticket.conid,
    order_ref: preview.reference,
    side: "BUY",
    secType: "STK",
    orderType: "Limit",
    timeInForce: "DAY",
    totalSize: 1,
    filledQuantity: 1,
    remainingQuantity: 0,
    price: 100,
    status: "Filled",
  });
  const reconciled = await json(
    await next.request(prefix + "/orders/activity", { token }),
  );
  assert.equal(reconciled.intents[0].state, "filled");
  assert.equal(writes(next).length, 0);
});

test("HTTP-200 rejects and changed previews never invent successful submissions", async (t) => {
  const h = await startHarness(t);
  const token = await h.signIn();
  const state = h.states.get("alice_ibkr");
  const preview = await review(h, token);
  state.estimate = "102 USD";
  const changed = await submit(h, token, preview.id);
  assert.equal(changed.state, "previewed");
  assert.equal(changed.estimates.amount.total, "102 USD");
  assert.equal(writes(h).length, 0);
  state.responses.push({ error: "Insufficient permission" });
  const rejected = await submit(h, token, preview.id);
  assert.equal(rejected.state, "rejected");
  assert.equal((await submit(h, token, preview.id)).state, "rejected");
  assert.equal(writes(h).length, 1);
});

test("resting modifications and cancellation use owned IDs, current rules and pending states", async (t) => {
  const h = await startHarness(t);
  const token = await h.signIn();
  const bob = await h.signIn("bob_ibkr");
  const preview = await review(h, token);
  await submit(h, token, preview.id);
  assert.equal(
    (
      await h.request(prefix + "/orders/12345/cancel", {
        token: bob,
        body: { confirmed: true },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await h.request(prefix + "/orders/-1/cancel", {
        token,
        body: { confirmed: true },
      })
    ).status,
    404,
  );
  const modified = await review(h, token, { ...ticket, quantity: 2 }, "12345");
  assert.equal((await submit(h, token, modified.id)).state, "acknowledged");
  const call = writes(h).find(
    ([, method, path]) => method === "POST" && path.endsWith("/order/12345"),
  );
  assert.equal(call[3].quantity, 2);
  assert.equal(call[3].orders, undefined);
  assert.equal(call[3].cOID, undefined);
  const cancel = await json(
    await h.request(prefix + "/orders/12345/cancel", {
      token,
      body: { confirmed: true },
    }),
  );
  assert.equal(cancel.state, "cancel_pending");
  await json(
    await h.request(prefix + "/orders/12345/cancel", {
      token,
      body: { confirmed: true },
    }),
  );
  assert.equal(writes(h).filter(([, method]) => method === "DELETE").length, 1);
  h.states.get("alice_ibkr").orders[0].status = "Filled";
  const result = await json(
    await h.request(prefix + "/orders/activity", { token }),
  );
  assert.equal(
    result.intents.find((row) => row.kind === "cancel").state,
    "filled",
  );
});

test("partial fills retain execution IDs, zero values and actual commission currency", async (t) => {
  const h = await startHarness(t);
  const token = await h.signIn();
  const preview = await review(h, token, { ...ticket, quantity: 2 });
  await submit(h, token, preview.id);
  const state = h.states.get("alice_ibkr");
  Object.assign(state.orders[0], {
    filledQuantity: 1,
    remainingQuantity: 1,
    avgPrice: "100",
  });
  state.fills.push(
    {
      execution_id: "execution-1",
      account: "U11111",
      order_ref: preview.reference,
      symbol: "AAPL",
      size: 1,
      price: "100",
      commission: "0",
      trade_time: "20261118-18:00:00",
    },
    { execution_id: "foreign", account: "DU22222" },
  );
  const result = await json(
    await h.request(prefix + "/orders/activity", { token }),
  );
  assert.equal(result.intents[0].state, "partial_fill");
  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0].executionId, "execution-1");
  assert.equal(result.executions[0].commission, "0");
  assert.equal(result.executions[0].commissionCurrency, null);
});

test("signed FD assertions use expected claims and reject altered content", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const client = new IBKRTradingAPI({
    baseUrl: "https://api.ibkr.com",
    fdMasterAccount: "I123",
    credentials: { I123: { clientId: "fixture-client", keyId: "fixture-key" } },
    privateKey,
  });
  const assertion = client.buildClientAssertion();
  const [header, payload, signature] = assertion.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    typ: "JWT",
    alg: "RS256",
    kid: "fixture-key",
  });
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, "fixture-client");
  assert.equal(claims.sub, "fixture-client");
  assert.equal(claims.aud, "https://api.ibkr.com/oauth2/api/v1/token");
  assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 30);
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}x`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
    false,
  );
});

test("declining a broker warning is explicit and releases the confirmation lock", async (t) => {
  const h = await startHarness(t);
  const token = await h.signIn();
  const preview = await review(h, token);
  h.states
    .get("alice_ibkr")
    .responses.push([{ id: "decline-1", message: ["Review this warning"] }]);
  await submit(h, token, preview.id);
  const declined = await json(
    await h.request(prefix + `/orders/${preview.id}/reply`, {
      token,
      body: { confirmed: false, warningVersion: 1 },
    }),
  );
  assert.equal(declined.state, "declined");
  assert.equal(writes(h).at(-1)[3].confirmed, false);
  assert.equal((await review(h, token)).state, "previewed");
});

test("provider status uses actual field names and blocks noneditable or noncancelable orders", async (t) => {
  let clock = Date.now();
  const h = await startHarness(t, { now: () => clock });
  const token = await h.signIn();
  const preview = await review(h, token, { ...ticket, quantity: 3 });
  await submit(h, token, preview.id);
  const state = h.states.get("alice_ibkr");
  state.statusOverride = {
    order_id: 12345,
    account: "U11111",
    conid: 265598,
    side: "B",
    total_size: "3",
    size: "2",
    cum_fill: "1",
    average_price: "100",
    order_type: "LIMIT",
    tif: "DAY",
    sec_type: "STK",
    order_status: "Submitted",
    order_not_editable: true,
    cannot_cancel_order: true,
  };
  assert.equal(
    (
      await h.request(prefix + "/orders/preview", {
        token,
        body: { ticket: { ...ticket, quantity: 4 }, modifyOrderId: "12345" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.request(prefix + "/orders/12345/cancel", {
        token,
        body: { confirmed: true },
      })
    ).status,
    409,
  );
  state.orders = [];
  clock += 5001;
  const result = await json(
    await h.request(prefix + "/orders/activity", { token }),
  );
  assert.equal(result.intents[0].state, "partial_fill");
  assert.equal(result.intents[0].filled, 1);
  assert.equal(result.intents[0].remaining, 2);
  assert.equal(result.intents[0].averagePrice, 100);
});

test("provider auth, pacing and server failures preserve their application meanings", async (t) => {
  for (const status of [401, 403, 409, 429, 500, 503, 504]) {
    await t.test(String(status), async (context) => {
      const h = await startHarness(context);
      const token = await h.signIn();
      const state = h.states.get("alice_ibkr");
      state.failPath = "/contract/";
      state.failStatus = status;
      const response = await h.request(prefix + "/orders/preview", {
        token,
        body: { ticket },
      });
      const expected = [401, 409].includes(status)
        ? 409
        : [500, 503].includes(status)
          ? 502
          : status;
      const error = await json(response, expected);
      assert.equal(
        JSON.stringify(error).includes("private provider detail"),
        false,
      );
      assert.equal(writes(h).length, 0);
    });
  }
});

test("uncertain cancellation stays unknown until the provider confirms a final state", async (t) => {
  let clock = Date.now();
  const h = await startHarness(t, { now: () => clock });
  const token = await h.signIn();
  const preview = await review(h, token);
  await submit(h, token, preview.id);
  const state = h.states.get("alice_ibkr");
  state.responses.push(new Error("cancel timeout"));
  const cancelled = await json(
    await h.request(prefix + "/orders/12345/cancel", {
      token,
      body: { confirmed: true },
    }),
  );
  assert.equal(cancelled.state, "unknown");
  const unresolved = await json(
    await h.request(prefix + "/orders/activity", { token }),
  );
  assert.equal(
    unresolved.intents.find((intent) => intent.kind === "cancel").state,
    "unknown",
  );
  assert.equal(
    (await h.request(prefix + "/orders/preview", { token, body: { ticket } }))
      .status,
    409,
  );
  assert.equal(writes(h).filter(([, method]) => method === "DELETE").length, 1);
  state.orders[0].status = "Cancelled";
  clock += 5001;
  const confirmed = await json(
    await h.request(prefix + "/orders/activity", { token }),
  );
  assert.equal(
    confirmed.intents.find((intent) => intent.kind === "cancel").state,
    "cancelled",
  );
});

test("logout during a pending preview prevents the later broker submission", async (t) => {
  const h = await startHarness(t);
  const token = await h.signIn();
  const preview = await review(h, token);
  const state = h.states.get("alice_ibkr");
  let release;
  let signal;
  state.previewWait = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    signal = resolve;
  });
  state.previewStarted = signal;
  const pending = h.request(prefix + `/orders/${preview.id}/submit`, {
    token,
    body: { confirmed: true },
  });
  await started;
  try {
    assert.equal(
      (await h.request("/auth/session", { token, method: "DELETE" })).status,
      204,
    );
  } finally {
    release();
  }
  assert.equal((await pending).status, 401);
  assert.equal(writes(h).length, 0);
});
