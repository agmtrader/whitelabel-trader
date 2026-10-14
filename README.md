# AGM Trader

Expo 57 app for iOS, Android, and web. The Spanish mobile design uses a centered 430px canvas on desktop. Its three active tabs are **Inicio**, **Mercado**, and **Más**.

The app uses the existing direct IBKR Trading Web API backend for FD login, brokerage session status, user/system watchlists, stock and ETF contract search, quote snapshots, instrument details, and historical charts. Quotes show the delivery state and provider update time. Missing fields remain `—`; there are no fixture prices or balances in the active interface. Stocks may be delayed according to the username's IBKR market-data permissions.

Order tickets, portfolio, funding, notifications, and profile/security screens are deferred. The original brokerage screen is preserved at `/broker`; real orders and hosted/paper acceptance remain separate work in issues #3–#7.

## Local development

```bash
npm install
npm run server
# In another terminal:
npm run web
```

For a preview without a file watcher:

```bash
npm run export:web
npm run preview
```

Open http://localhost:8082/app/home and enter your IBKR username through **Conectar IBKR**. The export uses two Metro workers. The preview and API server bind to `127.0.0.1` by default; API port 5100 and preview port 8082.

The server fetches `IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY` from Google Secret Manager using local Google credentials / ADC. Existing environment/private-key-file overrides remain supported. Configuration variables include `GCLOUD_PROJECT`, `TRADER_API_PORT`, `TRADER_API_HOST`, `PREVIEW_PORT`, and `EXPO_PUBLIC_TRADER_API_BASE_URL`. Never commit secrets. Provider OAuth/SSO tokens stay on the server; the browser receives an opaque application session ID held in memory. Reloading the app requires reconnecting.

The established FD initialization sends `publish: true, compete: true`, waits two seconds, and verifies brokerage accounts before the UI becomes connected. This preserves the original login behavior. IBKR permits one brokerage session per username, so connecting can replace that username's session on another IBKR platform. See the [official session documentation](https://www.interactivebrokers.com/docs/web-api/authentication/trading).

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

## Design assets

`assets/images/trader/` bundles AGM and instrument logos from the supplied public reference. Inter is bundled through `@expo-google-fonts/inter`. The original visual reference is https://agmt-mobile-prototype.pages.dev.
