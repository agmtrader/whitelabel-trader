import {
  normalizeMarketHistory,
  normalizeMarketSnapshot,
  watchlistRows,
} from "./market-data.ts";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_TRADER_API_BASE_URL || "http://localhost:5100";
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

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
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
): Promise<T> {
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(traderSessionId ? { "X-Trader-Session": traderSessionId } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new APIError(
      `Request to ${path} failed with ${response.status}${body ? `: ${body}` : ""}`,
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
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

export async function fetchPublicIp() {
  const response = await fetchWithTimeout("https://api.ipify.org?format=json");

  if (!response.ok) {
    throw new APIError(
      `Public IP request failed with ${response.status}`,
      response.status,
    );
  }

  const payload = (await response.json()) as { ip: string };
  return payload.ip;
}

export async function loginToBrokerage(credential: string) {
  const ip = await fetchPublicIp();
  traderSessionId = null;

  try {
    const sessionPayload = await authorizedRequest<{ sessionId?: string }>(
      "/accounts/ibkr/sso/create",
      {
        method: "POST",
        body: JSON.stringify({
          credential,
          ip,
        }),
      },
    );
    if (!sessionPayload.sessionId) {
      throw new APIError("Login response did not include a sessionId");
    }
    traderSessionId = sessionPayload.sessionId;

    await authorizedRequest("/accounts/ibkr/sso/initialize", {
      method: "POST",
    });
  } catch (error) {
    traderSessionId = null;
    throw error;
  }

  return ip;
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

export async function logoutOfBrokerage() {
  try {
    return await authorizedRequest("/accounts/ibkr/sso/logout", {
      method: "POST",
    });
  } finally {
    traderSessionId = null;
  }
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function clearBrokerageSession() {
  traderSessionId = null;
}
export function hasBrokerageSession() {
  return traderSessionId !== null;
}
export async function fetchBrokerageStatus() {
  return authorizedRequest<{
    authenticated: boolean;
    connected: boolean;
    competing: boolean;
  }>("/accounts/ibkr/sso/status");
}
