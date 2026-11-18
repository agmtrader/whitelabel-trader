import assert from "node:assert/strict";

const api = process.env.TRADER_PAPER_API_URL;
const session = process.env.TRADER_PAPER_SESSION_TOKEN;
const account = process.env.TRADER_PAPER_ACCOUNT_ID;
assert.ok(
  api && new URL(api).protocol === "https:",
  "Configure the HTTPS paper test API",
);
assert.ok(
  session && account,
  "Configure the authorized paper session and expected account",
);
async function read(path) {
  const result = await fetch(api + path, {
    headers: { "X-Trader-Session": session },
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(result.status, 200, "Paper application read failed");
  return result.json();
}
const portfolio = await read("/accounts/ibkr/portfolio");
assert.equal(portfolio.accountId, account, "Unexpected paper account");
assert.equal(
  portfolio.accountType,
  "DEMO",
  "Provider must identify the acceptance account as paper",
);
assert.deepEqual(
  portfolio.errors,
  [],
  "Paper portfolio response is incomplete",
);
assert.ok(Array.isArray(portfolio.positions) && Array.isArray(portfolio.cash));
const activity = await read("/accounts/ibkr/orders/activity");
assert.ok(
  Array.isArray(activity.orders) && Array.isArray(activity.executions),
  "Order reads must be available",
);
console.log("Authorized paper account portfolio and activity reads passed");
