import { IBKRTradingAPI } from "../../server/ibkrTradingApi.mjs";
import { createTraderServer } from "../../server/index.mjs";

// Sanitized shapes from the IBKR endpoint examples documented in
// docs/order-workflows.md. Network and email delivery are injected.
export const links = [
  {
    userId: "alice",
    ibkrUsername: "alice_ibkr",
    accountId: "U11111",
    email: "owner@example.test",
  },
  {
    userId: "bob",
    ibkrUsername: "bob_ibkr",
    accountId: "DU22222",
    email: "owner@example.test",
  },
  {
    userId: "carol",
    ibkrUsername: "carol_ibkr",
    accountId: "F33333",
    email: "carol@example.test",
  },
];

export function traderFixture(options = {}) {
  const inbox = new Map();
  const calls = [];
  const states = new Map(
    links.map((link) => [
      link.ibkrUsername,
      {
        link,
        orders: [],
        fills: [],
        responses: [],
        positionCount: 1,
        ...options.state,
      },
    ]),
  );
  const config = {
    accountLinks: links,
    orderWritesEnabled: true,
    security: {
      production: false,
      allowedOrigins: ["http://127.0.0.1:8082"],
      trustedProxies: [],
      sessionFile: options.filename ?? ":memory:",
      sessionIdleMs: 600000,
      sessionAbsoluteMs: 3600000,
      maxBodyBytes: 16384,
      requestTimeoutMs: 15000,
      requestRatePerMinute: 1000,
      loginRatePerMinute: 1000,
    },
  };
  function createBroker() {
    const client = new IBKRTradingAPI({
      baseUrl: "https://fixture.invalid",
      fdMasterAccount: "I123",
      credentials: { I123: { clientId: "fixture", keyId: "fixture" } },
    });
    let state;
    let pending;
    client.createSsoSession = async (username) => {
      state = states.get(username);
      client.ssoToken = "fixture-provider-token";
    };
    client.initializeBrokerageSession = async () => {};
    client.tickle = async () => ({
      authenticated: true,
      connected: true,
      established: true,
      competing: Boolean(state.competing),
    });
    client.getBrokerageAccounts = async () => ({
      accounts: [state.link.accountId],
      selectedAccount: state.link.accountId,
      aliases: { [state.link.accountId]: state.link.accountId },
    });
    client.logout = async () => {
      if (state.logoutFailure) throw new Error("fixture logout failure");
      return {};
    };
    client.getMarketDataSnapshot = async () => {
      calls.push([state.link.accountId, "snapshot"]);
      return [
        {
          conid: 265598,
          LAST_PRICE: "100",
          MARKET_DATA_AVAILABILITY: "D",
          _updated: 1795000000000,
        },
      ];
    };
    client.fetchTrading = async (url, init = {}) => {
      const parsed = new URL(url);
      const path = parsed.pathname.replace("/v1/api", "");
      const body = init.body ? JSON.parse(init.body) : undefined;
      const account = state.link.accountId;
      calls.push([account, init.method ?? "GET", path, body]);
      if (state.failPath && path.includes(state.failPath))
        return Response.json(
          { error: "private provider detail" },
          { status: state.failStatus ?? 502 },
        );
      if (path === "/portfolio/accounts")
        return Response.json([
          {
            id: account,
            currency: "USD",
            type: "INDIVIDUAL",
            tradingType: "STKMARGIN",
          },
        ]);
      if (path.endsWith("/summary"))
        return Response.json({
          accountcode: { value: account },
          netliquidation: {
            amount: 0,
            currency: "USD",
            timestamp: 1795000000000,
            isNull: false,
          },
          availablefunds: { amount: 0, currency: "USD", isNull: true },
        });
      if (path.endsWith("/ledger"))
        return Response.json({
          USD: {
            acctcode: account,
            currency: "USD",
            cashbalance: 10000,
            settledcash: state.cash ?? 10000,
          },
          EUR: {
            acctcode: account,
            currency: "EUR",
            cashbalance: 0,
            settledcash: 0,
          },
          BASE: { acctcode: account, currency: "USD", cashbalance: 10000 },
        });
      if (path.includes("/positions/")) {
        const page = Number(path.split("/").at(-1));
        return Response.json(
          Array.from(
            {
              length: Math.min(
                100,
                Math.max(0, state.positionCount - page * 100),
              ),
            },
            (_, index) => ({
              acctId: state.foreignPosition ? "U99999" : account,
              conid: page * 100 + index === 0 ? 265598 : page * 100 + index,
              ticker: page * 100 + index === 1 ? "BOND" : "AAPL",
              position: 10,
              assetClass: page * 100 + index === 1 ? "BOND" : "STK",
              currency: "USD",
              mktValue: 0,
              unrealizedPnl: 0,
            }),
          ),
        );
      }
      if (path.endsWith("/info"))
        return Response.json({
          con_id: 265598,
          instrument_type: "STK",
          symbol: "AAPL",
          currency: "USD",
          valid_exchanges: "SMART,NASDAQ",
        });
      if (path === "/iserver/contract/rules")
        return Response.json({
          canTradeAcctIds: state.permission === false ? [] : [account],
          orderTypes: ["market", "limit"],
          modTypes: ["market", "limit"],
          tifTypes: ["DAY/o,a"],
          sizeIncrement: 1,
          incrementRules: [{ lowerEdge: 0, increment: 0.01 }],
          priceMagnifier: null,
          ...state.rules,
        });
      if (path.endsWith("/whatif")) {
        state.previewStarted?.();
        await state.previewWait;
        const order = body.orders[0];
        const amount = order.quantity * (order.price ?? 100);
        return Response.json({
          amount: {
            amount: `${amount} USD`,
            commission: "1 USD",
            total: state.estimate ?? `${amount + 1} USD`,
          },
          initial: { change: "0" },
          warn: state.previewWarning ?? null,
          error: state.previewError ?? null,
        });
      }
      if (path === "/iserver/account/orders")
        return Response.json(
          parsed.searchParams.has("force")
            ? { orders: [] }
            : { orders: state.orders, snapshot: state.incomplete !== true },
        );
      if (path === "/iserver/account/trades") return Response.json(state.fills);
      if (path.includes("/order/status/")) {
        const order = state.orders.find(
          (row) => String(row.orderId) === path.split("/").at(-1),
        );
        return Response.json(
          state.statusOverride ?? order ?? { error: "order absent" },
        );
      }
      if (
        (path.endsWith("/orders") && init.method === "POST") ||
        path.startsWith("/iserver/reply/") ||
        path.includes("/order/")
      ) {
        if (body?.orders) pending = body.orders[0];
        if (body?.conid) pending = body;
        const response = state.responses.shift();
        if (response instanceof Error) throw response;
        if (response?.wait) await response.wait;
        if (response?.after) response.after(pending, state);
        if (response && !response.wait) return Response.json(response);
        if (path.startsWith("/iserver/reply/") && !body.confirmed)
          return Response.json({});
        if (init.method === "DELETE")
          return Response.json({
            order_id: Number(path.split("/").at(-1)),
            account,
            msg: "Request was submitted",
          });
        const id = path.includes("/order/")
          ? Number(path.split("/").at(-1))
          : 12345;
        state.orders = state.orders.filter((row) => row.orderId !== id);
        state.orders.push({
          acct: account,
          account,
          conid: pending.conid,
          ticker: "AAPL",
          orderId: id,
          order_ref: pending.cOID,
          side: pending.side,
          secType: "STK",
          orderType: pending.orderType === "LMT" ? "Limit" : "Market",
          timeInForce: "DAY",
          totalSize: pending.quantity,
          filledQuantity: 0,
          remainingQuantity: pending.quantity,
          price: pending.price,
          status: "Submitted",
        });
        return Response.json([
          { order_id: String(id), order_status: "Submitted" },
        ]);
      }
      if (path === "/iserver/watchlists")
        return Response.json({
          data: { user_lists: [{ id: "personal", name: "Favoritos" }] },
        });
      if (path === "/iserver/watchlist")
        return Response.json({
          id: "personal",
          name: "Favoritos",
          instruments: [
            { C: "265598", ticker: "AAPL", name: "Apple", assetClass: "STK" },
          ],
        });
      if (path === "/iserver/secdef/search")
        return Response.json([
          {
            conid: "265598",
            symbol: "AAPL",
            companyName: "Apple",
            description: "NASDAQ",
            sections: [{ secType: "STK" }],
          },
        ]);
      if (path === "/iserver/marketdata/history")
        return Response.json({
          data: [
            { t: 1795000000000, c: 99 },
            { t: 1795000300000, c: 100 },
          ],
        });
      return Response.json(
        { error: "Unmapped fixture endpoint" },
        { status: 404 },
      );
    };
    return client;
  }
  const server = createTraderServer(config, {
    now: options.now ?? Date.now,
    createBroker,
    sendLoginCode: async (email, code) => inbox.set(email, code),
  });
  return { server, inbox, states, calls, config };
}

export async function startHarness(context, options) {
  const fixture = traderFixture(options);
  await new Promise((resolve) =>
    fixture.server.listen(0, "127.0.0.1", resolve),
  );
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    fixture.server.closeAllConnections();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
  context.after(close);
  const base = `http://127.0.0.1:${fixture.server.address().port}`;
  const request = (
    path,
    { token, body, method = body === undefined ? "GET" : "POST", ...rest } = {},
  ) =>
    fetch(base + path, {
      ...rest,
      method,
      headers: {
        ...(token ? { "X-Trader-Session": token } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function signIn(username = "alice_ibkr") {
    const challenge = await (
      await request("/auth/challenge", { body: { username } })
    ).json();
    const link = links.find((row) => row.ibkrUsername === username);
    const { sessionId } = await (
      await request("/auth/session", {
        body: {
          challengeId: challenge.challengeId,
          code: fixture.inbox.get(link.email),
        },
      })
    ).json();
    const connected = await request("/accounts/ibkr/sso/connect", {
      token: sessionId,
      body: {},
    });
    if (connected.status !== 200) throw new Error("Fixture login failed");
    return sessionId;
  }
  return { ...fixture, base, request, signIn, close };
}
