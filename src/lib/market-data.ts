export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function text(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : undefined;
}
export function numeric(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = value
    .trim()
    .replace(/,/g, "")
    .match(/^[CH]?([+-]?(?:\d+(?:\.\d*)?|\.\d+))([KMBT])?%?$/i);
  if (!match) return undefined;
  const scale: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  const result = Number(match[1]) * (scale[match[2]?.toUpperCase()] || 1);
  return Number.isFinite(result) ? result : undefined;
}
export function normalizeMarketSnapshot(value: unknown) {
  const raw = record(value),
    conid = text(raw.conid ?? raw.conidEx)?.split("@")[0];
  if (!conid || !/^\d+$/.test(conid)) return null;
  const field = (name: string, tag: string, alias?: string) =>
    raw[name] ?? raw[tag] ?? (alias ? raw[alias] : undefined);
  return {
    conid,
    symbol: text(field("SYMBOL", "55", "symbol")) || "",
    companyName: text(field("COMPANY_NAME", "7051", "companyName")),
    lastPrice: numeric(field("LAST_PRICE", "31", "last")),
    change: numeric(field("CHANGE", "82", "change")),
    changePercent: numeric(field("CHANGE_PERCENT", "83", "changePercent")),
    bidPrice: numeric(field("BID_PRICE", "84", "bid")),
    askPrice: numeric(field("ASK_PRICE", "86", "ask")),
    bidSize: numeric(field("BID_SIZE", "88")),
    askSize: numeric(field("ASK_SIZE", "85")),
    avgPrice: numeric(field("AVG_PRICE", "74")),
    dailyPnl: numeric(field("DAILY_PNL", "78")),
    formattedPosition: text(field("FORMATTED_POSITION", "76")),
    listingExchange: text(field("LISTING_EXCHANGE", "7221")),
    sector: text(field("CATEGORY", "7281")),
    industry: text(field("INDUSTRY", "7280")),
    ratings: text(field("RATINGS", "7706")),
    assetClass: text(field("SECTYPE", "6070")),
    availability: text(field("MARKET_DATA_AVAILABILITY", "6509")),
    updatedAt: numeric(raw._updated),
    open: numeric(field("OPEN", "7295")),
    high: numeric(field("HIGH", "70")),
    low: numeric(field("LOW", "71")),
    volume: numeric(field("VOLUME_LONG", "7762") ?? field("VOLUME", "87")),
    marketCap: numeric(field("MARKET_CAP", "7289")),
    peRatio: numeric(field("PE_RATIO", "7290")),
    dividendYield: numeric(field("DIVIDEND_YIELD_PERCENT", "7287")),
    yearHigh: numeric(field("FIFTY_TWO_WEEK_HIGH", "7293")),
    yearLow: numeric(field("FIFTY_TWO_WEEK_LOW", "7294")),
    raw,
  };
}
export function marketDelivery(availability?: string) {
  const labels: Record<string, string> = {
    R: "Tiempo real",
    D: "Demorado",
    Z: "Congelado",
    Y: "Congelado demorado",
    N: "Sin suscripción",
    i: "Incompleto",
    v: "VDR",
  };
  return labels[availability?.[0] || ""] || "Disponibilidad no informada";
}
export function normalizeMarketHistory(value: unknown) {
  const raw = record(value),
    rows = raw.data ?? raw.points ?? raw.bars;
  return (Array.isArray(rows) ? rows : [])
    .flatMap((value) => {
      const row = record(value),
        close = numeric(row.c ?? row.close ?? row.price);
      if (close === undefined) return [];
      const timestamp = numeric(row.t ?? row.time ?? row.timestamp);
      return [{ close, timestamp, raw: row }];
    })
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
export function watchlistRows(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  const raw = record(payload),
    data = record(raw.data);
  return [
    ...(Array.isArray(data.user_lists) ? data.user_lists : []),
    ...(Array.isArray(data.system_lists) ? data.system_lists : []),
  ];
}
export const historyQueries: Record<string, { period: string; bar: string }> = {
  "1D": { period: "1d", bar: "5min" },
  "1S": { period: "1w", bar: "1h" },
  "1M": { period: "1m", bar: "1d" },
  "3M": { period: "3m", bar: "1d" },
  "6M": { period: "6m", bar: "1d" },
  "1A": { period: "1y", bar: "1w" },
  "5A": { period: "5y", bar: "1m" },
};
