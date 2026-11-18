import {
  normalizeMarketHistory,
  normalizeMarketSnapshot,
  watchlistRows,
} from "./market-data.ts";
import type {
  OrderActivity,
  OrderIntent,
  OrderTicket,
  Portfolio,
} from "./trading-types";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_TRADER_API_BASE_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:5100");
const REQUEST_TIMEOUT_MS = 30_000;
let traderSessionId: string | null = null;

export type AccountsResponse = {
  accounts: string[];
  aliases: Record<string, string>;
  allowFeatures: {
    allowedAssetTypes: string;
  };
  selectedAccount: string;
};

export type BrokerageConnection = AccountsResponse & { username: string };

export type WatchlistSummary = {
  id: string;
  name: string;
  type?: string;
  readOnly?: boolean;
  raw: Record<string, unknown>;
};

export type WatchlistInstrument = {
  conid: string;
  symbol: string;
  name: string;
  assetClass?: string;
  description?: string;
  raw: Record<string, unknown>;
};

export type WatchlistDetail = {
  id: string;
  name: string;
  instruments: WatchlistInstrument[];
  raw: Record<string, unknown>;
};

export type MarketSnapshot = NonNullable<
  ReturnType<typeof normalizeMarketSnapshot>
>;

export type HistoricalBar = {
  close: number;
  timestamp?: number | string;
  raw: Record<string, unknown>;
};

export type SecuritySearchResult = {
  conid: string;
  symbol: string;
  description: string;
  secType?: string;
  companyName?: string;
  raw: Record<string, unknown>;
};

export type OpenOrder = {
  orderId: string;
  ticker?: string;
  side?: string;
  status?: string;
  size?: string;
  price?: string;
  account?: string;
  raw: Record<string, unknown>;
};

export type ContractInfo = Record<string, unknown>;

export class APIError extends Error {
  statusCode?: number;
  code?: string;

  constructor(message: string, statusCode?: number, code?: string) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function fetchWithTimeout(input: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new APIError(error.message);
    }

    throw new APIError("Unknown network error");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function authorizedRequest<T>(
  path: string,
  init?: RequestInit,
  sessionId = traderSessionId,
  checkSession = true,
): Promise<T> {
  if (!API_BASE_URL)
    throw new APIError(
      "La URL de la API no está configurada para esta versión.",
    );
  let apiUrl: URL;
  try {
    apiUrl = new URL(API_BASE_URL);
  } catch {
    throw new APIError("La URL de la API no es válida.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    apiUrl.hostname,
  );
  if (
    !["http:", "https:"].includes(apiUrl.protocol) ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash ||
    (process.env.NODE_ENV === "production" &&
      apiUrl.protocol !== "https:" &&
      !loopback)
  ) {
    throw new APIError(
      "La API requiere una dirección HTTPS válida para esta versión.",
    );
  }
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sessionId ? { "X-Trader-Session": sessionId } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (checkSession && sessionId && sessionId !== traderSessionId) {
    throw new APIError("La sesión cambió durante la solicitud.");
  }

  if (!response.ok) {
    const body = asRecord(await response.json().catch(() => null));
    throw new APIError(
      typeof body.error === "string"
        ? body.error
        : `Error de conexión (${response.status}).`,
      response.status,
      typeof body.code === "string" ? body.code : undefined,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json()) as T;
  if (checkSession && sessionId && sessionId !== traderSessionId) {
    throw new APIError("La sesión cambió durante la solicitud.");
  }
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function normalizeWatchlistSummary(rawValue: unknown): WatchlistSummary | null {
  const raw = asRecord(rawValue);
  const id = parseString(raw.id ?? raw.watchlistId ?? raw["watchlist_id"]);
  const name = parseString(
    raw.name ?? raw.watchlistName ?? raw["watchlist_name"],
  );

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    type: parseString(raw.type),
    readOnly:
      typeof (raw.readOnly ?? raw.read_only) === "boolean"
        ? ((raw.readOnly ?? raw.read_only) as boolean)
        : undefined,
    raw,
  };
}

function normalizeWatchlistInstrument(
  rawValue: unknown,
): WatchlistInstrument | null {
  const raw = asRecord(rawValue);
  const conid = parseString(
    raw.conid ?? raw.C ?? raw.contractId ?? raw["contract_id"],
  );
  const symbol = parseString(
    raw.symbol ?? raw.ticker ?? raw.fullName ?? raw.displaySymbol,
  );
  const name = parseString(
    raw.name ?? raw.description ?? raw.companyName ?? raw.company_name,
  );

  if (!conid || !symbol || !name) {
    return null;
  }

  return {
    conid,
    symbol,
    name,
    assetClass: parseString(raw.assetClass ?? raw.secType),
    description: parseString(raw.description),
    raw,
  };
}

function normalizeSnapshot(rawValue: unknown): MarketSnapshot | null {
  return normalizeMarketSnapshot(rawValue);
}
function normalizeHistory(rawValue: unknown): HistoricalBar[] {
  return normalizeMarketHistory(rawValue);
}

function normalizeSearchResults(rawValue: unknown): SecuritySearchResult[] {
  const results: SecuritySearchResult[] = [];

  for (const entry of toArray(rawValue)) {
    const raw = asRecord(entry);
    const conid = parseString(raw.conid ?? raw.contractId);
    const symbol = parseString(raw.symbol ?? raw.ticker);
    const description = parseString(
      raw.description ??
        raw.companyHeader ??
        raw.companyName ??
        raw.company_name ??
        raw.name,
    );

    if (!conid || !/^[1-9]\d*$/.test(conid) || !symbol) {
      continue;
    }

    results.push({
      conid,
      symbol,
      description: description || "",
      secType: parseString(
        raw.secType ??
          raw.assetClass ??
          asRecord(toArray(raw.sections)[0]).secType,
      ),
      companyName: parseString(
        raw.companyName ?? raw.company_name ?? raw.companyHeader,
      ),
      raw,
    });
  }

  return results;
}

function normalizeOrders(rawValue: unknown): OpenOrder[] {
  const raw = asRecord(rawValue);
  const candidates = Array.isArray(rawValue)
    ? rawValue
    : toArray(raw.orders ?? raw.data);
  const orders: OpenOrder[] = [];

  for (const entry of candidates) {
    const item = asRecord(entry);
    const orderId = parseString(item.order_id ?? item.orderId ?? item.id);
    if (!orderId) {
      continue;
    }

    orders.push({
      orderId,
      ticker: parseString(item.ticker ?? item.symbol),
      side: parseString(item.side),
      status: parseString(item.status),
      size: parseString(item.size ?? item.quantity),
      price: parseString(item.price),
      account: parseString(item.account ?? item.accountId ?? item.acct),
      raw: item,
    });
  }

  return orders;
}

export async function requestTraderSignIn(username: string) {
  const { challengeId } = await authorizedRequest<{ challengeId?: string }>(
    "/auth/challenge",
    { method: "POST", body: JSON.stringify({ username }) },
    null,
  );
  if (!challengeId) throw new APIError("No se pudo solicitar el código.");
  return challengeId;
}

export type TraderLoginProof = { challengeId: string; code: string };

export async function signInToTrader(proof: TraderLoginProof) {
  const { sessionId } = await authorizedRequest<{ sessionId?: string }>(
    "/auth/session",
    { method: "POST", body: JSON.stringify(proof) },
    null,
  );
  if (!sessionId) throw new APIError("No se pudo iniciar sesión.");
  traderSessionId = sessionId;
}

export function connectBrokerage() {
  return authorizedRequest<BrokerageConnection>("/accounts/ibkr/sso/connect", {
    method: "POST",
    body: "{}",
  });
}

export async function fetchBrokerageAccounts() {
  return authorizedRequest<AccountsResponse>("/accounts/ibkr/sso/accounts", {
    method: "GET",
  });
}

export async function fetchWatchlists() {
  const payload = await authorizedRequest<unknown>(
    "/accounts/ibkr/watchlists",
    {
      method: "GET",
    },
  );

  return watchlistRows(payload)
    .map(normalizeWatchlistSummary)
    .filter((entry): entry is WatchlistSummary => entry !== null);
}

export async function fetchWatchlistDetail(id: string) {
  const payload = await authorizedRequest<unknown>(
    `/accounts/ibkr/watchlist?id=${encodeURIComponent(id)}`,
    {
      method: "GET",
    },
  );

  const raw = asRecord(payload);
  return {
    id: parseString(raw.id ?? raw.watchlistId) || id,
    name: parseString(raw.name ?? raw.watchlistName) || id,
    instruments: toArray(raw.instruments)
      .map(normalizeWatchlistInstrument)
      .filter((entry): entry is WatchlistInstrument => entry !== null),
    raw,
  } as WatchlistDetail;
}

export async function fetchMarketSnapshots(conids: string[]) {
  if (conids.length === 0) {
    return [];
  }

  const payload = await authorizedRequest<unknown>(
    `/accounts/ibkr/marketdata/snapshot?conids=${encodeURIComponent(conids.join(","))}`,
    {
      method: "GET",
    },
  );

  return toArray(payload)
    .map(normalizeSnapshot)
    .filter((entry): entry is MarketSnapshot => entry !== null);
}

export async function fetchHistoricalMarketData(
  conid: string,
  period: string,
  bar: string,
) {
  const payload = await authorizedRequest<unknown>(
    `/accounts/ibkr/marketdata/history?conid=${encodeURIComponent(conid)}&period=${encodeURIComponent(period)}&bar=${encodeURIComponent(bar)}`,
    {
      method: "GET",
    },
  );

  return normalizeHistory(payload);
}

export async function fetchPortfolioAnalyst(acctIds: string[], freq: string) {
  return authorizedRequest<unknown>("/accounts/ibkr/portfolio-analyst", {
    method: "POST",
    body: JSON.stringify({
      acctIds,
      freq,
    }),
  });
}

export async function fetchContractInfo(conid: string) {
  return authorizedRequest<ContractInfo>(
    `/accounts/ibkr/contract/${encodeURIComponent(conid)}`,
    {
      method: "GET",
    },
  );
}

export async function fetchOpenOrders() {
  const payload = await authorizedRequest<unknown>("/accounts/ibkr/orders", {
    method: "GET",
  });

  return normalizeOrders(payload);
}

export async function searchSecurities(
  symbol: string,
  secType = "STK",
  name = false,
) {
  const payload = await authorizedRequest<unknown>(
    "/accounts/ibkr/secdef/search",
    {
      method: "POST",
      body: JSON.stringify({
        symbol,
        secType,
        name,
      }),
    },
  );

  return normalizeSearchResults(payload);
}

export async function signOutOfTrader() {
  const sessionId = traderSessionId;
  clearAppSession();
  if (sessionId) {
    const result = await authorizedRequest<
      { brokerLogoutConfirmed?: boolean } | undefined
    >("/auth/session", { method: "DELETE" }, sessionId, false);
    if (result?.brokerLogoutConfirmed === false)
      throw new APIError(
        "La sesión de la app se cerró. IBKR no confirmó el cierre de su sesión.",
      );
  }
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function fetchPortfolio() {
  return authorizedRequest<Portfolio>("/accounts/ibkr/portfolio");
}

export function fetchOrderActivity() {
  return authorizedRequest<OrderActivity>("/accounts/ibkr/orders/activity");
}

export function previewOrder(ticket: OrderTicket, modifyOrderId?: string) {
  return authorizedRequest<OrderIntent>("/accounts/ibkr/orders/preview", {
    method: "POST",
    body: JSON.stringify({ ticket, modifyOrderId }),
  });
}

export function submitOrder(intentId: string) {
  return authorizedRequest<OrderIntent>(
    `/accounts/ibkr/orders/${encodeURIComponent(intentId)}/submit`,
    {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    },
  );
}

export function replyToOrder(
  intentId: string,
  warningVersion: number,
  confirmed: boolean,
) {
  return authorizedRequest<OrderIntent>(
    `/accounts/ibkr/orders/${encodeURIComponent(intentId)}/reply`,
    {
      method: "POST",
      body: JSON.stringify({ confirmed, warningVersion }),
    },
  );
}

export function cancelOrder(orderId: string) {
  return authorizedRequest<OrderIntent>(
    `/accounts/ibkr/orders/${encodeURIComponent(orderId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    },
  );
}

export function clearAppSession() {
  traderSessionId = null;
}
export async function fetchBrokerageStatus() {
  return authorizedRequest<{
    authenticated: boolean;
    connected: boolean;
    competing: boolean;
    established?: boolean;
  }>("/accounts/ibkr/sso/status");
}
