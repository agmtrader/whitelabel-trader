import { createPrivateKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEmail } from "./accountAccess.mjs";
import { canonicalIp } from "./security.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ibkrOrigin = "https://api.ibkr.com";
const loopbackOrigins = [
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:8082",
  "http://127.0.0.1:8082",
];

function parseEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const separator = line.indexOf("=");
    if (!line || line.startsWith("#") || separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!key || env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value.replace(/\\n/g, "\n");
  }
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error("Missing " + name);
  return value;
}

function positiveInteger(
  value,
  name,
  fallback,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > maximum
  ) {
    throw new Error("Invalid " + name);
  }
  return number;
}

function list(value) {
  return value.split(",").map((item) => item.trim());
}

function isAllowedOrigin(origin, production) {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === "https:" || (!production && url.protocol === "http:"))
    );
  } catch {
    return false;
  }
}

function loadSecurityConfig(env, production) {
  const originSetting = production
    ? required(env, "TRADER_ALLOWED_ORIGINS")
    : env.TRADER_ALLOWED_ORIGINS;
  const allowedOrigins =
    originSetting === undefined ? loopbackOrigins : list(originSetting);
  if (allowedOrigins.some((origin) => !isAllowedOrigin(origin, production))) {
    throw new Error("TRADER_ALLOWED_ORIGINS must contain exact origins");
  }

  const proxySetting = production
    ? required(env, "TRADER_TRUSTED_PROXIES")
    : env.TRADER_TRUSTED_PROXIES;
  const trustedProxies =
    proxySetting === undefined ? [] : list(proxySetting).map(canonicalIp);
  if (trustedProxies.includes(null)) {
    throw new Error("TRADER_TRUSTED_PROXIES must contain exact IP addresses");
  }

  const sessionFile = production
    ? required(env, "TRADER_SESSION_FILE")
    : (env.TRADER_SESSION_FILE ??
      path.join(projectRoot, "output", "trader-state", "session.sqlite"));
  if (
    !path.isAbsolute(sessionFile) &&
    (production || sessionFile !== ":memory:")
  ) {
    throw new Error("TRADER_SESSION_FILE must be an absolute path");
  }
  const sessionIdleMs = positiveInteger(
    env.TRADER_SESSION_IDLE_MS,
    "TRADER_SESSION_IDLE_MS",
    15 * 60_000,
  );
  const sessionAbsoluteMs = positiveInteger(
    env.TRADER_SESSION_ABSOLUTE_MS,
    "TRADER_SESSION_ABSOLUTE_MS",
    8 * 60 * 60_000,
  );
  if (sessionIdleMs > sessionAbsoluteMs) {
    throw new Error("Session idle timeout exceeds absolute timeout");
  }

  if (production && env.TRADER_IBKR_CLIENT_IP !== undefined) {
    throw new Error("TRADER_IBKR_CLIENT_IP is local development only");
  }
  const ibkrClientIp =
    env.TRADER_IBKR_CLIENT_IP === undefined
      ? undefined
      : canonicalIp(env.TRADER_IBKR_CLIENT_IP);
  if (ibkrClientIp === null) throw new Error("Invalid TRADER_IBKR_CLIENT_IP");

  return {
    production,
    allowedOrigins,
    trustedProxies,
    ibkrClientIp,
    resolveLocalIbkrIp: !production && !ibkrClientIp,
    sessionFile,
    sessionIdleMs,
    sessionAbsoluteMs,
    maxBodyBytes: positiveInteger(
      env.TRADER_MAX_BODY_BYTES,
      "TRADER_MAX_BODY_BYTES",
      16_384,
      1_048_576,
    ),
    requestTimeoutMs: positiveInteger(
      env.TRADER_REQUEST_TIMEOUT_MS,
      "TRADER_REQUEST_TIMEOUT_MS",
      15_000,
      2_147_483_647,
    ),
    requestRatePerMinute: positiveInteger(
      env.TRADER_REQUESTS_PER_MINUTE,
      "TRADER_REQUESTS_PER_MINUTE",
      120,
    ),
    loginRatePerMinute: positiveInteger(
      env.TRADER_LOGINS_PER_MINUTE,
      "TRADER_LOGINS_PER_MINUTE",
      8,
    ),
  };
}

function secretVersion(env, setting, projectId) {
  const value = required(env, setting);
  const versionPattern =
    /^projects\/([a-z0-9-]+)\/secrets\/[A-Za-z0-9_-]+\/versions\/(?:[1-9][0-9]*|latest)$/;
  if (versionPattern.exec(value)?.[1] !== projectId) {
    throw new Error(
      "Invalid " + setting + " for the configured Google Cloud project",
    );
  }
  return value;
}

async function readSecret(secretManager, resource, label) {
  try {
    const client = await secretManager();
    const [response] = await client.accessSecretVersion({
      name: resource,
    });
    const value = response.payload?.data?.toString("utf8")?.trim();
    if (!value) throw new Error("Empty secret");
    return value;
  } catch {
    throw new Error("Could not load " + label + " from Google Secret Manager");
  }
}

function parsePrivateKey(value) {
  try {
    const serialized = value.startsWith('"') ? JSON.parse(value) : value;
    const key = createPrivateKey(serialized.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "rsa") throw new Error("Expected RSA key");
    return key;
  } catch {
    throw new Error("Invalid IBKR RSA private key");
  }
}

async function readPrivateKey(env, secretManager, keyResource) {
  let value = env.IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY;
  if (!value && env.IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY_FILE) {
    try {
      value = fs.readFileSync(
        path.resolve(projectRoot, env.IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY_FILE),
        "utf8",
      );
    } catch {
      throw new Error("Could not read the local IBKR private key file");
    }
  }
  value ||= await readSecret(secretManager, keyResource, "IBKR private key");
  return parsePrivateKey(value.trim());
}

async function readJsonConfig(
  env,
  secretManager,
  resource,
  fileSetting,
  label,
) {
  let value;
  if (resource) {
    value = await readSecret(secretManager, resource, label);
  } else if (env[fileSetting]) {
    if (!path.isAbsolute(env[fileSetting])) {
      throw new Error(fileSetting + " must be an absolute path");
    }
    try {
      value = fs.readFileSync(env[fileSetting], "utf8");
    } catch {
      throw new Error("Could not read the local " + label + " file");
    }
  } else {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Invalid JSON for " + label);
  }
}

function validateSmtp(config) {
  if (config === undefined) return undefined;
  const { host, port, username, password, from } = config ?? {};
  if (
    typeof host !== "string" ||
    !/^[A-Za-z0-9.-]{1,253}$/.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    !password ||
    !normalizeEmail(from)
  ) {
    throw new Error("Invalid SMTP configuration");
  }
  return { host, port, username, password, from: from.trim() };
}

function validateAgmMail(config, production) {
  if (config === undefined) return undefined;
  const { baseUrl, email, password } = config ?? {};
  const url =
    typeof baseUrl === "string" && URL.canParse(baseUrl)
      ? new URL(baseUrl)
      : null;
  const localHttp =
    !production &&
    url?.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !url ||
    (!localHttp && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !normalizeEmail(email) ||
    typeof password !== "string" ||
    !password
  )
    throw new Error("Invalid AGM mail configuration");
  return { baseUrl: url.origin, email: email.trim(), password };
}

export async function loadConfig({
  env: source = process.env,
  secretClient,
} = {}) {
  const env = { ...source };
  if (source === process.env && source.NODE_ENV !== "production") {
    parseEnvFile(path.join(projectRoot, ".env.local"), env);
    parseEnvFile(path.join(projectRoot, ".env"), env);
  }
  const production = env.NODE_ENV === "production";
  const security = loadSecurityConfig(env, production);
  const host = production
    ? required(env, "TRADER_API_HOST")
    : env.TRADER_API_HOST || "127.0.0.1";
  if (host !== "localhost" && !canonicalIp(host))
    throw new Error("Invalid TRADER_API_HOST");
  const port = positiveInteger(
    env.TRADER_API_PORT ?? (production ? env.PORT : undefined),
    "TRADER_API_PORT",
    5100,
    65_535,
  );
  const baseUrl = production
    ? required(env, "IBKR_BASE_URL")
    : env.IBKR_BASE_URL || ibkrOrigin;
  if (production && baseUrl !== ibkrOrigin)
    throw new Error("Invalid production IBKR_BASE_URL");

  const projectId =
    env.GCLOUD_PROJECT ||
    env.GOOGLE_CLOUD_PROJECT ||
    (production ? null : "agm-datalake");
  if (!projectId || !/^[a-z0-9-]+$/.test(projectId))
    throw new Error("Invalid Google Cloud project");
  const localOverrides = [
    "IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY",
    "IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY_FILE",
    "TRADER_ACCOUNT_LINKS_FILE",
    "TRADER_SMTP_CONFIG_FILE",
    "TRADER_AGM_MAIL_CONFIG_FILE",
    "SUPABASE_DB_URL",
  ];
  if (production && localOverrides.some((name) => env[name] !== undefined)) {
    throw new Error(
      "Production keys, account links and mail credentials must use Secret Manager",
    );
  }
  const keyResource =
    production || env.IBKR_PRIVATE_KEY_SECRET_VERSION
      ? secretVersion(env, "IBKR_PRIVATE_KEY_SECRET_VERSION", projectId)
      : "projects/" +
        projectId +
        "/secrets/IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY/versions/latest";
  const accountSource = env.TRADER_ACCOUNT_SOURCE ?? "database";
  if (!["database", "links"].includes(accountSource))
    throw new Error("Invalid TRADER_ACCOUNT_SOURCE");
  const linkResource =
    accountSource === "links" &&
    (production || env.TRADER_ACCOUNT_LINKS_SECRET_VERSION)
      ? secretVersion(env, "TRADER_ACCOUNT_LINKS_SECRET_VERSION", projectId)
      : null;
  const databaseResource =
    accountSource === "database"
      ? production || env.TRADER_DATABASE_SECRET_VERSION
        ? secretVersion(env, "TRADER_DATABASE_SECRET_VERSION", projectId)
        : `projects/${projectId}/secrets/SUPABASE_DB_URL/versions/latest`
      : null;
  const defaultAgmMail =
    !production &&
    !env.TRADER_SMTP_SECRET_VERSION &&
    !env.TRADER_SMTP_CONFIG_FILE;
  const agmMailConfigured =
    env.TRADER_AGM_MAIL_SECRET_VERSION !== undefined ||
    Boolean(env.TRADER_AGM_MAIL_CONFIG_FILE) ||
    defaultAgmMail;
  const agmMailResource =
    env.TRADER_AGM_MAIL_SECRET_VERSION !== undefined
      ? secretVersion(env, "TRADER_AGM_MAIL_SECRET_VERSION", projectId)
      : defaultAgmMail && !env.TRADER_AGM_MAIL_CONFIG_FILE
        ? `projects/${projectId}/secrets/TRADER_AGM_MAIL_CREDENTIALS/versions/latest`
        : null;
  if (
    agmMailConfigured &&
    (env.TRADER_SMTP_SECRET_VERSION !== undefined ||
      env.TRADER_SMTP_CONFIG_FILE)
  ) {
    throw new Error("Configure one login email transport");
  }
  const smtpResource =
    (production && !agmMailConfigured) || env.TRADER_SMTP_SECRET_VERSION
      ? secretVersion(env, "TRADER_SMTP_SECRET_VERSION", projectId)
      : null;
  const fdMasterAccount = production
    ? required(env, "IBKR_FD_MASTER_ACCOUNT")
    : env.IBKR_FD_MASTER_ACCOUNT || "I6413690";
  if (!/^[A-Z][A-Z0-9]{1,63}$/.test(fdMasterAccount))
    throw new Error("Invalid IBKR_FD_MASTER_ACCOUNT");
  const clientId = production
    ? required(env, "IBKR_FD_CLIENT_ID")
    : env.IBKR_FD_CLIENT_ID || "AGMTechnology-FD2";
  const keyId = production
    ? required(env, "IBKR_FD_KEY_ID")
    : env.IBKR_FD_KEY_ID || "prodfd";
  if (!/^[\w.:-]{1,128}$/.test(clientId) || !/^[\w.:-]{1,128}$/.test(keyId)) {
    throw new Error("Invalid IBKR FD client or key ID");
  }

  const secretManager = async () => {
    if (!secretClient) {
      const { SecretManagerServiceClient } =
        await import("@google-cloud/secret-manager");
      secretClient = new SecretManagerServiceClient();
    }
    return secretClient;
  };
  const accountLinks =
    accountSource === "links"
      ? ((await readJsonConfig(
          env,
          secretManager,
          linkResource,
          "TRADER_ACCOUNT_LINKS_FILE",
          "trader account links",
        )) ?? [])
      : [];
  if (!Array.isArray(accountLinks))
    throw new Error("Trader account links must be a JSON array");
  let accountDatabase;
  if (databaseResource) {
    const connectionString =
      env.SUPABASE_DB_URL ||
      (await readSecret(
        secretManager,
        databaseResource,
        "AGM account database",
      ));
    try {
      const url = new URL(connectionString);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname ||
        !url.username ||
        !url.password
      )
        throw new Error("Invalid URL");
    } catch {
      throw new Error("Invalid AGM account database configuration");
    }
    accountDatabase = { connectionString };
  }
  const smtp = validateSmtp(
    await readJsonConfig(
      env,
      secretManager,
      smtpResource,
      "TRADER_SMTP_CONFIG_FILE",
      "trader SMTP credentials",
    ),
  );
  const agmMail = validateAgmMail(
    await readJsonConfig(
      env,
      secretManager,
      agmMailResource,
      "TRADER_AGM_MAIL_CONFIG_FILE",
      "trader AGM mail credentials",
    ),
    production,
  );
  const privateKey = await readPrivateKey(env, secretManager, keyResource);
  return {
    projectRoot,
    port,
    host,
    baseUrl,
    privateKey,
    fdMasterAccount,
    credentials: { [fdMasterAccount]: { clientId, keyId } },
    accountLinks,
    accountDatabase,
    smtp,
    agmMail,
    security,
  };
}
