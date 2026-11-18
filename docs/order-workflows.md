# Phase 1 order and portfolio workflows

The normal existing-account login establishes the server-owned IBKR username and account link. Every order and portfolio route derives account scope from that verified link. The implementation supports eligible live and paper accounts. The provider confirms membership and contract permissions independently of app sign-in.

## Trading scope

Tickets contain a positive whole-share quantity, BUY or SELL, MKT or LMT. The server fixes DAY, regular hours and SMART routing. Contract metadata must identify stock/ETF security type STK. Contract rules must permit the linked account, order type, DAY applicability, quantity increment and limit-price increment. The server checks available held shares after outstanding sells, and settled cash in the instrument currency against the WhatIf total. Existing unresolved buys make the funding estimate unavailable until their state is resolved. Buying-power display remains the provider's value. The ticket uses the narrower cash-backed trading scope.

Quotes are primed before WhatIf. Broker amount, commission, margin estimates, warning text and quote delivery/time stay visible in review. A changed estimate requires another explicit confirmation. A preview expires locally after one minute. Each reviewed ticket receives a durable intent and correlation reference. Repeated confirmation of that intent returns its current state.

## Application routes

All routes require the current app session and ready brokerage session. Paths start with `/accounts/ibkr`. Order and portfolio requests reject query-string account overrides and unknown ticket/body fields.

| Method and path | Input and behavior |
| --- | --- |
| GET `/portfolio` | Linked-account summary, ledger and all positions |
| GET `/orders/activity` | Durable intents, current scoped orders and recent executions |
| POST `/orders/preview` | `{ticket, modifyOrderId?}` validates and persists review |
| POST `/orders/{intentId}/submit` | `{confirmed: true}` explicitly confirms the persisted ticket |
| POST `/orders/{intentId}/reply` | `{confirmed, warningVersion}` answers the currently displayed warning |
| POST `/orders/{orderId}/cancel` | `{confirmed: true}` requests cancellation of a supported owned resting order |

Modification reuses preview and submit. It verifies the owned order's current status, original instrument/side, filled quantity and modification rules. The provider receives a single modification object. Cancellation preserves `cancel_pending` until broker state confirms cancellation or an execution wins the race. External orders with insufficient original scope metadata stay read-only.

## Warning and recovery behavior

The server serializes brokerage operations for each user. While a warning is pending, the activity route returns the persisted warning and other broker calls remain paused. Each additional warning requires its own explicit answer and version. Repeating a response for an older version cannot accept the next warning. A locally unanswered warning becomes uncertain after one minute. Reconnect, logout and process restart preserve uncertainty when the provider result remains unresolved.

The server persists `submitting` before a mutation. It never retries submit, reply, modify or cancel after a transport failure. A restart converts unfinished submissions and unrecoverable warnings to `unknown`. Activity reconciles correlation references, provider order IDs, statuses and actual execution IDs. Absence from the finite broker history preserves uncertainty and blocks a new submission. Matching an order ID alone cannot confirm an uncertain amendment. Its returned ticket fields must match the reviewed change. Operator investigation through IBKR is required when the retained provider history cannot establish the outcome.

The same private SQLite database stores app sessions, order intents and minimal state-transition audit events. Production must preserve it across process revisions. Run one API process per database. The request scheduler enforces the process-wide request budget and endpoint spacing. Orders, trades and portfolio account discovery have five-second spacing. Executions are cached for one minute and cover the current day plus six earlier days.

## Provider contracts

Paths below are under IBKR `/v1/api`. Sources were checked on November 18, 2026.

| Capability | Source |
| --- | --- |
| Account membership/selection | GET `/iserver/accounts`, POST `/iserver/account` for supported multi-account structures |
| Contract metadata and rules | GET `/iserver/contract/{conid}/info`, POST `/iserver/contract/rules` |
| Estimates | POST `/iserver/account/{accountId}/orders/whatif` after snapshot priming |
| Submit and warning reply | POST `/iserver/account/{accountId}/orders`, POST `/iserver/reply/{replyId}` |
| Modify and cancel | POST / DELETE `/iserver/account/{accountId}/order/{orderId}` |
| Current orders/status | GET `/iserver/account/orders` preflight then complete snapshot, GET `/iserver/account/order/status/{orderId}` after ownership proof |
| Recent executions | GET `/iserver/account/trades` |
| Portfolio | GET `/portfolio/accounts`, `/portfolio/{accountId}/summary`, `/portfolio/{accountId}/ledger`, `/portfolio/{accountId}/positions/{pageId}` |

The summary maps provider `amount`, `currency`, null flags and timestamps. Ledger rows retain their currencies and exclude the duplicate BASE aggregate from the currency list. Positions retain all asset classes and every page, beginning at zero. Position `time` represents generation duration. Realized position P&L is labelled for today. A failed section remains unavailable while other successful sections can be displayed. Cross-account data rejects the response.

Official contracts and pacing are available in the [IBKR Web API reference](https://www.interactivebrokers.com/docs/web-api/v1) and [pacing limits](https://www.interactivebrokers.com/docs/web-api/v1/pacing-limitations). The explicit warning chain follows the [reply contract](https://www.interactivebrokers.com/docs/web-api/v1/endpoints/orders/place-order-reply-confirmation).

## Validation boundary

Local HTTP tests exercise the application's actual authentication, ownership, durable storage, routes and IBKR adapter payloads. Injected transport responses use sanitized documented provider shapes. They cover malformed tickets, permissions, cash/holdings, warnings, duplicate confirmation, timeout/restart recovery, fills and cancel/modify. Hosted, actual provider execution and physical-device acceptance remain separately recorded in issues #3, #4, #5, #6, #10 and #11.
