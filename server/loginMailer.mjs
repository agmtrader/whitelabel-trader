import nodemailer from "nodemailer";
import { loginCodeMinutes } from "./loginChallenges.mjs";

export function createAgmLoginMailer(
  config,
  { fetchImpl = fetch, now = Date.now } = {},
) {
  let token;
  let tokenExpiresAt = 0;
  let refresh;

  function post(path, body, authorization) {
    return fetchImpl(config.baseUrl + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: "Bearer " + authorization } : {}),
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  }

  async function getToken() {
    if (token && tokenExpiresAt > now()) return token;
    refresh ??= (async () => {
      const response = await post("/token", {
        email: config.email,
        password: config.password,
      });
      if (!response.ok) throw new Error("AGM mail authentication failed");
      const result = await response.json();
      if (
        typeof result?.access_token !== "string" ||
        !result.access_token ||
        !Number.isFinite(result.expires_in) ||
        result.expires_in <= 0
      ) {
        throw new Error("Invalid AGM mail authentication response");
      }
      token = result.access_token;
      tokenExpiresAt = now() + Math.max(0, result.expires_in * 1000 - 30_000);
      return token;
    })().finally(() => {
      refresh = undefined;
    });
    return refresh;
  }

  return async (email, code) => {
    const authorization = await getToken();
    const response = await post(
      "/trader/send_login_code",
      { email, code },
      authorization,
    );
    if (response.status === 401 && token === authorization) token = undefined;
    if (!response.ok || (await response.json())?.accepted !== true) {
      throw new Error("AGM login email was not accepted");
    }
  };
}

export function createLoginMailer(config) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: true,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return async (email, code) => {
    const result = await transport.sendMail({
      from: { name: "AGM Trader", address: config.from },
      to: { address: email },
      subject: "Tu código para iniciar sesión en AGM Trader",
      text: [
        "Tu código de inicio de sesión es " + code + ".",
        "El código vence en " +
          loginCodeMinutes +
          " minutos y solo se puede usar una vez.",
        "Si no solicitaste un código, podés ignorar este mensaje.",
      ].join("\n\n"),
    });
    if (result.accepted.length !== 1)
      throw new Error("Login email was not accepted");
  };
}
