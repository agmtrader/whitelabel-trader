import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marketDelivery,
  normalizeMarketHistory,
  normalizeMarketSnapshot,
  numeric,
  watchlistRows,
} from "../src/lib/market-data.ts";
import {
  APIError,
  clearBrokerageSession,
  fetchBrokerageAccounts,
  fetchMarketSnapshots,
  fetchWatchlistDetail,
  fetchWatchlists,
  loginToBrokerage,
  logoutOfBrokerage,
  searchSecurities,
} from "../src/lib/api.ts";

test("IBKR numbers distinguish missing from zero and handle closing and quantity formats", () => {
  for (const value of ["", "N/A", "abc123", undefined, Infinity, "1e999"])
    assert.equal(numeric(value), undefined);
  assert.equal(numeric("0.00"), 0);
  assert.equal(numeric("C187.50"), 187.5);
  assert.equal(numeric("1,234.56"), 1234.56);
  assert.equal(numeric("48.2M"), 48_200_000);
  assert.equal(numeric("-1.2%"), -1.2);
});
test("preflight snapshots without symbol or price are preserved rather than fabricated or dropped", () => {
  const row = normalizeMarketSnapshot({ conid: 265598, conidEx: "265598" });
  assert.equal(row.conid, "265598");
  assert.equal(row.symbol, "");
  assert.equal(row.lastPrice, undefined);
  assert.equal(normalizeMarketSnapshot({ symbol: "AAPL" }), null);
});
test("raw and translated IBKR fields retain price, entitlement status and source timestamp", () => {
  const raw = normalizeMarketSnapshot({
    conid: 265598,
    31: "C187.50",
    6509: "DpB",
    _updated: 1700000000000,
    7762: "48.2M",
    7289: "2.9T",
    7295: "0",
  });
  assert.equal(raw.lastPrice, 187.5);
  assert.equal(raw.availability, "DpB");
  assert.equal(raw.updatedAt, 1700000000000);
  assert.equal(raw.volume, 48_200_000);
  assert.equal(raw.marketCap, 2.9e12);
  assert.equal(raw.open, 0);
  const mapped = normalizeMarketSnapshot({
    conidEx: "8314@SMART",
    SYMBOL: "IBM",
    LAST_PRICE: "210.20",
    MARKET_DATA_AVAILABILITY: "RpB",
  });
  assert.equal(mapped.conid, "8314");
  assert.equal(mapped.symbol, "IBM");
  assert.equal(mapped.lastPrice, 210.2);
});
test("availability labels never turn absent or unsubscribed data into real-time data", () => {
  assert.equal(marketDelivery("RpB"), "Tiempo real");
  assert.equal(marketDelivery("DpB"), "Demorado");
  assert.equal(marketDelivery("NpB"), "Sin suscripción");
  assert.equal(marketDelivery("YpB"), "Congelado demorado");
  assert.equal(marketDelivery(), "Disponibilidad no informada");
});
test("historical bars use actual prices and timestamps in chronological order, excluding missing prices", () => {
  const rows = normalizeMarketHistory({
    data: [
      { c: "0", t: 2000 },
      { c: "187.50", t: 1000 },
      { c: "", t: 3000 },
    ],
  });
  assert.deepEqual(
    rows.map((row) => [row.close, row.timestamp]),
    [
      [187.5, 1000],
      [0, 2000],
    ],
  );
});
test("documented nested watchlist response exposes both user and system lists", () => {
  const payload = {
    data: {
      user_lists: [{ id: "u", name: "Personal" }],
      system_lists: [{ id: "s", name: "System" }],
    },
  };
  assert.deepEqual(
    watchlistRows(payload).map((row) => row.id),
    ["u", "s"],
  );
});
test("real client boundary sends the session header and normalizes IBKR watchlist/search shapes", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({ url: String(url), init });
    const path = new URL(String(url)).pathname;
    let payload;
    if (String(url).startsWith("https://api.ipify.org"))
      payload = { ip: "203.0.113.10" };
    else if (path.endsWith("/sso/create"))
      payload = { sessionId: "fixture-session" };
    else if (path.endsWith("/sso/initialize"))
      payload = { authenticated: true };
    else if (path.endsWith("/sso/accounts"))
      payload = {
        accounts: ["DUFIXTURE"],
        selectedAccount: "DUFIXTURE",
        aliases: {},
      };
    else if (path.endsWith("/watchlists"))
      payload = {
        data: { user_lists: [{ id: "u", name: "Personal", read_only: false }] },
      };
    else if (path.endsWith("/watchlist"))
      payload = {
        id: "u",
        name: "Personal",
        instruments: [
          {
            C: "8314",
            ticker: "IBM",
            name: "INTL BUSINESS MACHINES",
            assetClass: "STK",
          },
        ],
      };
    else if (path.endsWith("/secdef/search"))
      payload = [
        {
          conid: "8314",
          symbol: "IBM",
          description: "NYSE",
          companyName: "INTL BUSINESS MACHINES",
          sections: [{ secType: "STK" }],
        },
        {
          conid: "1411277",
          symbol: "IBM",
          companyName: null,
          description: null,
          companyHeader: "INTL BUSINESS MACHINES CORP (IBIS)",
          secType: "STK",
          sections: [],
        },
        {
          conid: "-1",
          symbol: null,
          companyHeader: "Bond issuer",
          secType: "BOND",
        },
      ];
    else payload = { ok: true };
    return Response.json(payload);
  });
  await loginToBrokerage("fixture-user");
  assert.equal((await fetchBrokerageAccounts()).selectedAccount, "DUFIXTURE");
  assert.equal((await fetchWatchlists())[0].name, "Personal");
  assert.equal((await fetchWatchlistDetail("u")).instruments[0].conid, "8314");
  const rows = await searchSecurities("International", "STK", true);
  assert.equal(rows[0].secType, "STK");
  assert.equal(rows[0].companyName, "INTL BUSINESS MACHINES");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].description, "INTL BUSINESS MACHINES CORP (IBIS)");
  assert.equal(rows[1].companyName, "INTL BUSINESS MACHINES CORP (IBIS)");
  const search = seen.find((row) => row.url.endsWith("/secdef/search"));
  assert.equal(search.init.headers["X-Trader-Session"], "fixture-session");
  assert.equal(JSON.parse(search.init.body).name, true);
  await logoutOfBrokerage();
});
test("upstream request failures remain explicit and never return fixture quotes", async (t) => {
  clearBrokerageSession();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Missing market data permission" }, { status: 403 }),
  );
  await assert.rejects(
    fetchMarketSnapshots(["265598"]),
    (error) =>
      error instanceof APIError &&
      error.statusCode === 403 &&
      error.message.includes("Missing market data permission"),
  );
});
