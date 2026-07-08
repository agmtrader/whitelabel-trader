import crypto from 'node:crypto';

import { MarketDataField, marketDataFieldNameByValue } from './marketDataFields.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function signJwt(payload, privateKey, keyId) {
  const encodedHeader = base64UrlEncode(
    JSON.stringify({
      typ: 'JWT',
      alg: 'RS256',
      kid: keyId,
    })
  );
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export class IBKRTradingAPI {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.privateKey = config.privateKey;
    this.credentials = config.credentials;
    this.currentCredential = this.credentials.I6413690;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.ssoToken = null;
    this.tokenRefreshBufferMs = 300_000;
  }

  resolveCredential(masterAccount = 'I6413690') {
    const normalized = String(masterAccount || 'I6413690').trim().toUpperCase();
    const credential = this.credentials[normalized];
    if (!credential) {
      throw new Error(
        `Invalid master_account: ${masterAccount}. Expected one of: ${Object.keys(this.credentials).join(', ')}`
      );
    }
    this.currentCredential = credential;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    return credential;
  }

  buildClientAssertion() {
    const now = Math.floor(Date.now() / 1000);
    return signJwt(
      {
        iss: this.currentCredential.clientId,
        sub: this.currentCredential.clientId,
        aud: `${this.baseUrl}/oauth2/api/v1/token`,
        exp: now + 20,
        iat: now - 10,
      },
      this.privateKey,
      this.currentCredential.keyId
    );
  }

  signRequest(body) {
    const now = Math.floor(Date.now() / 1000);
    return signJwt(
      {
        ...body,
        iss: this.currentCredential.clientId,
        exp: now + 1000,
        iat: now,
      },
      this.privateKey,
      this.currentCredential.keyId
    );
  }

  async getBearerToken() {
    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAt - this.tokenRefreshBufferMs) {
      return this.accessToken;
    }

    const payload = new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: this.buildClientAssertion(),
      scope:
        'accounts.read accounts.write bank-instructions.read bank-instructions.write clients.read clients.write echo.read echo.write fee-templates.read fee-templates.write instructions.read instructions.write statements.read transfers.read transfers.write sso-sessions.write sso-browser-sessions.write',
    });

    const response = await fetch(`${this.baseUrl}/oauth2/api/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Token request failed with ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = now + Number(data.expires_in || 0) * 1000;
    return this.accessToken;
  }

  requireSsoHeaders(contentType = 'application/json') {
    if (!this.ssoToken) {
      throw new Error('No SSO token found');
    }

    const headers = {
      Authorization: `Bearer ${this.ssoToken}`,
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  async createSsoSession(credential, ip) {
    this.resolveCredential('I6413690');
    const token = await this.getBearerToken();
    const signedPayload = this.signRequest({ credential, ip });
    const response = await fetch(`${this.baseUrl}/gw/api/v1/sso-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/jwt',
      },
      body: signedPayload,
    });

    if (!response.ok) {
      throw new Error(`SSO session creation failed with ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error(`No access token found in SSO response: ${JSON.stringify(data)}`);
    }
    this.ssoToken = data.access_token;
    return data;
  }

  async initializeBrokerageSession() {
    this.resolveCredential('I6413690');
    const response = await fetch(`${this.baseUrl}/v1/api/iserver/auth/ssodh/init`, {
      method: 'POST',
      headers: this.requireSsoHeaders(),
      body: JSON.stringify({
        publish: true,
        compete: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Brokerage session init failed with ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  async logout() {
    this.resolveCredential('I6413690');
    const response = await fetch(`${this.baseUrl}/v1/api/logout`, {
      method: 'POST',
      headers: this.requireSsoHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Logout failed with ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  async getBrokerageAccounts() {
    this.resolveCredential('I6413690');
    const url = `${this.baseUrl}/v1/api/iserver/accounts`;
    const headers = this.requireSsoHeaders();
    let payload = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Brokerage accounts failed with ${response.status}: ${await response.text()}`);
      }

      payload = await response.json();
      const hasShape =
        payload &&
        typeof payload === 'object' &&
        Array.isArray(payload.accounts) &&
        payload.selectedAccount &&
        payload.aliases &&
        typeof payload.aliases === 'object';

      if (hasShape) {
        break;
      }

      if (attempt < 3) {
        await sleep(500);
      }
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error(`Invalid accounts payload type: ${typeof payload}`);
    }

    if (!Array.isArray(payload.accounts)) {
      payload.accounts = [];
    }
    if (!payload.selectedAccount && payload.accounts.length > 0) {
      payload.selectedAccount = payload.accounts[0];
    }
    if (!payload.aliases || typeof payload.aliases !== 'object') {
      payload.aliases = {};
    }
    for (const accountId of payload.accounts) {
      if (!payload.aliases[accountId]) {
        payload.aliases[accountId] = accountId;
      }
    }

    if (!payload.accounts.length || !payload.selectedAccount) {
      throw new Error(`Incomplete accounts payload after retry: ${JSON.stringify(payload)}`);
    }

    return payload;
  }

  async primeIserverSession(reason) {
    return this.getBrokerageAccounts(reason);
  }

  async requestIserverJson(method, url, { reason, headers, ...init } = {}) {
    await this.primeIserverSession(reason);
    let response = await fetch(url, { method, headers, ...init });

    const bodyText = await response.text();
    const shouldRetry =
      [410, 500].includes(response.status) &&
      (response.status === 410 || bodyText.includes('Please query /accounts first'));

    if (shouldRetry) {
      await this.primeIserverSession(`${reason} retry`);
      response = await fetch(url, { method, headers, ...init });
      const retryText = await response.text();
      if (!response.ok) {
        throw new Error(`IBKR request failed with ${response.status}: ${retryText}`);
      }
      return retryText ? JSON.parse(retryText) : null;
    }

    if (!response.ok) {
      throw new Error(`IBKR request failed with ${response.status}: ${bodyText}`);
    }

    return bodyText ? JSON.parse(bodyText) : null;
  }

  async getAllWatchlists() {
    this.resolveCredential('I6413690');
    return this.requestIserverJson('GET', `${this.baseUrl}/v1/api/iserver/watchlists`, {
      reason: 'get_all_watchlists',
      headers: this.requireSsoHeaders(),
    });
  }

  async getWatchlistInformation(watchlistId) {
    this.resolveCredential('I6413690');
    return this.requestIserverJson(
      'GET',
      `${this.baseUrl}/v1/api/iserver/watchlist?id=${encodeURIComponent(watchlistId)}`,
      {
        reason: `get_watchlist_information id=${watchlistId}`,
        headers: this.requireSsoHeaders(),
      }
    );
  }

  async getMarketDataSnapshot(conids) {
    this.resolveCredential('I6413690');
    const desiredFields = [
      MarketDataField.SYMBOL,
      MarketDataField.COMPANY_NAME,
      MarketDataField.CONID_EXCHANGE,
      MarketDataField.SECTYPE,
      MarketDataField.TEXT,
      MarketDataField.CONTRACT_DESCRIPTION_1,
      MarketDataField.CONTRACT_DESCRIPTION_2,
      MarketDataField.BID_PRICE,
      MarketDataField.BID_SIZE,
      MarketDataField.ASK_PRICE,
      MarketDataField.ASK_SIZE,
      MarketDataField.LAST_PRICE,
      MarketDataField.CHANGE,
      MarketDataField.CHANGE_PERCENT,
      MarketDataField.BID_YIELD,
      MarketDataField.ASK_YIELD,
      MarketDataField.LAST_YIELD,
      MarketDataField.AVG_PRICE,
      MarketDataField.DAILY_PNL,
      MarketDataField.FORMATTED_POSITION,
      MarketDataField.CATEGORY,
      MarketDataField.INDUSTRY,
      MarketDataField.RATINGS,
      MarketDataField.ISSUE_DATE,
      MarketDataField.REGULAR_EXPIRY,
      MarketDataField.LAST_TRADING_DATE,
      MarketDataField.LISTING_EXCHANGE,
      MarketDataField.BOND_TYPE,
      MarketDataField.BOND_STATE_CODE,
    ];

    const url = `${this.baseUrl}/v1/api/iserver/marketdata/snapshot?conids=${encodeURIComponent(conids)}`;
    const headers = this.requireSsoHeaders();

    const firstResponse = await fetch(`${url}&fields=${desiredFields.join(',')}`, { headers });
    if (!firstResponse.ok) {
      throw new Error(`Market snapshot warmup failed with ${firstResponse.status}: ${await firstResponse.text()}`);
    }

    await sleep(10_000);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Market snapshot failed with ${response.status}: ${await response.text()}`);
    }

    const rawData = await response.json();
    const translate = (entry) => {
      const mapped = {};
      for (const [key, value] of Object.entries(entry)) {
        mapped[marketDataFieldNameByValue[key] || key] = value;
      }
      return mapped;
    };

    if (Array.isArray(rawData)) {
      return rawData.map((entry) => translate(entry));
    }
    if (rawData && typeof rawData === 'object') {
      return translate(rawData);
    }
    return rawData;
  }

  async getHistoricalMarketData(conid, period, bar) {
    this.resolveCredential('I6413690');
    const url = new URL(`${this.baseUrl}/v1/api/iserver/marketdata/history`);
    url.searchParams.set('conid', conid);
    url.searchParams.set('period', period);
    url.searchParams.set('bar', bar);
    url.searchParams.set('outsideRth', 'true');

    const response = await fetch(url, {
      headers: this.requireSsoHeaders(null),
    });
    if (!response.ok) {
      throw new Error(`Historical market data failed with ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  async getPortfolioAnalystPerformance(acctIds, freq) {
    this.resolveCredential('I6413690');
    const response = await fetch(`${this.baseUrl}/v1/api/pa/performance`, {
      method: 'POST',
      headers: this.requireSsoHeaders(),
      body: JSON.stringify({
        acctIds: acctIds || [],
        freq,
      }),
    });

    if (!response.ok) {
      throw new Error(`Portfolio analyst failed with ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  async getContractInfo(conid) {
    this.resolveCredential('I6413690');
    const response = await fetch(`${this.baseUrl}/v1/api/iserver/contract/${encodeURIComponent(conid)}/info`, {
      headers: this.requireSsoHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Contract info failed with ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  async getOpenOrders() {
    this.resolveCredential('I6413690');
    return this.requestIserverJson('GET', `${this.baseUrl}/v1/api/iserver/account/orders`, {
      reason: 'get_open_orders',
      headers: this.requireSsoHeaders(),
    });
  }

  async searchSecurities(symbol, secType = 'STK') {
    this.resolveCredential('I6413690');
    const response = await fetch(`${this.baseUrl}/v1/api/iserver/secdef/search`, {
      method: 'POST',
      headers: this.requireSsoHeaders(),
      body: JSON.stringify({
        symbol,
        secType,
      }),
    });
    if (!response.ok) {
      throw new Error(`Security search failed with ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
}
