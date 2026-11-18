import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import {
  createAccountAccess,
  normalizeEmail,
  normalizeUsername,
} from "./accountAccess.mjs";

// Read the existing account record and its saved holders. No separate Trader
// enrollment record is required, and the browser never supplies an email.
const accountFields = `
  select a.id, a.ibkr_username, a.ibkr_account_number,
    a.application_json #>> '{customer,email}' as customer_email,
    a.temporal_email,
    array(select distinct btrim(c.email)
      from public.account_contact ac
      join public.contact c on c.id = ac.contact_id
      where ac.account_id = a.id and nullif(btrim(c.email), '') is not null
    ) as contact_emails
  from public.account a`;

function accountLink(rows) {
  if (rows.length !== 1) return null;
  const row = rows[0];
  const customerEmail = normalizeEmail(row.customer_email);
  const temporaryEmail = normalizeEmail(row.temporal_email);
  const contactEmails = [
    ...new Set(
      (row.contact_emails ?? [])
        .map(normalizeEmail)
        .filter((email) => email && email !== temporaryEmail),
    ),
  ];
  // Imported accounts can lack the application email. A single saved holder
  // mailbox is unambiguous. Temporary onboarding mailboxes cannot prove access.
  const email =
    customerEmail && customerEmail !== temporaryEmail
      ? customerEmail
      : contactEmails.length === 1
        ? contactEmails[0]
        : null;
  if (!email) return null;
  try {
    const username = normalizeUsername(row.ibkr_username);
    const link = createAccountAccess([
      {
        userId: row.id,
        ibkrUsername: username,
        accountId: row.ibkr_account_number?.trim(),
        email,
      },
    ]).findAccount(username);
    return Object.freeze({ ...link, subject: `db.${row.id}.${link.subject}` });
  } catch {
    return null;
  }
}

export function createDatabaseAccountAccess(config, { pool } = {}) {
  if (!pool) {
    const url = new URL(config.connectionString);
    // Explicit TLS settings must survive node-postgres URL parsing.
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
      url.searchParams.delete(key);
    if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "5432")
      url.port = "6543";
    const ssl = { rejectUnauthorized: true };
    if (
      url.hostname.endsWith(".supabase.com") ||
      url.hostname.endsWith(".supabase.co")
    ) {
      // Public root downloaded from Supabase's official certificate endpoint.
      ssl.ca = [
        ...rootCertificates,
        readFileSync(
          new URL("./certs/supabase-prod-ca-2021.crt", import.meta.url),
          "utf8",
        ),
      ];
    }
    pool = new Pool({
      connectionString: url.toString(),
      ssl,
      max: 2,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      application_name: "agm-trader-login",
    });
    pool.on("error", () => {});
  }

  async function lookup(predicate, value) {
    try {
      const result = await pool.query(
        `${accountFields} where ${predicate} = $1 limit 2`,
        [value],
      );
      return accountLink(result.rows);
    } catch (cause) {
      throw Object.assign(
        new Error("Account directory unavailable", { cause }),
        {
          statusCode: 503,
          code: "ACCOUNT_DIRECTORY_UNAVAILABLE",
        },
      );
    }
  }

  return {
    async findAccount(value) {
      const username = normalizeUsername(value);
      return username
        ? lookup("lower(btrim(a.ibkr_username))", username)
        : null;
    },
    async getLink(subject) {
      const match = /^db\.([0-9a-f-]{36})\.[0-9a-f]{64}$/.exec(subject);
      if (!match) return null;
      const link = await lookup("a.id", match[1]);
      return link?.subject === subject ? link : null;
    },
    close: () => pool.end(),
  };
}
