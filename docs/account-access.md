# Phase 1 account access

## Existing customer login

The default account source is AGM's existing database. Entering an IBKR username resolves `account.ibkr_username` case-insensitively, using that row's `id` and `ibkr_account_number`. Every saved account uses this lookup regardless of account prefix or live/paper classification. Accounts become available as their records are saved, without a separate Trader enrollment or API restart. This refers to the customer's IBKR username on the account record. AGM staff identities in the separate `user` table serve a different application login.

The code goes to the saved `application_json.customer.email`. When that is missing or is the temporary onboarding mailbox, the server uses the single distinct valid email among the account's linked contacts. Duplicate username records, missing email, or multiple holder emails without a registered customer mailbox require correction in the existing account records. The caller cannot choose a recipient. The response stays generic for unmatched usernames. A database outage returns an explicit availability error.

The code expires after ten minutes and works once. The server rechecks the saved account when the code is redeemed and on authenticated requests. Removing a username or changing its account/email invalidates its previous identity. IBKR connectivity and account membership are checked after app login.

Local development uses Google application credentials to read the existing `SUPABASE_DB_URL`, `TRADER_AGM_MAIL_CREDENTIALS`, and `IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY` secrets. `TRADER_DATABASE_SECRET_VERSION` can select an explicit database secret version. Local development may use `SUPABASE_DB_URL` directly. The database connection verifies TLS using the bundled public [Supabase CA certificate](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). Queries read existing account and contact records and use parameterized values.

## Explicit fixture account links

Isolated development fixtures can select `TRADER_ACCOUNT_SOURCE=links` and supply `TRADER_ACCOUNT_LINKS_FILE` in this format. Production links mode uses `TRADER_ACCOUNT_LINKS_SECRET_VERSION`. Normal customer login uses the database source.

```json
[
  {
    "userId": "internal-customer-id",
    "ibkrUsername": "verified_username",
    "accountId": "DU1234567",
    "email": "customer@example.com"
  }
]
```

Existing sessions issued from manually configured links require a fresh database-backed login when switching to the default source.

## Configure email delivery

For AGM's Gmail delivery, set `TRADER_AGM_MAIL_SECRET_VERSION` to the Trader credential in Secret Manager. Local development can also use `TRADER_AGM_MAIL_CONFIG_FILE` with the absolute path of a private JSON file. It holds `baseUrl`, `email`, and `password` for the dedicated AGM API caller. The caller needs the exact `trader/send_login_code` scope and the AGM API must have the endpoint deployed. AGM API sends the fixed message through its existing Gmail mailbox. Trader owns code generation, expiry, verification, and account linkage.

Configure one transport per environment. For SMTP, set `TRADER_SMTP_CONFIG_FILE` to the absolute path of a private JSON file for local development. Hosted environments use `TRADER_SMTP_SECRET_VERSION` in Secret Manager. The JSON has this shape.

```json
{
  "host": "smtp.example.com",
  "port": 587,
  "username": "smtp-user",
  "password": "<SMTP credential>",
  "from": "trader@example.com"
}
```

The API uses TLS for SMTP authentication and delivery. Port 465 uses implicit TLS. Other ports must support STARTTLS. Local sign-in reports delivery unavailable until a mail transport is configured.

Use Node.js 24 LTS. Keep any local mail credentials outside the checkout. Local development resolves the public address through `https://api.ipify.org` when the browser connects through loopback or a private network address. Concurrent requests share that lookup, cached for one minute. Discovery failures stop connection with an explicit availability message. `TRADER_IBKR_CLIENT_IP` remains an optional explicit override for an approved local environment. Hosted requests use the client address supplied through the trusted ingress configuration. Local development defaults to a private persistent app-session and order-intent database under `output/trader-state`. Use `:memory:` only for read/preview development. Orders require durable storage. Set `TRADER_SESSION_FILE` to a file in a private directory to verify persistence across an API restart.

## Hosted configuration

Run Node.js 24 LTS as a dedicated service user behind a single HTTPS ingress. Keep one API process on a persistent private volume. Restart the old process before switching revisions on that volume. IBKR clients, provider tokens, and request budgets live in the running process. The SQLite file holds app session digests, expiry metadata, reviewed tickets, correlated broker state and minimal audit events. It contains account-sensitive order details and must receive the same restricted access and backup controls as account records. Verify the deployment target has the required persistent storage and ingress behavior before going live.

Set `NODE_ENV=production` and supply these values explicitly:

| Variable | Value |
| --- | --- |
| `TRADER_API_HOST`, `TRADER_API_PORT` or platform `PORT` | Private listener reachable by ingress |
| `TRADER_ALLOWED_ORIGINS` | Comma-separated exact HTTPS origins hosting the app |
| `TRADER_TRUSTED_PROXIES` | Comma-separated exact IP addresses of the trusted ingress peers |
| `TRADER_SESSION_FILE` | Absolute path on the persistent private volume. The file must be private and the directory must permit SQLite journal files. |
| `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` | Secret Manager project |
| `TRADER_DATABASE_SECRET_VERSION` | Full, versioned Secret Manager resource containing AGM's existing Postgres connection URL |
| `TRADER_AGM_MAIL_SECRET_VERSION` or `TRADER_SMTP_SECRET_VERSION` | Full, versioned Secret Manager resource containing credentials for the selected transport |
| `IBKR_PRIVATE_KEY_SECRET_VERSION` | Full, versioned Secret Manager resource containing the FD signing key |
| `IBKR_BASE_URL` | `https://api.ibkr.com` |
| `IBKR_FD_MASTER_ACCOUNT`, `IBKR_FD_CLIENT_ID`, `IBKR_FD_KEY_ID` | Approved FD identity and signing configuration |
| `EXPO_PUBLIC_TRADER_API_BASE_URL` | HTTPS API URL in the app build |

The ingress must overwrite `X-Forwarded-Proto` and append the connecting client's address as the rightmost `X-Forwarded-For` value. Restrict network access to the private listener to that ingress. Verify the forwarded address is the client's public IP before exercising IBKR. The unauthenticated `GET /health` response is a minimal liveness probe.

Defaults are 15 minutes idle, eight hours absolute, 16 KiB per JSON body, 15 seconds to receive a request, 120 requests per minute per IP and per signed-in user, and eight code requests per minute per IP. Tune `TRADER_SESSION_IDLE_MS`, `TRADER_SESSION_ABSOLUTE_MS`, `TRADER_MAX_BODY_BYTES`, `TRADER_REQUEST_TIMEOUT_MS`, `TRADER_REQUESTS_PER_MINUTE`, and `TRADER_LOGINS_PER_MINUTE` using hosted acceptance evidence.

## Security and incident response

- The server sends codes only to verified addresses on file and returns the same request response for registered and unregistered usernames. A code expires after ten minutes, is consumed after successful verification or five wrong guesses, and is replaced when the user resends. Code requests are limited to one per minute and five per hour per username. Codes pending at restart expire. After verification the server opens the linked IBKR session and confirms the account and brokerage readiness. Portfolio and order adapters must derive account scope from the verified link. Order status, cancel, modify and confirmation routes verify targets through the linked account and scoped provider records. A single per-user request queue blocks quote, keepalive, market, portfolio and unrelated order requests while a broker warning requires a reply. Warning state lost during logout or restart becomes an uncertain outcome and requires reconciliation.
- The app explicitly attaches the opaque app session token to API calls and holds it in memory. No ambient cookie is set. The API verifies HTTPS ingress and the browser origin allowlist in production. Keep the frontend origin restricted to trusted app content.
- Limit access to the database secret, mail credentials, signing key and session volume. Give the service account read access only to the required Secret Manager secrets. Keep email addresses, sign-in codes, API tokens, headers, request bodies, query strings, upstream errors, and account data out of app, ingress and tracing logs. Use the route label and status in the redacted API logs for investigation.
- If a verified mailbox is compromised, correct the saved account/contact email through AGM's existing verification workflow. Confirm old sessions are denied. If brokerage compromise is suspected, coordinate revocation with IBKR and check account activity through the approved process.
- To invalidate every app session, stop the API and switch it to a new private session database on the persistent volume. Leave the old volume data under the applicable retention policy. A normal restart preserves the app login until expiry and prompts an active app to reconnect to IBKR.

## Acceptance

With two approved FD paper accounts, enter each IBKR username, verify code delivery to its verified inbox, and confirm correct sign-in and account display, watchlists and quotes, and open-order isolation. Try a wrong, expired, and already-used code. Sign out and check that the former session cannot fetch data. With a short configured app timeout, verify that the app clears account data and asks for sign-in. With the app session still valid, restart the API and verify **Reconectar IBKR** restores only the linked account. Repeat on the actual HTTPS origin and supported physical devices. Use [#6](https://github.com/agmtrader/whitelabel-trader/issues/6) for regression evidence. Use [#4](https://github.com/agmtrader/whitelabel-trader/issues/4) for order lifecycle and [#10](https://github.com/agmtrader/whitelabel-trader/issues/10) for current portfolio.

## Release and paper checks

Release builds must supply `EXPO_PUBLIC_TRADER_API_BASE_URL` explicitly. The compiled app reports a configuration error when that value is missing. iOS enforces App Transport Security. Local networking remains available for development.

The manually dispatched `paper-read-check` job uses environment secrets `TRADER_PAPER_API_URL`, `TRADER_PAPER_SESSION_TOKEN` and `TRADER_PAPER_ACCOUNT_ID`. Supply a short-lived app session obtained through the normal verified login. The job requires HTTPS and provider-confirmed `DEMO` metadata, checks current portfolio and activity, and prints only the result. The normal application supports provider-authorized live and paper accounts.

Record the release commit, HTTPS environment, two-account ownership check, email delivery, restart/reconnect, expiry, logout failure, portfolio reconciliation and supported physical-device evidence. Separately record explicitly authorized paper review, warning acknowledgement, submission, fills, modification/cancellation and timeout recovery. CI exports establish compilation. Physical-device behavior remains an acceptance check.
