import { test } from "node:test";
import assert from "node:assert/strict";
import { IBKRTradingAPI } from "../server/ibkrTradingApi.mjs";

const client = () => {
  const api = new IBKRTradingAPI({
    baseUrl: "https://ibkr.fixture",
    privateKey: "",
    credentials: {
      I6413690: { clientId: "fixture-client", keyId: "fixture-key" },
    },
  });
  api.ssoToken = "fixture-token";
  return api;
};
test("snapshots prime once per subscription and merge partial updates with source metadata", async (t) => {
  const calls = [],
    api = client();
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(String(url));
    calls.push(parsed);
    if (parsed.searchParams.has("fields"))
      return Response.json([{ conid: 265598 }]);
    return Response.json(
      calls.length === 2
        ? [
            {
              conid: 265598,
              31: "187.50",
              6509: "DpB",
              _updated: 1700000000000,
            },
          ]
        : [{ conid: 265598, 82: "2.00" }],
    );
  });
  await api.getMarketDataSnapshot("265598");
  const result = await api.getMarketDataSnapshot("265598");
  assert.equal(calls.filter((url) => url.searchParams.has("fields")).length, 1);
  assert.ok(calls[0].searchParams.get("fields").split(",").includes("6509"));
  assert.equal(result[0].LAST_PRICE, "187.50");
  assert.equal(result[0].CHANGE, "2.00");
  assert.equal(result[0]._updated, 1700000000000);
  assert.equal(result[0].MARKET_DATA_AVAILABILITY, "DpB");
});
test("empty preflight and quote responses remain missing prices", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json([{ conid: 8314 }]),
  );
  const rows = await client().getMarketDataSnapshot("8314");
  assert.equal(rows[0].conid, 8314);
  assert.equal(rows[0].LAST_PRICE, undefined);
});
test("market data permission failure propagates its real status", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Missing entitlement" }, { status: 403 }),
  );
  await assert.rejects(
    client().getMarketDataSnapshot("8314"),
    (error) =>
      error.statusCode === 403 && error.message.includes("Missing entitlement"),
  );
});
test("invalid contracts do not reach IBKR", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json([]),
  );
  await assert.rejects(
    client().getMarketDataSnapshot("8314,not-a-conid"),
    (error) => error.statusCode === 400,
  );
  assert.equal(fetch.mock.callCount(), 0);
});
test("provider network failures are actionable without exposing credentials or retrying", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET", message: "private-provider-detail" },
    });
  });
  await assert.rejects(
    client().searchSecurities("Apple", "STK", true),
    (error) =>
      error.statusCode === 502 &&
      error.message === "IBKR connection failed (ECONNRESET)",
  );
  assert.equal(fetch.mock.callCount(), 1);
});
test("expired brokerage sessions retain the upstream 401 across market endpoints", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "not authenticated" }, { status: 401 }),
  );
  const api = client();
  for (const request of [
    () => api.getBrokerageAccounts(),
    () => api.getAllWatchlists(),
    () => api.getContractInfo("265598"),
    () => api.getHistoricalMarketData("265598", "1d", "5min"),
  ]) {
    await assert.rejects(
      request(),
      (error) =>
        error.statusCode === 401 && error.message.includes("not authenticated"),
    );
  }
});
test("changing instruments releases only streams subscribed by this client", async (t) => {
  const calls = [],
    api = client();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, init });
    return Response.json(
      String(url).includes("unsubscribe") ? { success: true } : [],
    );
  });
  await api.getMarketDataSnapshot("8314");
  await api.getMarketDataSnapshot("265598");
  const removed = calls.filter((call) => call.path.endsWith("/unsubscribe"));
  assert.equal(removed.length, 1);
  assert.deepEqual(JSON.parse(removed[0].init.body), { conid: 8314 });
  assert.ok(calls.every((call) => !call.path.endsWith("/unsubscribeall")));
});
test("session initialization preserves the established IBKR flow and verifies account readiness", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, init });
    return Response.json(
      String(url).includes("ssodh/init")
        ? { authenticated: true, connected: true, competing: false }
        : {
            accounts: ["DUFIXTURE"],
            aliases: { DUFIXTURE: "Fixture" },
            selectedAccount: "DUFIXTURE",
          },
    );
  });
  const result = await client().initializeBrokerageSession();
  assert.equal(result.authenticated, true);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    publish: true,
    compete: true,
  });
  assert.equal(calls[1].path, "/v1/api/iserver/accounts");
});
test("tickle returns only session health flags, never provider session credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      session: "private-fixture",
      iserver: {
        authStatus: { authenticated: true, connected: true, competing: false },
      },
    }),
  );
  assert.deepEqual(await client().tickle(), {
    authenticated: true,
    connected: true,
    competing: false,
  });
});
