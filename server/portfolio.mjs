import { orderBelongsToAccount } from "./accountAccess.mjs";

export function unavailable(
  code = "BROKER_DATA_UNAVAILABLE",
  statusCode = 502,
) {
  return Object.assign(new Error(code), { code, statusCode });
}

export function number(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) < 1e100 ? parsed : null;
}

export function timestamp(value) {
  const parsed = number(value);
  return parsed != null && parsed > 0
    ? parsed < 1e12
      ? parsed * 1000
      : parsed
    : null;
}

export async function portfolioAccount(client, accountId) {
  const accounts = await client.brokerRequest("GET", "/portfolio/accounts");
  if (!Array.isArray(accounts)) throw unavailable();
  const account = accounts.find(
    (row) => row.id === accountId || row.accountId === accountId,
  );
  if (!account) throw unavailable("ACCOUNT_MISMATCH", 403);
  return account;
}

export async function positions(client, accountId) {
  const rows = [];
  const seen = new Set();
  for (let page = 0; page < 10000; page++) {
    const data = await client.brokerRequest(
      "GET",
      `/portfolio/${accountId}/positions/${page}`,
    );
    if (!Array.isArray(data) || data.length > 100) throw unavailable();
    for (const row of data) {
      if (!orderBelongsToAccount(row, accountId))
        throw unavailable("ACCOUNT_MISMATCH", 403);
      const key = `${row.conid}:${row.model ?? ""}`;
      if (seen.has(key)) throw unavailable();
      seen.add(key);
      rows.push(row);
    }
    if (data.length < 100) return rows;
  }
  throw unavailable();
}

function amount(field) {
  return {
    value: field?.isNull || field?.isNone ? null : number(field?.amount),
    currency: typeof field?.currency === "string" ? field.currency : null,
    providerUpdatedAt: timestamp(field?.timestamp),
  };
}

export async function readPortfolio(client, accountId, now = Date.now) {
  const account = await portfolioAccount(client, accountId);
  const results = await Promise.allSettled([
    client.brokerRequest("GET", `/portfolio/${accountId}/summary`),
    client.brokerRequest("GET", `/portfolio/${accountId}/ledger`),
    positions(client, accountId),
  ]);
  for (const result of results) {
    if (
      result.status === "rejected" &&
      [401, 403, 409].includes(result.reason?.statusCode)
    )
      throw result.reason;
  }
  const errors = [];
  const read = (index, section) => {
    if (results[index].status === "fulfilled") return results[index].value;
    errors.push(section);
    return null;
  };
  const summary = read(0, "summary");
  const ledger = read(1, "cash");
  const holdings = read(2, "positions");
  if (summary?.accountcode?.value && summary.accountcode.value !== accountId)
    throw unavailable("ACCOUNT_MISMATCH", 403);
  if (summary && (typeof summary !== "object" || Array.isArray(summary)))
    throw unavailable();
  if (ledger && (typeof ledger !== "object" || Array.isArray(ledger)))
    throw unavailable();
  const cash =
    ledger &&
    Object.entries(ledger)
      .filter(([key]) => key !== "BASE")
      .map(([currency, row]) => {
        if (
          !row ||
          row.acctcode !== accountId ||
          (row.currency && row.currency !== currency)
        )
          throw unavailable("ACCOUNT_MISMATCH", 403);
        return {
          currency,
          balance: number(row.cashbalance),
          settled: number(row.settledcash),
          providerUpdatedAt: timestamp(row.timestamp),
        };
      });
  return {
    accountId,
    accountType: typeof account.type === "string" ? account.type : null,
    baseCurrency:
      typeof account.currency === "string" ? account.currency : null,
    receivedAt: now(),
    errors,
    summary: summary
      ? {
          netLiquidation: amount(summary.netliquidation),
          availableFunds: amount(summary.availablefunds),
          buyingPower: amount(summary.buyingpower),
          totalCash: amount(summary.totalcashvalue),
        }
      : null,
    cash,
    positions:
      holdings?.map((row) => ({
        conid: String(row.conid),
        symbol: row.ticker || row.contractDesc || String(row.conid),
        name: row.name || row.contractDesc || "",
        assetClass: row.assetClass || "",
        currency: row.currency || null,
        quantity: number(row.position),
        marketPrice: number(row.mktPrice),
        marketValue: number(row.mktValue),
        averageCost: number(row.avgCost),
        unrealizedPnl: number(row.unrealizedPnl),
        realizedPnlToday: number(row.realizedPnl),
        // Positions.time is generation duration, not a provider timestamp.
        tradableAsset: row.assetClass === "STK",
      })) ?? null,
  };
}
