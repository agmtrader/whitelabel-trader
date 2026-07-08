import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, '\n');
  }
}

parseEnvFile(path.join(projectRoot, '.env.local'));
parseEnvFile(path.join(projectRoot, '.env'));

const secretCache = new Map();
const secretManagerClient = new SecretManagerServiceClient();

function log(message, meta) {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[trader-server][config] ${message}${suffix}`);
}

async function getSecret(secretId) {
  if (secretCache.has(secretId)) {
    return secretCache.get(secretId);
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'agm-datalake';
  try {
    const [response] = await secretManagerClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/${secretId}/versions/1`,
    });
    const value = response.payload?.data?.toString('utf8')?.trim() || '';

    let parsedValue = value;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value;
    }

    secretCache.set(secretId, parsedValue);
    return parsedValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load secret ${secretId} from Google Secret Manager: ${message}`
    );
  }
}

async function readPrivateKey() {
  const inlineKey = process.env.IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY;
  if (inlineKey) {
    log('Using inline IBKR private key from environment');
    return inlineKey.replace(/\\n/g, '\n');
  }

  const filePath = process.env.IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY_FILE;
  if (filePath) {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectRoot, filePath);
    log('Using IBKR private key file', { resolvedPath });
    return fs.readFileSync(resolvedPath, 'utf8');
  }

  log('Fetching IBKR private key from Secret Manager');
  const secretValue = await getSecret('IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY');
  if (typeof secretValue === 'string' && secretValue.trim()) {
    return secretValue.replace(/\\n/g, '\n');
  }

  throw new Error(
    'Missing IBKR private key. Set IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY, IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY_FILE, or configure gcloud Secret Manager access.'
  );
}

export async function loadConfig() {
  const loadedConfig = {
    projectRoot,
    port: Number(process.env.TRADER_API_PORT || '5100'),
    baseUrl: process.env.IBKR_BASE_URL || 'https://api.ibkr.com',
    privateKey: await readPrivateKey(),
    credentials: {
      F10740574: {
        clientId: process.env.IBKR_FA_CLIENT_ID || 'AGMTechnology-FA2',
        keyId: process.env.IBKR_FA_KEY_ID || 'prodfa',
      },
      I6413690: {
        clientId: process.env.IBKR_FD_CLIENT_ID || 'AGMTechnology-FD2',
        keyId: process.env.IBKR_FD_KEY_ID || 'prodfd',
      },
    },
  };

  log('Loaded server config', {
    port: loadedConfig.port,
    projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'agm-datalake',
    baseUrl: loadedConfig.baseUrl,
  });

  return loadedConfig;
}
