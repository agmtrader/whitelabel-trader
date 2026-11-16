# Phase 1 account access

## Provision an existing customer

1. Verify the customer's email and check the authoritative AGM/IBKR records for their FD-eligible username and individual account ID. Record who verified the link and when in the existing restricted operator records.
2. Assign a stable internal user ID and store the verified link in the format below. Each record uses a unique email, app identity, IBKR username and account.
3. Reload the API with the updated links. The customer enters their IBKR username and then the eight-digit code delivered to the verified email on file. Usernames are matched without regard to case.

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

Migrate existing links by replacing the access-key hash with the email from AGM's verified records. The change requires users with old access-key sessions to sign in again. Updating a verified email or account link invalidates the corresponding app sessions after reload.

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

Use Node.js 24 LTS. Keep the links and SMTP configuration files outside the checkout. Set `TRADER_ACCOUNT_LINKS_FILE` to the absolute path of the links file. For real FD requests from a loopback installation set `TRADER_IBKR_CLIENT_IP` to the requesting customer's public IP and use an approved IBKR environment. Local development defaults to an in-memory app session database. Set `TRADER_SESSION_FILE` to a file in a private directory to verify persistence across an API restart.

## Hosted configuration

Run Node.js 24 LTS as a dedicated service user behind a single HTTPS ingress. Keep one API process on a persistent private volume. Restart the old process before switching revisions on that volume. IBKR clients, provider tokens, and request budgets live in the running process. The SQLite file holds app session digests and expiry metadata. Verify the deployment target has the required persistent storage and ingress behavior before going live.

Set `NODE_ENV=production` and supply these values explicitly:

| Variable | Value |
| --- | --- |
| `TRADER_API_HOST`, `TRADER_API_PORT` or platform `PORT` | Private listener reachable by ingress |
| `TRADER_ALLOWED_ORIGINS` | Comma-separated exact HTTPS origins hosting the app |
| `TRADER_TRUSTED_PROXIES` | Comma-separated exact IP addresses of the trusted ingress peers |
| `TRADER_SESSION_FILE` | Absolute path on the persistent private volume. The file must be private and the directory must permit SQLite journal files. |
| `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` | Secret Manager project |
| `TRADER_ACCOUNT_LINKS_SECRET_VERSION` | Full, versioned Secret Manager resource containing verified links |
| `TRADER_AGM_MAIL_SECRET_VERSION` or `TRADER_SMTP_SECRET_VERSION` | Full, versioned Secret Manager resource containing credentials for the selected transport |
| `IBKR_PRIVATE_KEY_SECRET_VERSION` | Full, versioned Secret Manager resource containing the FD signing key |
| `IBKR_BASE_URL` | `https://api.ibkr.com` |
| `IBKR_FD_MASTER_ACCOUNT`, `IBKR_FD_CLIENT_ID`, `IBKR_FD_KEY_ID` | Approved FD identity and signing configuration |
| `EXPO_PUBLIC_TRADER_API_BASE_URL` | HTTPS API URL in the app build |

The ingress must overwrite `X-Forwarded-Proto` and append the connecting client's address as the rightmost `X-Forwarded-For` value. Restrict network access to the private listener to that ingress. Verify the forwarded address is the client's public IP before exercising IBKR. The unauthenticated `GET /health` response is a minimal liveness probe.

Defaults are 15 minutes idle, eight hours absolute, 16 KiB per JSON body, 15 seconds to receive a request, 120 requests per minute per IP and per signed-in user, and eight code requests per minute per IP. Tune `TRADER_SESSION_IDLE_MS`, `TRADER_SESSION_ABSOLUTE_MS`, `TRADER_MAX_BODY_BYTES`, `TRADER_REQUEST_TIMEOUT_MS`, `TRADER_REQUESTS_PER_MINUTE`, and `TRADER_LOGINS_PER_MINUTE` using hosted acceptance evidence.

## Security and incident response

- The server sends codes only to verified addresses on file and returns the same request response for registered and unregistered usernames. A code expires after ten minutes, is consumed after successful verification or five wrong guesses, and is replaced when the user resends. Code requests are limited to one per minute and five per hour per username. Codes pending at restart expire. After verification the server opens the linked IBKR session and confirms the account and brokerage readiness. Portfolio and order adapters must derive account scope from the verified link. Future order status, cancel, modify and confirmation routes must verify the target and block quote, keepalive and portfolio refreshes while an IBKR reply is pending.
- The app explicitly attaches the opaque app session token to API calls and holds it in memory. No ambient cookie is set. The API verifies HTTPS ingress and the browser origin allowlist in production. Keep the frontend origin restricted to trusted app content.
- Limit access to the links secret, mail credentials, signing key and session volume. Give the service account read access only to the required Secret Manager secrets. Keep email addresses, sign-in codes, API tokens, headers, request bodies, query strings, upstream errors, and account data out of app, ingress and tracing logs. Use the route label and status in the redacted API logs for investigation.
- If a verified mailbox is compromised, remove the account link or replace the address after re-verification, publish the new links secret version, and restart the API using that version. Confirm old sessions are denied. If brokerage compromise is suspected, coordinate revocation with IBKR and check account activity through the approved process.
- To invalidate every app session, stop the API and switch it to a new private session database on the persistent volume. Leave the old volume data under the applicable retention policy. A normal restart preserves the app login until expiry and prompts an active app to reconnect to IBKR.

## Acceptance

With two approved FD paper accounts, enter each IBKR username, verify code delivery to its verified inbox, and confirm correct sign-in and account display, watchlists and quotes, and open-order isolation. Try a wrong, expired, and already-used code. Sign out and check that the former session cannot fetch data. With a short configured app timeout, verify that the app clears account data and asks for sign-in. With the app session still valid, restart the API and verify **Reconectar IBKR** restores only the linked account. Repeat on the actual HTTPS origin and supported physical devices. Use [#6](https://github.com/agmtrader/whitelabel-trader/issues/6) for regression evidence. Use [#4](https://github.com/agmtrader/whitelabel-trader/issues/4) for order lifecycle and [#10](https://github.com/agmtrader/whitelabel-trader/issues/10) for current portfolio.
