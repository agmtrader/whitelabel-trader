import { orderBelongsToAccount } from "./accountAccess.mjs";
import {
  number,
  portfolioAccount,
  positions,
  unavailable,
} from "./portfolio.mjs";

const terminal = new Set([
  "Filled",
  "Cancelled",
  "Canceled",
  "Inactive",
  "Rejected",
]);
const resting = new Set(["Submitted", "PreSubmitted", "PartiallyFilled"]);
const unresolved = new Set(["submitting", "warning", "unknown"]);

export function exactBody(body, keys) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !keys.includes(key))
  )
    throw unavailable("INVALID_TICKET", 400);
  return body;
}

export function ticketInput(input) {
  const ticket = exactBody(input, [
    "conid",
    "side",
    "quantity",
    "orderType",
    "price",
  ]);
  if (
    !Number.isSafeInteger(ticket.conid) ||
    ticket.conid <= 0 ||
    !["BUY", "SELL"].includes(ticket.side) ||
    !["MKT", "LMT"].includes(ticket.orderType) ||
    !Number.isSafeInteger(ticket.quantity) ||
    ticket.quantity < 1 ||
    (ticket.orderType === "LMT"
      ? !(
          typeof ticket.price === "number" &&
          Number.isFinite(ticket.price) &&
          ticket.price > 0
        )
      : ticket.price !== undefined)
  )
    throw unavailable("INVALID_TICKET", 400);
  return { ...ticket };
}

function orderId(row) {
  const value = String(row?.orderId ?? row?.order_id ?? "");
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? value
    : null;
}

function normalizeOrder(row) {
  const types = { MARKET: "MKT", LIMIT: "LMT", MKT: "MKT", LMT: "LMT" };
  return {
    orderId: orderId(row),
    reference: row.order_ref ?? row.cOID ?? null,
    conid: number(row.conid),
    symbol: row.ticker ?? row.symbol ?? row.description1 ?? "",
    side: { B: "BUY", S: "SELL" }[row.side] ?? row.side,
    status: row.status ?? row.order_status ?? "Unknown",
    quantity: number(row.totalSize ?? row.total_size ?? row.quantity),
    filled: number(row.filledQuantity ?? row.cum_fill ?? row.filled),
    remaining: number(row.remainingQuantity ?? row.remaining ?? row.size),
    averagePrice: number(row.avgPrice ?? row.average_price ?? row.avg_price),
    orderType:
      types[String(row.orderType ?? row.order_type).toUpperCase()] ??
      row.orderType ??
      row.order_type,
    tif: row.timeInForce ?? row.tif,
    price: number(row.price ?? row.lmtPrice),
    assetClass: row.secType ?? row.sec_type,
    outsideRTH: row.outsideRTH ?? null,
    orderNotEditable: row.order_not_editable === true,
    cannotCancel: row.cannot_cancel_order === true,
  };
}

function normalizeExecution(row) {
  return {
    executionId: String(row.execution_id ?? ""),
    orderId: orderId(row),
    reference: row.order_ref ?? null,
    symbol: row.symbol ?? "",
    quantity: number(row.size),
    price: number(row.price),
    commission: row.commission == null ? null : String(row.commission),
    commissionCurrency: row.commission_currency ?? null,
    time: row.trade_time ?? null,
    providerUpdatedAt: number(row.trade_time_r),
  };
}

function statusState(status, filled) {
  if (status === "Filled") return "filled";
  if (["Cancelled", "Canceled"].includes(status)) return "cancelled";
  if (["Rejected", "Inactive"].includes(status)) return "rejected";
  return filled > 0 ? "partial_fill" : "acknowledged";
}

function scalar(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).slice(0, 4000)
    : null;
}

function estimates(raw) {
  const group = (value) =>
    Object.fromEntries(
      Object.entries(value ?? {})
        .filter(([, entry]) => scalar(entry) != null)
        .map(([key, value]) => [key, scalar(value)]),
    );
  return {
    amount: group(raw?.amount),
    equity: group(raw?.equity),
    initial: group(raw?.initial),
    maintenance: group(raw?.maintenance),
    warning: scalar(raw?.warn),
  };
}

function providerTicket(intent, accountId) {
  return {
    ...intent.ticket,
    acctId: accountId,
    tif: "DAY",
    outsideRTH: false,
    listingExchange: "SMART",
    cOID: intent.reference,
  };
}

function supportedResting(row) {
  return (
    resting.has(row.status) &&
    row.assetClass === "STK" &&
    ["MKT", "LMT"].includes(row.orderType) &&
    row.tif === "DAY" &&
    row.outsideRTH === false
  );
}

export function createOrderWorkflow(
  store,
  { now = Date.now, writesEnabled = false, assertAuthorized = () => {} } = {},
) {
  const activeWarnings = new Map();
  const snapshots = new WeakMap();
  const trades = new WeakMap();

  function list(link) {
    return store.list(link.tradingKey).map((intent) => {
      if (
        intent.state === "submitting" ||
        (intent.state === "warning" &&
          (activeWarnings.get(link.tradingKey) !== intent.id ||
            now() > intent.replyUntil))
      ) {
        activeWarnings.delete(link.tradingKey);
        return store.save(link.tradingKey, {
          ...intent,
          state: "unknown",
          messages: ["Reconcilia el resultado con IBKR antes de continuar."],
        });
      }
      return intent;
    });
  }

  function pendingWarning(link) {
    return list(link).find((intent) => intent.state === "warning");
  }

  function assertNoPending(link) {
    if (list(link).some((intent) => unresolved.has(intent.state)))
      throw unavailable("ORDER_RECONCILIATION_REQUIRED", 409);
  }

  function get(link, id) {
    const intent = store.get(link.tradingKey, id);
    if (!intent) throw unavailable("RESOURCE_DENIED", 404);
    return intent;
  }

  async function snapshot(client, link, fresh = false) {
    const accountId = link.accountId;
    const cached = snapshots.get(client);
    if (!fresh && cached && now() - cached.receivedAt < 5000) return cached;
    await client.selectTradingAccount(accountId);
    const payload = await client.getOrderSnapshot();
    if (
      !payload ||
      !Array.isArray(payload.orders) ||
      payload.snapshot !== true ||
      payload.orders.length >= 1000
    )
      throw unavailable();
    const recorded = store.list(link.tradingKey);
    const rows = payload.orders
      .filter((row) => orderBelongsToAccount(row, accountId))
      .map((raw) => {
        const row = normalizeOrder(raw);
        const original = recorded.find(
          (intent) =>
            intent.kind === "submit" &&
            intent.orderId === row.orderId &&
            intent.ticket?.conid === row.conid &&
            intent.ticket?.side === row.side,
        );
        return {
          ...row,
          outsideRTH: row.outsideRTH ?? (original ? false : null),
        };
      });
    if (rows.some((row) => !row.orderId)) throw unavailable();
    const result = { rows, receivedAt: now() };
    snapshots.set(client, result);
    return result;
  }

  async function executions(client, accountId) {
    const cached = trades.get(client);
    if (cached && now() - cached.receivedAt < 60000) return cached;
    const payload = await client.brokerRequest(
      "GET",
      "/iserver/account/trades",
    );
    if (!Array.isArray(payload)) throw unavailable();
    const result = {
      rows: payload
        .filter((row) => orderBelongsToAccount(row, accountId))
        .map(normalizeExecution),
      receivedAt: now(),
    };
    trades.set(client, result);
    return result;
  }

  async function readStatus(client, link, id, row) {
    const raw = await client.brokerRequest(
      "GET",
      `/iserver/account/order/status/${id}`,
    );
    if (!raw || typeof raw !== "object" || raw.error) throw unavailable();
    const aliases = [
      raw.acct,
      raw.account,
      raw.accountId,
      raw.accountCode,
      raw.acctId,
      raw.order_clearing_account,
    ].filter((entry) => entry != null);
    if (
      aliases.some((entry) => entry !== link.accountId) ||
      (orderId(raw) && orderId(raw) !== id)
    )
      throw unavailable("ACCOUNT_MISMATCH", 403);
    const state = raw.order_status ?? raw.status ?? row?.status;
    if (typeof state !== "string") throw unavailable();
    const details = Object.fromEntries(
      Object.entries(normalizeOrder(raw)).filter(
        ([, value]) => value != null && value !== "",
      ),
    );
    return { ...row, ...details, orderId: id, status: state };
  }

  async function ownedOrder(client, link, id) {
    if (!orderId({ orderId: id })) throw unavailable("RESOURCE_DENIED", 404);
    const current = await snapshot(client, link, true);
    const row = current.rows.find((entry) => entry.orderId === id);
    // Durable IDs came from a scoped provider acknowledgement. Never probe an
    // arbitrary caller-supplied order ID against the provider status endpoint.
    const intent = list(link).find((entry) => entry.orderId === id);
    if (!row && !intent) throw unavailable("RESOURCE_DENIED", 404);
    return readStatus(client, link, id, row);
  }

  async function validate(client, link, input, modifyId) {
    const ticket = ticketInput(input);
    await portfolioAccount(client, link.accountId);
    const contract = await client.getContractInfo(String(ticket.conid));
    if (
      (contract.secType ?? contract.instrument_type) !== "STK" ||
      number(contract.conid ?? contract.con_id) !== ticket.conid ||
      typeof contract.currency !== "string" ||
      !String(
        contract.valid_exchanges ??
          contract.validExchanges ??
          contract.exchange ??
          "",
      )
        .split(",")
        .includes("SMART")
    )
      throw unavailable("UNSUPPORTED_ORDER", 400);
    const original = modifyId ? await ownedOrder(client, link, modifyId) : null;
    if (
      modifyId &&
      list(link).some(
        (intent) =>
          intent.kind === "cancel" &&
          intent.orderId === modifyId &&
          ["cancel_pending", "unknown"].includes(intent.state),
      )
    )
      throw unavailable("ORDER_RECONCILIATION_REQUIRED", 409);
    if (
      original &&
      (!supportedResting(original) ||
        original.orderNotEditable ||
        original.conid !== ticket.conid ||
        original.side !== ticket.side ||
        ticket.quantity < (original.filled ?? 0))
    )
      throw unavailable("UNSUPPORTED_ORDER", 409);
    const rules = await client.brokerRequest(
      "POST",
      "/iserver/contract/rules",
      {
        conid: ticket.conid,
        exchange: "SMART",
        isBuy: ticket.side === "BUY",
        ...(modifyId ? { modifyOrder: true, orderId: Number(modifyId) } : {}),
      },
    );
    const type = ticket.orderType === "MKT" ? "market" : "limit";
    const types = modifyId
      ? (rules?.modTypes ?? rules?.orderTypes)
      : rules?.orderTypes;
    const day =
      Array.isArray(rules?.tifTypes) &&
      rules.tifTypes.some((value) => {
        if (value === "DAY") return true;
        if (typeof value !== "string") return false;
        const [tif, applicability] = value.split("/");
        return (
          tif === "DAY" &&
          applicability
            ?.split(",")
            .some((entry) => entry === "o" || entry === type.toUpperCase())
        );
      });
    const sizeIncrement = number(rules?.sizeIncrement);
    if (
      rules?.error ||
      !rules?.canTradeAcctIds?.includes(link.accountId) ||
      !types?.some((value) => value === ticket.orderType || value === type) ||
      !day ||
      !(sizeIncrement > 0) ||
      (ticket.quantity / sizeIncrement) % 1 !== 0 ||
      (rules.priceMagnifier != null && number(rules.priceMagnifier) !== 1)
    )
      throw unavailable("UNSUPPORTED_ORDER", 400);
    if (ticket.orderType === "LMT") {
      const bands = Array.isArray(rules.incrementRules)
        ? rules.incrementRules
        : [{ lowerEdge: 0, increment: rules.increment }];
      if (
        bands.some(
          (row) =>
            !(number(row.increment) > 0) ||
            number(row.lowerEdge) == null ||
            number(row.lowerEdge) < 0,
        )
      )
        throw unavailable();
      const band = bands
        .filter(
          (row) =>
            number(row.lowerEdge) != null &&
            number(row.lowerEdge) <= ticket.price,
        )
        .sort((a, b) => b.lowerEdge - a.lowerEdge)[0];
      const increment = number(band?.increment);
      if (
        !increment ||
        Math.abs(
          ticket.price / increment - Math.round(ticket.price / increment),
        ) > 1e-7
      )
        throw unavailable("INVALID_TICKET", 400);
    }
    const current = await snapshot(client, link, true);
    const outstanding = current.rows.filter(
      (row) => !terminal.has(row.status) && row.orderId !== modifyId,
    );
    if (ticket.side === "SELL") {
      const holdings = await positions(client, link.accountId);
      const held = holdings.filter((row) => number(row.conid) === ticket.conid);
      const quantity = held.reduce(
        (sum, row) => sum + (number(row.position) ?? NaN),
        0,
      );
      const reservations = outstanding.filter(
        (row) => row.conid === ticket.conid && row.side === "SELL",
      );
      const reserved = reservations.reduce(
        (sum, row) => sum + (row.remaining ?? NaN),
        0,
      );
      if (
        !Number.isFinite(quantity) ||
        !Number.isFinite(reserved) ||
        ticket.quantity - (original?.filled ?? 0) > quantity - reserved
      )
        throw unavailable("INSUFFICIENT_HOLDINGS", 400);
    }
    const quotes = await client.getMarketDataSnapshot(String(ticket.conid));
    const raw = await client.brokerRequest(
      "POST",
      `/iserver/account/${link.accountId}/orders/whatif`,
      {
        orders: [
          {
            ...ticket,
            acctId: link.accountId,
            tif: "DAY",
            outsideRTH: false,
            listingExchange: "SMART",
          },
        ],
      },
    );
    if (!raw || typeof raw !== "object") throw unavailable();
    if (raw.error) throw unavailable("ORDER_PREVIEW_REJECTED", 400);
    if (ticket.side === "BUY") {
      const ledger = await client.brokerRequest(
        "GET",
        `/portfolio/${link.accountId}/ledger`,
      );
      const cash = ledger?.[contract.currency];
      if (!cash || cash.acctcode !== link.accountId)
        throw unavailable("ACCOUNT_MISMATCH", 403);
      // WhatIf gives a currency-bearing string, sometimes a range. Use the
      // upper bound only when every component is in the instrument currency.
      const total = String(raw.amount?.total ?? "").trim();
      const match =
        /^([\d,]+(?:\.\d+)?)(?:\s*[-–]\s*([\d,]+(?:\.\d+)?))?\s+([A-Z]{3})$/.exec(
          total,
        );
      const cost = match
        ? Number((match[2] ?? match[1]).replaceAll(",", ""))
        : NaN;
      if (
        outstanding.some((row) => row.side === "BUY") ||
        !Number.isFinite(cost) ||
        match[3] !== contract.currency ||
        number(cash.settledcash) == null ||
        cost > number(cash.settledcash)
      )
        throw unavailable("INSUFFICIENT_CASH", 400);
    }
    const quote = quotes?.[0];
    return {
      ticket,
      currency: contract.currency,
      symbol: contract.symbol ?? contract.local_symbol ?? String(ticket.conid),
      estimates: estimates(raw),
      previewReceivedAt: now(),
      quote: {
        last: scalar(quote?.LAST_PRICE ?? quote?.[31]),
        availability: scalar(quote?.MARKET_DATA_AVAILABILITY ?? quote?.[6509]),
        providerUpdatedAt: number(quote?._updated),
        receivedAt: now(),
      },
    };
  }

  function writeResult(link, intent, payload) {
    const rows = Array.isArray(payload) ? payload : [payload];
    if (rows.length !== 1 || !rows[0] || typeof rows[0] !== "object")
      return store.save(link.tradingKey, { ...intent, state: "unknown" });
    const row = rows[0];
    let result;
    if (row.error)
      result = {
        ...intent,
        state: "rejected",
        messages: [String(row.error).slice(0, 4000)],
      };
    else if (
      typeof row.id === "string" &&
      Array.isArray(row.message) &&
      row.message.length &&
      row.message.every((value) => typeof value === "string")
    ) {
      result = {
        ...intent,
        state: "warning",
        replyId: row.id,
        messages: row.message,
        replyUntil: now() + 60000,
        warningVersion: (intent.warningVersion ?? 0) + 1,
      };
      activeWarnings.set(link.tradingKey, intent.id);
    } else if (orderId(row))
      result = {
        ...intent,
        state: statusState(row.order_status, 0),
        orderId: orderId(row),
        brokerStatus: row.order_status ?? null,
        messages: [],
      };
    else result = { ...intent, state: "unknown" };
    if (result.state !== "warning") activeWarnings.delete(link.tradingKey);
    return store.save(link.tradingKey, result);
  }

  async function write(client, user, intent, operation, declined = false) {
    assertAuthorized(user, client);
    const link = user.link;
    store.save(link.tradingKey, { ...intent, state: "submitting" });
    snapshots.delete(client);
    try {
      const payload = await operation();
      const row =
        Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
      if (
        declined &&
        (row == null ||
          (typeof row === "object" &&
            !Array.isArray(row) &&
            !row.error &&
            !row.id &&
            !orderId(row)))
      ) {
        activeWarnings.delete(link.tradingKey);
        return store.save(link.tradingKey, {
          ...intent,
          state: "declined",
          messages: [],
        });
      }
      return writeResult(link, intent, payload);
    } catch {
      activeWarnings.delete(link.tradingKey);
      return store.save(link.tradingKey, {
        ...intent,
        state: "unknown",
        messages: [
          "IBKR no confirmó el resultado. Reconciliá antes de enviar otra orden.",
        ],
      });
    }
  }

  function requireWrites() {
    if (!writesEnabled) throw unavailable("ORDER_WRITES_DISABLED", 409);
  }

  return {
    pendingWarning,
    list,
    invalidateSession(link) {
      activeWarnings.delete(link.tradingKey);
      list(link);
    },
    async preview(client, user, body) {
      exactBody(body, ["ticket", "modifyOrderId"]);
      assertNoPending(user.link);
      if (
        body.modifyOrderId !== undefined &&
        !/^[1-9]\d*$/.test(String(body.modifyOrderId))
      )
        throw unavailable("INVALID_TICKET", 400);
      const values = await validate(
        client,
        user.link,
        body.ticket,
        body.modifyOrderId && String(body.modifyOrderId),
      );
      assertAuthorized(user, client);
      return store.create(user.link.tradingKey, {
        ...values,
        kind: body.modifyOrderId ? "modify" : "submit",
        orderId: body.modifyOrderId ? String(body.modifyOrderId) : null,
        sessionId: user.sessionId,
        state: "previewed",
        expiresAt: now() + 60000,
      });
    },
    async submit(client, user, id) {
      requireWrites();
      const intent = get(user.link, id);
      if (intent.state !== "previewed")
        return list(user.link).find((row) => row.id === id);
      assertNoPending(user.link);
      if (intent.sessionId !== user.sessionId || now() > intent.expiresAt)
        throw unavailable("ORDER_REVIEW_EXPIRED", 409);
      const fresh = await validate(
        client,
        user.link,
        intent.ticket,
        intent.kind === "modify" ? intent.orderId : undefined,
      );
      assertAuthorized(user, client);
      if (now() > intent.expiresAt)
        throw unavailable("ORDER_REVIEW_EXPIRED", 409);
      if (
        JSON.stringify(fresh.estimates) !== JSON.stringify(intent.estimates)
      ) {
        return store.save(user.link.tradingKey, {
          ...intent,
          ...fresh,
          expiresAt: now() + 60000,
          messages: ["La estimación cambió. Revisá y confirmá nuevamente."],
        });
      }
      const path =
        intent.kind === "modify"
          ? `/iserver/account/${user.link.accountId}/order/${intent.orderId}`
          : `/iserver/account/${user.link.accountId}/orders`;
      const payload = providerTicket(intent, user.link.accountId);
      if (intent.kind === "modify") delete payload.cOID;
      return write(client, user, intent, () =>
        client.brokerRequest(
          "POST",
          path,
          intent.kind === "modify" ? payload : { orders: [payload] },
        ),
      );
    },
    async reply(client, user, id, body) {
      requireWrites();
      exactBody(body, ["confirmed", "warningVersion"]);
      const intent = list(user.link).find((entry) => entry.id === id);
      if (!intent) throw unavailable("RESOURCE_DENIED", 404);
      if (intent.state !== "warning") return intent;
      if (
        typeof body.confirmed !== "boolean" ||
        body.warningVersion !== intent.warningVersion ||
        intent.sessionId !== user.sessionId
      )
        throw unavailable("ORDER_REVIEW_EXPIRED", 409);
      const result = await write(
        client,
        user,
        intent,
        () =>
          client.brokerRequest(
            "POST",
            `/iserver/reply/${encodeURIComponent(intent.replyId)}`,
            { confirmed: body.confirmed },
          ),
        !body.confirmed,
      );
      if (!body.confirmed && result.state !== "unknown") {
        activeWarnings.delete(user.link.tradingKey);
        return store.save(user.link.tradingKey, {
          ...result,
          state:
            result.orderId && intent.kind === "submit" ? "unknown" : "declined",
        });
      }
      return result;
    },
    async cancel(client, user, id, body) {
      requireWrites();
      exactBody(body, ["confirmed"]);
      if (body.confirmed !== true) throw unavailable("INVALID_TICKET", 400);
      assertNoPending(user.link);
      const existing = list(user.link).find(
        (intent) =>
          intent.kind === "cancel" &&
          intent.orderId === id &&
          ["cancel_pending", "unknown"].includes(intent.state),
      );
      if (existing) return existing;
      const row = await ownedOrder(client, user.link, id);
      if (!supportedResting(row) || row.cannotCancel)
        throw unavailable("UNSUPPORTED_ORDER", 409);
      assertAuthorized(user, client);
      const intent = store.create(user.link.tradingKey, {
        kind: "cancel",
        orderId: id,
        state: "submitting",
        symbol: row.symbol,
        sessionId: user.sessionId,
      });
      snapshots.delete(client);
      try {
        const payload = await client.brokerRequest(
          "DELETE",
          `/iserver/account/${user.link.accountId}/order/${id}`,
        );
        snapshots.delete(client);
        if (payload?.error)
          return store.save(user.link.tradingKey, {
            ...intent,
            state: "rejected",
            messages: [String(payload.error).slice(0, 4000)],
          });
        if (
          orderId(payload) !== id ||
          (payload.account != null && payload.account !== user.link.accountId)
        )
          throw unavailable();
        return store.save(user.link.tradingKey, {
          ...intent,
          state: "cancel_pending",
        });
      } catch {
        return store.save(user.link.tradingKey, {
          ...intent,
          state: "unknown",
        });
      }
    },
    async activity(client, user) {
      const intents = list(user.link);
      if (pendingWarning(user.link))
        return {
          intents,
          orders: null,
          executions: null,
          receivedAt: now(),
          executionsReceivedAt: null,
          writesEnabled,
        };
      const current = await snapshot(client, user.link);
      const fills = await executions(client, user.link.accountId);
      const statusResults = new Map();
      const errors = [];
      for (const intent of intents.filter(
        (entry) =>
          entry.state !== "previewed" &&
          !["declined", "rejected"].includes(entry.state),
      )) {
        const matchingOrders = current.rows.filter((row) =>
          intent.orderId
            ? row.orderId === intent.orderId
            : row.reference === intent.reference,
        );
        let row = matchingOrders.length === 1 ? matchingOrders[0] : null;
        if (matchingOrders.length > 1) continue;
        if (
          !row &&
          intent.orderId &&
          !["filled", "cancelled"].includes(intent.state)
        ) {
          if (!statusResults.has(intent.orderId)) {
            try {
              statusResults.set(
                intent.orderId,
                await readStatus(client, user.link, intent.orderId),
              );
            } catch (error) {
              if ([401, 403, 409].includes(error.statusCode)) throw error;
              statusResults.set(intent.orderId, null);
              errors.push("status");
            }
          }
          row = statusResults.get(intent.orderId);
        }
        const matched = fills.rows.filter((row) =>
          intent.orderId
            ? row.orderId === intent.orderId ||
              (intent.kind === "submit" && row.reference === intent.reference)
            : row.reference === intent.reference,
        );
        if (row) {
          let state = statusState(row.status, row.filled);
          if (intent.kind === "cancel" && !terminal.has(row.status)) {
            state =
              intent.state === "unknown" && row.status !== "PendingCancel"
                ? "unknown"
                : "cancel_pending";
          }
          // A matching order ID alone cannot prove an uncertain amendment was
          // applied. Its returned size/type/price must match the reviewed ticket.
          const modified =
            intent.kind !== "modify" ||
            (row.quantity === intent.ticket.quantity &&
              row.orderType === intent.ticket.orderType &&
              (row.orderType === "MKT" || row.price === intent.ticket.price));
          if (modified)
            store.save(user.link.tradingKey, {
              ...intent,
              state,
              orderId: row.orderId,
              brokerStatus: row.status,
              filled: row.filled,
              remaining: row.remaining,
              averagePrice: row.averagePrice,
            });
        } else if (matched.length && intent.kind === "submit") {
          const unique = [
            ...new Map(
              matched
                .filter((row) => row.executionId)
                .map((row) => [row.executionId, row]),
            ).values(),
          ];
          const filled = unique.reduce(
            (sum, row) => sum + (row.quantity ?? NaN),
            0,
          );
          if (filled > 0 && filled <= intent.ticket.quantity)
            store.save(user.link.tradingKey, {
              ...intent,
              filled,
              state: filled === intent.ticket.quantity ? "filled" : "unknown",
            });
        }
      }
      const currentIntents = list(user.link);
      return {
        intents: currentIntents,
        orders: current.rows.map((row) => ({
          ...row,
          canManage:
            supportedResting(row) &&
            !currentIntents.some(
              (intent) =>
                intent.kind === "cancel" &&
                intent.orderId === row.orderId &&
                ["cancel_pending", "unknown"].includes(intent.state),
            ),
        })),
        executions: fills.rows,
        receivedAt: current.receivedAt,
        executionsReceivedAt: fills.receivedAt,
        errors,
        writesEnabled,
      };
    },
  };
}
