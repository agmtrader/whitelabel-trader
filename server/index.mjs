import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

import { loadConfig } from './config.mjs';
import { IBKRTradingAPI } from './ibkrTradingApi.mjs';

const sessions = new Map();

function log(message, meta) {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[trader-server] ${message}${suffix}`);
}

function logError(message, error, meta) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const payload = {
    ...(meta || {}),
    error: errorMessage,
  };
  console.error(`[trader-server] ${message} ${JSON.stringify(payload)}`);
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Trader-Session',
  });
  response.end(JSON.stringify(payload));
}

function getSessionId(request) {
  const header = request.headers['x-trader-session'];
  return Array.isArray(header) ? header[0] : header;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function getSession(request) {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    throw Object.assign(new Error('Missing X-Trader-Session header'), { statusCode: 401 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw Object.assign(new Error('Unknown trading session'), { statusCode: 401 });
  }

  session.lastUsedAt = Date.now();
  return { sessionId, session };
}

async function handleRequest(request, response) {
  if (!request.url) {
    json(response, 400, { error: 'Missing request URL' });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  log('Incoming request', {
    method: request.method,
    path: url.pathname,
    hasSession: Boolean(getSessionId(request)),
  });

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Trader-Session',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true });
    return;
  }

  try {
    if (request.method === 'POST' && url.pathname === '/accounts/ibkr/sso/create') {
      const body = await readBody(request);
      const credential = String(body.credential || '').trim();
      const ip = String(body.ip || '').trim();
      if (!credential || !ip) {
        json(response, 400, { error: 'Missing credential or ip' });
        return;
      }

      const client = new IBKRTradingAPI(globalThis.__TRADER_SERVER_CONFIG__);
      const result = await client.createSsoSession(credential, ip);
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, {
        client,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      });
      log('Created trading session', { sessionId });
      json(response, 200, { ...result, sessionId });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/accounts/ibkr/sso/initialize') {
      const { session } = getSession(request);
      json(response, 200, await session.client.initializeBrokerageSession());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/accounts/ibkr/sso/logout') {
      const { sessionId, session } = getSession(request);
      const payload = await session.client.logout();
      sessions.delete(sessionId);
      json(response, 200, payload);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/accounts/ibkr/sso/accounts') {
      const { session } = getSession(request);
      json(response, 200, await session.client.getBrokerageAccounts());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/accounts/ibkr/watchlists') {
      const { session } = getSession(request);
      json(response, 200, await session.client.getAllWatchlists());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/accounts/ibkr/watchlist') {
      const { session } = getSession(request);
      const id = String(url.searchParams.get('id') || '').trim();
      if (!id) {
        json(response, 400, { error: 'Missing id' });
        return;
      }
      json(response, 200, await session.client.getWatchlistInformation(id));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/accounts/ibkr/marketdata/snapshot') {
      const { session } = getSession(request);
      const conids = String(url.searchParams.get('conids') || '').trim();
      if (!conids) {
        json(response, 400, { error: 'Missing conids' });
        return;
      }
      json(response, 200, await session.client.getMarketDataSnapshot(conids));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/accounts/ibkr/marketdata/history') {
      const { session } = getSession(request);
      const conid = String(url.searchParams.get('conid') || '').trim();
      const period = String(url.searchParams.get('period') || '').trim();
      const bar = String(url.searchParams.get('bar') || '').trim();
      if (!conid || !period || !bar) {
        json(response, 400, { error: 'Missing conid, period, or bar' });
        return;
      }
      json(response, 200, await session.client.getHistoricalMarketData(conid, period, bar));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/accounts/ibkr/portfolio-analyst') {
      const { session } = getSession(request);
      const body = await readBody(request);
      json(
        response,
        200,
        await session.client.getPortfolioAnalystPerformance(body.acctIds || [], body.freq)
      );
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/accounts/ibkr/contract/')) {
      const { session } = getSession(request);
      const conid = url.pathname.replace('/accounts/ibkr/contract/', '').trim();
      if (!conid) {
        json(response, 400, { error: 'Missing conid' });
        return;
      }
      json(response, 200, await session.client.getContractInfo(conid));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/accounts/ibkr/orders') {
      const { session } = getSession(request);
      json(response, 200, await session.client.getOpenOrders());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/accounts/ibkr/secdef/search') {
      const { session } = getSession(request);
      const body = await readBody(request);
      const symbol = String(body.symbol || '').trim();
      const secType = String(body.secType || 'STK').trim();
      if (!symbol) {
        json(response, 400, { error: 'Missing symbol' });
        return;
      }
      json(response, 200, await session.client.searchSecurities(symbol, secType));
      return;
    }

    json(response, 404, { error: 'Not found' });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    logError('Request failed', error, {
      method: request.method,
      path: url.pathname,
      statusCode,
    });
    json(response, statusCode, {
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
}

export async function startServer() {
  log('Starting server bootstrap');
  const config = await loadConfig();
  globalThis.__TRADER_SERVER_CONFIG__ = config;
  const port = config.port;
  const server = http.createServer((request, response) => {
    handleRequest(request, response);
  });

  server.on('error', (error) => {
    logError('HTTP server error', error, { port });
  });

  server.listen(port, () => {
    log('Server listening', { port, url: `http://localhost:${port}` });
  });

  return server;
}

process.on('unhandledRejection', (error) => {
  logError('Unhandled rejection', error);
});

process.on('uncaughtException', (error) => {
  logError('Uncaught exception', error);
});

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  startServer().catch((error) => {
    logError('Startup failed', error);
    process.exit(1);
  });
}
