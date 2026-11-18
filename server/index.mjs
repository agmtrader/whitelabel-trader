import http from "node:http";
import { pathToFileURL } from "node:url";

import {
  createAccountAccess,
  normalizeUsername,
  orderBelongsToAccount,
} from "./accountAccess.mjs";
import { IBKRTradingAPI } from "./ibkrTradingApi.mjs";
import { createIbkrClientIpResolver } from "./ibkrClientIp.mjs";
import { createDatabaseAccountAccess } from "./databaseAccountAccess.mjs";
import { createLoginChallenges } from "./loginChallenges.mjs";
import { createAgmLoginMailer, createLoginMailer } from "./loginMailer.mjs";
import { createRequestSecurity, readJson } from "./security.mjs";
import { createSessionStore } from "./sessionStore.mjs";
import { readPortfolio, unavailable } from "./portfolio.mjs";
import { createOrderWorkflow, exactBody } from "./orders.mjs";

const prefix = "/accounts/ibkr";
const appSessionPath = "/auth/session";
const challengePath = "/auth/challenge";
const messages = {
  INVALID_LOGIN_CODE:
    "El código es incorrecto o venció. Revisalo o solicitá otro.",
  INVALID_USERNAME: "Ingresá un usuario IBKR válido.",
  EMAIL_UNAVAILABLE: "El envío de códigos no está disponible en este momento.",
  ACCOUNT_DIRECTORY_UNAVAILABLE:
    "No se pudo consultar tu cuenta. Intentá de nuevo en unos minutos.",
  APP_SESSION_REQUIRED: "Iniciá sesión para continuar.",
  BROKER_RECONNECT: "Reconectá IBKR para continuar.",
  BROKER_CLIENT_IP_UNAVAILABLE:
    "No se pudo confirmar la dirección pública para conectar IBKR. Intentá de nuevo.",
  BROKER_ACCESS_DENIED:
    "IBKR no autorizó el acceso de este usuario con la integración configurada.",
  BROKER_COMPETING:
    "Tu usuario tiene otra sesión IBKR activa. Reconectá para usar esta app.",
  ORDER_CONFIRMATION_PENDING:
    "Respondé la advertencia de IBKR en Actividad antes de continuar.",
  ORDER_RECONCILIATION_REQUIRED:
    "Hay una orden con resultado incierto. Reconciliá su estado en Actividad.",
  ORDER_REVIEW_EXPIRED: "La revisión venció. Revisá nuevamente la orden.",
  ORDER_WRITES_DISABLED:
    "Las órdenes requieren almacenamiento persistente de sesiones y operaciones.",
  INVALID_TICKET:
    "Revisá la cantidad y el precio. Solo acciones enteras, MKT o LMT, DAY y horario regular.",
  UNSUPPORTED_ORDER:
    "IBKR no confirmó permisos o reglas compatibles para esta operación.",
  INSUFFICIENT_HOLDINGS:
    "La posición disponible no permite vender esta cantidad sin abrir un corto.",
  INSUFFICIENT_CASH:
    "No se confirmó efectivo liquidado suficiente en la moneda de la orden, sin financiamiento ni otras compras pendientes.",
  ORDER_PREVIEW_REJECTED: "IBKR rechazó la estimación de esta orden.",
  BROKER_DATA_UNAVAILABLE:
    "IBKR no devolvió información completa. Volvé a actualizar.",
  ACCOUNT_MISMATCH: "IBKR no confirmó la cuenta vinculada.",
  RESOURCE_DENIED: "El recurso no está disponible para esta cuenta.",
  400: "Solicitud inválida.",
  403: "Solicitud no autorizada.",
  404: "Recurso no encontrado.",
  413: "Solicitud demasiado grande.",
  415: "Formato de solicitud no admitido.",
  429: "Demasiadas solicitudes. Intentá de nuevo en unos minutos.",
  502: "IBKR no pudo completar la solicitud.",
  504: "IBKR tardó demasiado en responder.",
};

function failure(statusCode, code) {
  return Object.assign(new Error(code), { statusCode, code });
}

function json(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (payload === undefined) {
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function log(event, metadata = {}) {
  console.info(
    JSON.stringify({ service: "trader-server", event, ...metadata }),
  );
}

function requireKeys(body, keys) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !keys.includes(key))
  ) {
    throw failure(400);
  }
  return body;
}

function required(value) {
  if (typeof value !== "string" || !value.trim()) throw failure(400);
  return value.trim();
}

function isBrokerageReady(status) {
  return (
    status?.authenticated === true &&
    status.connected === true &&
    status.competing === false &&
    status.established !== false
  );
}

function ownedAccount(info, accountId) {
  if (!Array.isArray(info?.accounts) || !info.accounts.includes(accountId)) {
    throw failure(403, "ACCOUNT_MISMATCH");
  }
  const alias = info.aliases?.[accountId];
  return {
    accounts: [accountId],
    selectedAccount: accountId,
    aliases: {
      [accountId]: typeof alias === "string" && alias ? alias : accountId,
    },
    allowFeatures: {
      allowedAssetTypes:
        typeof info.allowFeatures?.allowedAssetTypes === "string"
          ? info.allowFeatures.allowedAssetTypes
          : "",
    },
  };
}

function orderSummary(order, accountId) {
  const fields = {
    orderId: order.order_id ?? order.orderId ?? order.id,
    ticker: order.ticker ?? order.symbol,
    side: order.side,
    status: order.status,
    size: order.size ?? order.quantity,
    price: order.price,
    account: accountId,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) => typeof value === "string" || Number.isFinite(value),
    ),
  );
}

function watchlistRows(payload) {
  if (Array.isArray(payload)) return payload;
  const { user_lists: userLists, system_lists: systemLists } =
    payload?.data ?? {};
  return [
    ...(Array.isArray(userLists) ? userLists : []),
    ...(Array.isArray(systemLists) ? systemLists : []),
  ];
}

export function createTraderServer(
  config,
  {
    createBroker = () => new IBKRTradingAPI(config),
    sendLoginCode = config.agmMail
      ? createAgmLoginMailer(config.agmMail)
      : config.smtp
        ? createLoginMailer(config.smtp)
        : undefined,
    now = Date.now,
    resolveBrokerIp = createIbkrClientIpResolver(config.security, { now }),
    accountAccess = config.accountDatabase
      ? createDatabaseAccountAccess(config.accountDatabase)
      : createAccountAccess(config.accountLinks),
  } = {},
) {
  if (
    config.security.production &&
    !config.accountDatabase &&
    config.accountLinks.length === 0
  ) {
    throw new Error("Production requires verified account links");
  }
  if (config.security.production && !sendLoginCode) {
    throw new Error("Production requires email delivery");
  }
  const loginChallenges = createLoginChallenges({
    findAccount: accountAccess.findAccount,
    sendLoginCode,
    onDeliveryError: () => log("login_email_delivery_failed"),
    now,
  });
  const security = createRequestSecurity(config.security, { now });
  const sessions = createSessionStore({
    filename: config.security.sessionFile,
    idleMs: config.security.sessionIdleMs,
    absoluteMs: config.security.sessionAbsoluteMs,
    now,
  });
  const brokerages = new Map();
  const lifecycle = new Map();
  const orderWritesEnabled =
    config.orderWritesEnabled ?? config.security.sessionFile !== ":memory:";
  const orders = createOrderWorkflow(sessions.orders, {
    now,
    writesEnabled: orderWritesEnabled,
    assertAuthorized(user, client) {
      assertActive(user);
      if (brokerages.get(user.link.subject)?.client !== client)
        throw failure(409, "BROKER_RECONNECT");
    },
  });

  function serialize(subject, operation) {
    const pending = (lifecycle.get(subject) ?? Promise.resolve()).then(
      operation,
    );
    const settled = pending.catch(() => {});
    lifecycle.set(subject, settled);
    void settled.then(() => {
      if (lifecycle.get(subject) === settled) lifecycle.delete(subject);
    });
    return pending;
  }

  async function remoteLogout(client) {
    try {
      await client.logout();
      return true;
    } catch (error) {
      log("broker_logout_failed", { upstreamStatus: error?.statusCode });
      return false;
    }
  }

  function discardBrokerage(subject) {
    const brokerage = brokerages.get(subject);
    if (!brokerage) return Promise.resolve(true);
    brokerages.delete(subject);
    orders.invalidateSession(brokerage.link);
    const result = remoteLogout(brokerage.client);
    // Revocation and logout do not wait behind a hung account read. Future
    // connections still wait for the old client to finish logging out.
    void serialize(subject, () => result);
    return result;
  }

  function clearExpiredBrokerages() {
    sessions.prune();
    for (const [subject, brokerage] of brokerages) {
      if (!sessions.isActive(brokerage.sessionId))
        void discardBrokerage(subject);
    }
  }

  const timer = setInterval(
    () => {
      try {
        clearExpiredBrokerages();
      } catch {
        log("session_cleanup_failed");
      }
    },
    Math.min(60_000, config.security.sessionIdleMs),
  );
  timer.unref();

  async function requireUser(request, signingOut) {
    const token = request.headers["x-trader-session"];
    const session = sessions.get(token, { touch: false });
    const link = session && (await accountAccess.getLink(session.userId));
    if (!link) {
      if (signingOut) security.checkRate(request);
      if (session) sessions.revoke(token);
      throw failure(401, "APP_SESSION_REQUIRED");
    }
    if (!signingOut) security.checkUserRate(link.userId);
    return { token, sessionId: session.id, link };
  }

  function assertActive(user) {
    if (!sessions.isActive(user.sessionId))
      throw failure(401, "APP_SESSION_REQUIRED");
  }

  function handleBrokerError(error, user) {
    if (error?.statusCode === 403) throw failure(403, "BROKER_ACCESS_DENIED");
    if ([401, 409].includes(error?.statusCode)) {
      discardBrokerage(user.link.subject);
      throw failure(409, "BROKER_RECONNECT");
    }
    const status = error?.statusCode;
    throw failure([400, 403, 404, 429, 504].includes(status) ? status : 502);
  }

  async function connectBrokerage(request, user) {
    const { link, sessionId } = user;
    const peer = config.security.ibkrClientIp || security.getClientIp(request);
    return serialize(link.subject, async () => {
      assertActive(user);
      const existing = brokerages.get(link.subject);
      if (existing?.sessionId === sessionId) return existing.account;

      const client = createBroker();
      let ssoCreated = false;
      let stage = "client_address";
      try {
        const ip = await resolveBrokerIp(peer);
        assertActive(user);
        stage = "sso";
        await client.createSsoSession(link.ibkrUsername, ip);
        ssoCreated = true;
        assertActive(user);
        stage = "initialize";
        await client.initializeBrokerageSession();
        stage = "status";
        const status = await client.tickle();
        if (!isBrokerageReady(status))
          throw failure(
            409,
            status.competing ? "BROKER_COMPETING" : "BROKER_RECONNECT",
          );
        stage = "accounts";
        const account = {
          ...ownedAccount(await client.getBrokerageAccounts(), link.accountId),
          username: link.ibkrUsername,
        };
        assertActive(user);
        brokerages.set(link.subject, { sessionId, client, account, link });
        return account;
      } catch (error) {
        log("broker_connect_failed", {
          stage,
          statusCode: error?.statusCode,
        });
        if (ssoCreated) await remoteLogout(client);
        if (Object.hasOwn(messages, error?.code)) throw error;
        handleBrokerError(error, user);
      }
    });
  }

  async function runWithBrokerage(user, operation, allowWarning) {
    assertActive(user);
    const brokerage = brokerages.get(user.link.subject);
    if (brokerage?.sessionId !== user.sessionId)
      throw failure(409, "BROKER_RECONNECT");
    if (!allowWarning && orders.pendingWarning(user.link))
      throw failure(409, "ORDER_CONFIRMATION_PENDING");
    let payload;
    try {
      payload = await operation(brokerage.client, user.link.accountId);
    } catch (error) {
      assertActive(user);
      if (
        error?.code === "ACCOUNT_MISMATCH" &&
        brokerages.get(user.link.subject) === brokerage
      ) {
        discardBrokerage(user.link.subject);
      }
      if (Object.hasOwn(messages, error?.code)) throw error;
      if (error?.statusCode === 400) throw failure(400);
      if (brokerages.get(user.link.subject) === brokerage)
        handleBrokerError(error, user);
      throw failure(409, "BROKER_RECONNECT");
    }
    assertActive(user);
    if (brokerages.get(user.link.subject) !== brokerage)
      throw failure(409, "BROKER_RECONNECT");
    return payload;
  }

  function withBrokerage(user, operation, allowWarning = false) {
    return serialize(user.link.subject, () =>
      runWithBrokerage(user, operation, allowWarning),
    );
  }

  const brokerRoutes = new Map([
    [
      "GET /sso/accounts",
      async (client, accountId) =>
        ownedAccount(await client.getBrokerageAccounts(), accountId),
    ],
    ["GET /sso/status", (client) => client.tickle()],
    ["GET /watchlists", (client) => client.getAllWatchlists()],
    [
      "GET /watchlist",
      async (client, _accountId, query) => {
        const id = required(query.get("id"));
        const lists = watchlistRows(await client.getAllWatchlists());
        if (
          !lists.some(
            (list) =>
              String(
                list?.id ?? list?.watchlistId ?? list?.watchlist_id ?? "",
              ) === id,
          )
        ) {
          throw failure(403, "RESOURCE_DENIED");
        }
        return client.getWatchlistInformation(id);
      },
    ],
    [
      "GET /marketdata/snapshot",
      (client, _accountId, query) =>
        client.getMarketDataSnapshot(required(query.get("conids"))),
    ],
    [
      "GET /marketdata/history",
      (client, _accountId, query) =>
        client.getHistoricalMarketData(
          required(query.get("conid")),
          required(query.get("period")),
          required(query.get("bar")),
        ),
    ],
    [
      "GET /contract/:conid",
      (client, _accountId, _query, _body, conid) =>
        client.getContractInfo(conid),
    ],
    [
      "GET /orders",
      async (client, accountId) => {
        const payload = await client.getOpenOrders();
        const orders = Array.isArray(payload)
          ? payload
          : (payload?.orders ?? payload?.data);
        if (!Array.isArray(orders)) throw failure(502);
        return {
          orders: orders
            .filter((row) => orderBelongsToAccount(row, accountId))
            .map((row) => orderSummary(row, accountId)),
        };
      },
    ],
    [
      "POST /portfolio-analyst",
      (client, accountId, _query, body) => {
        const { acctIds, freq } = requireKeys(body, ["acctIds", "freq"]);
        if (
          !Array.isArray(acctIds) ||
          acctIds.length !== 1 ||
          acctIds[0] !== accountId
        ) {
          throw failure(403, "RESOURCE_DENIED");
        }
        return client.getPortfolioAnalystPerformance([accountId], freq);
      },
    ],
    [
      "POST /secdef/search",
      (client, _accountId, _query, body) => {
        const {
          symbol,
          secType = "STK",
          name,
        } = requireKeys(body, ["symbol", "secType", "name"]);
        return client.searchSecurities(
          required(symbol),
          required(secType),
          name === true,
        );
      },
    ],
  ]);

  function matchRoute(request, pathname) {
    if (pathname === challengePath && request.method === "POST")
      return "request_code";
    if (pathname === appSessionPath) {
      if (request.method === "POST") return "sign_in";
      if (request.method === "DELETE") return "sign_out";
      return null;
    }
    if (!pathname.startsWith(prefix + "/")) return null;
    const path = pathname.slice(prefix.length);
    if (
      (request.method === "GET" &&
        ["/portfolio", "/orders/activity"].includes(path)) ||
      (request.method === "POST" && path === "/orders/preview")
    )
      return { key: request.method + " " + path, workflow: true, path };
    const action = /^\/orders\/([A-Za-z0-9-]+)\/(submit|reply|cancel)$/.exec(
      path,
    );
    if (request.method === "POST" && action)
      return {
        key: "POST /orders/:id/" + action[2],
        workflow: true,
        id: action[1],
        action: action[2],
      };
    if (request.method === "POST" && path === "/sso/connect") return "connect";
    const contract =
      request.method === "GET" && /^\/contract\/(\d+)$/.exec(path);
    const key = request.method + " " + (contract ? "/contract/:conid" : path);
    if (brokerRoutes.has(key))
      return { key, conid: contract ? contract[1] : undefined };
    return null;
  }

  async function handle(request, response) {
    let event = "unknown";
    try {
      const url = new URL(request.url, "http://localhost");
      security.checkOrigin(request, response);
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { ok: true });
        return;
      }
      security.checkTransport(request);
      if (request.method === "OPTIONS") {
        security.checkRate(request);
        security.preflight(request, response, ["GET", "POST", "DELETE"]);
        return;
      }

      const route = matchRoute(request, url.pathname);
      event = route?.key || route || "unknown";
      const signingOut = route === "sign_out";
      if (!signingOut)
        security.checkRate(request, { login: route === "request_code" });
      if (!route) throw failure(404);

      if (route === "request_code") {
        const body = requireKeys(
          await readJson(request, config.security.maxBodyBytes),
          ["username"],
        );
        const username = normalizeUsername(body.username);
        if (!username) throw failure(400, "INVALID_USERNAME");
        const challengeId = await loginChallenges.request(username);
        json(response, 202, { challengeId });
        return;
      }

      if (route === "sign_in") {
        const body = requireKeys(
          await readJson(request, config.security.maxBodyBytes),
          ["challengeId", "code"],
        );
        const challengedLink = loginChallenges.consume(
          body.challengeId,
          body.code,
        );
        const link =
          challengedLink &&
          (await accountAccess.findAccount(
            challengedLink.ibkrUsername.toLowerCase(),
          ));
        if (!link || link.subject !== challengedLink.subject)
          throw failure(401, "INVALID_LOGIN_CODE");
        sessions.revokeUser(link.subject);
        discardBrokerage(link.subject);
        const { token } = sessions.create(link.subject);
        json(response, 200, { sessionId: token });
        return;
      }

      const user = await requireUser(request, signingOut);
      if (signingOut) {
        sessions.revoke(user.token);
        const confirmed = await discardBrokerage(user.link.subject);
        json(
          response,
          confirmed ? 204 : 200,
          confirmed ? undefined : { brokerLogoutConfirmed: false },
        );
        return;
      }

      const background = [
        "GET /sso/status",
        "GET /marketdata/snapshot",
      ].includes(route.key);
      if (!background && !sessions.get(user.token))
        throw failure(401, "APP_SESSION_REQUIRED");
      if (route === "connect") {
        requireKeys(await readJson(request, config.security.maxBodyBytes), []);
        json(response, 200, await connectBrokerage(request, user));
        return;
      }

      const body =
        request.method === "POST"
          ? await readJson(request, config.security.maxBodyBytes)
          : undefined;
      if (route.workflow) {
        if (url.search) throw unavailable("INVALID_TICKET", 400);
        const result = await withBrokerage(
          user,
          async (client, accountId) => {
            if (route.path === "/portfolio")
              return readPortfolio(client, accountId, now);
            if (route.path === "/orders/activity")
              return orders.activity(client, user);
            if (route.path === "/orders/preview")
              return orders.preview(client, user, body);
            if (route.action === "submit") {
              exactBody(body, ["confirmed"]);
              if (body.confirmed !== true)
                throw unavailable("INVALID_TICKET", 400);
              return orders.submit(client, user, route.id);
            }
            if (route.action === "reply")
              return orders.reply(client, user, route.id, body);
            return orders.cancel(client, user, route.id, body);
          },
          route.path === "/orders/activity" ||
            route.action === "reply" ||
            route.action === "submit",
        );
        // Keep durable session digests and provider reply identifiers server-side.
        const publicIntent = (intent) => {
          if (!intent) return intent;
          const {
            sessionId: _sessionId,
            replyId: _replyId,
            ...visible
          } = intent;
          return visible;
        };
        json(
          response,
          200,
          result?.intents
            ? { ...result, intents: result.intents.map(publicIntent) }
            : result?.id
              ? { ...publicIntent(result), writesEnabled: orderWritesEnabled }
              : result,
        );
        return;
      }
      const result = await withBrokerage(user, (client, accountId) =>
        brokerRoutes.get(route.key)(
          client,
          accountId,
          url.searchParams,
          body,
          route.conid,
        ),
      );
      if (route.key === "GET /sso/status" && !isBrokerageReady(result)) {
        discardBrokerage(user.link.subject);
        throw failure(
          409,
          result.competing ? "BROKER_COMPETING" : "BROKER_RECONNECT",
        );
      }
      json(response, 200, result);
    } catch (error) {
      const status = Number(error?.statusCode);
      const statusCode = status >= 400 && status <= 599 ? status : 500;
      const code =
        typeof error?.code === "string" && Object.hasOwn(messages, error.code)
          ? error.code
          : undefined;
      log("request_failed", { route: event, statusCode });
      if (!response.headersSent) {
        if (error?.closeConnection) response.setHeader("Connection", "close");
        if (Number.isSafeInteger(error?.retryAfter)) {
          response.setHeader("Retry-After", String(error.retryAfter));
        }
        json(response, statusCode, {
          error:
            messages[code] ??
            messages[statusCode] ??
            "No se pudo completar la solicitud.",
          ...(code ? { code } : {}),
        });
      }
    }
  }

  const server = http.createServer(
    {
      requestTimeout: config.security.requestTimeoutMs,
      headersTimeout: Math.min(10_000, config.security.requestTimeoutMs),
      maxHeaderSize: 8192,
    },
    (request, response) => void handle(request, response),
  );
  server.on("close", () => {
    clearInterval(timer);
    sessions.close();
    void accountAccess
      .close?.()
      .catch(() => log("account_directory_close_failed"));
  });
  return server;
}

export async function startServer() {
  const { loadConfig } = await import("./config.mjs");
  const config = await loadConfig();
  const server = createTraderServer(config);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) {
    // A failed bind must release the session database and cleanup timer.
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  log("server_ready", { port: config.port });
  return server;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  startServer().catch((error) => {
    const setting = /^(?:Missing|Invalid) ([A-Z][A-Z_0-9]+)$/.exec(
      error?.message,
    )?.[1];
    const startupMessages = {
      SESSION_STORE_LOCKED:
        "The session database is locked by another Trader API process. Stop that process and run npm run dev again.",
      EADDRINUSE:
        "The Trader API port is already in use. Stop the other process or configure TRADER_API_PORT and the app API URL.",
    };
    const message = startupMessages[error?.code];
    log(
      "startup_failed",
      message ? { code: error.code, message } : setting ? { setting } : {},
    );
    process.exitCode = 1;
  });
}
