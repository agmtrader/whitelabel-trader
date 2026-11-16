# AGM Trader

Expo 57 app for iOS, Android, and web. The Spanish mobile design uses a centered 430px canvas on desktop. Its three active tabs are **Inicio**, **Mercado**, and **Más**.

The app uses the existing direct IBKR Trading Web API backend for FD brokerage sessions, user/system watchlists, stock and ETF contract search, quote snapshots, instrument details, and historical charts. Enter your IBKR username to receive a one-time code at the email AGM verified for your linked account. Quotes show the delivery state and provider update time. Missing fields remain `—`. Stocks may be delayed according to the username's IBKR market-data permissions.

Order tickets, portfolio, funding, notifications, and profile/security screens are deferred. The original brokerage screen is preserved at `/broker`; real orders and hosted/paper acceptance remain separate work in issues #3–#7.

## Local development

```bash
npm ci
npm run server
# In another terminal:
npm run web
```

For a preview without a file watcher:

```bash
npm run export:web
npm run preview
```

Open http://localhost:8082/app/home, select **Conectar IBKR**, enter your IBKR username, and verify the code sent to your registered email. See [account access and deployment](docs/account-access.md) for local provisioning. The export uses two Metro workers. The preview and API server bind to `127.0.0.1` by default, on ports 8082 and 5100 respectively. The values in `.env.example` illustrate using API port 4002 instead.

The local server can fetch `IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY` from Google Secret Manager using local Google credentials or use a private-key file. Provider OAuth and SSO tokens stay in server memory. The app holds an opaque app session token in memory and asks for sign-in after a reload. A server restart with a durable session file preserves the app session and requires a fresh brokerage connection.

The FD initialization sends `publish: true, compete: true`. The app shows a connected state after IBKR reports brokerage readiness and returns the linked account. IBKR permits one brokerage session per username, so connecting can replace that username's session on another IBKR platform. See the [official session documentation](https://www.interactivebrokers.com/docs/web-api/authentication/trading).

Snapshots prime requested fields once per subscription, merge partial updates, and refresh the visible list every five seconds while the app is active. Only this client's obsolete streams are released. Requests are paced, historical requests have a five-request concurrency limit, and session health is checked every minute.

For physical devices, use `npm run ios` or `npm run android` and configure the API base URL and server host for the development network. Native device acceptance remains separate from browser validation.

## Validation

```bash
npm run typecheck
npm test
npx eslint src/features src/lib/api.ts src/lib/market-data.ts server tests
npm run export:web
```

Tests protect source-data normalization, missing versus zero values, documented watchlist/search shapes, session headers, snapshot preflight and partial updates, upstream error propagation, stream ownership, and the established initialization flow. Full-repository lint still reports pre-existing hook violations in `/broker` and the starter web color-scheme hook, tracked in #6.

Local browser validation on October 14, 2026 verified FD login, watchlists, stock/ETF search, actual quotes with delayed/real-time labels, and daily/monthly IBKR history. This is local validation; deployment, actual order execution, and physical-device acceptance are pending in their separate issues.

## Dependency security

The October 16, 2026 dependency refresh stays on Expo SDK 57 and aligns native packages with Expo's recommended versions. `npm ci` runs `scripts/patch-query-string.mjs` through `postinstall`; install scripts must run. This checked, idempotent patch preserves Expo Router's CommonJS interface while using the patched ESM URI decoder. Xcode's UUID and Metro overrides retain compatible APIs and remove vulnerable transitive versions. Recheck these overrides and remove the patch when upstream consumers support the fixed dependencies directly.

The refreshed lockfile removes the vulnerable versions behind 49 of the 51 alerts captured that day, including the critical `shell-quote` alert. GitHub withdrew the [braces recursion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) on October 23, 2026 because it is not practically exploitable; it does not require a dependency change for this report.

The October 28, 2026 refresh pins both Expo CLI and code-signing consumers to official `node-forge` 1.4.2 through an override and the lockfile. Its [upstream security release](https://github.com/digitalbazaar/forge/blob/v1.4.2/CHANGELOG.md) fixes [CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv) by requiring canonical DER DigestInfo bytes, rejecting extra nested elements, nonempty NULL parameters, non-minimal lengths and noncanonical OIDs. Version 1.4.2 also preserves PEM decoding of Buffer inputs. This replaces the temporary Forge 1.4.0 postinstall backport; Forge protection no longer depends on install scripts. The separate query-string adapter still requires install scripts.

Dependency remediation and GitHub's default-branch rescan are tracked in [#15](https://github.com/agmtrader/whitelabel-trader/issues/15). Local validation does not establish hosted or physical-device acceptance.

The remaining October 28 high-severity [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) is addressed by pinning all consumers to official Zod 4.6.7. Its bounded-collection checks reject oversized input before validating every element. Expo CLI's plugin and MCP schemas and React Hooks' explicit Zod v4 integration are checked for compatibility; this override crosses Expo CLI's declared Zod v3 range.

The low-severity [deepmerge prototype-poisoning advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) has no published fixed release. `scripts/patch-deepmerge.mjs` rejects `__proto__` in both merge loops across every locked copy's CommonJS, UMD and source distributions during `postinstall`. It checks the exact 4.3.1 version and source hashes, fails on drift or partial patches, and preserves ordinary configuration keys. Install scripts must run; `--ignore-scripts` skips this mitigation. The package remains version 4.3.1, so its version-based low-severity audit warning remains. Replace the backport with a compatible official fixed release when available.

## Design assets

`assets/images/trader/` bundles AGM and instrument logos from the supplied public reference. Inter is bundled through `@expo-google-fonts/inter`. The original visual reference is https://agmt-mobile-prototype.pages.dev.
