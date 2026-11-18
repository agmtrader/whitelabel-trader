import { canonicalIp } from "./security.mjs";

function localAddress(ip) {
  if (ip === "::1" || /^(?:f[cd]|fe[89ab])/i.test(ip)) return true;
  const [first, second] = ip.split(".").map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

export function createIbkrClientIpResolver(
  config,
  { fetchImpl = fetch, now = Date.now } = {},
) {
  let cached;
  let expiresAt = 0;
  let pending;

  return async function resolveClientIp(peer) {
    // Hosted requests retain the client address established by the trusted
    // ingress. Discovery is only for local development on the same network.
    if (config.production || !config.resolveLocalIbkrIp || !localAddress(peer))
      return peer;
    if (cached && expiresAt > now()) return cached;
    pending ??= (async () => {
      try {
        const response = await fetchImpl("https://api.ipify.org", {
          signal: AbortSignal.timeout(5_000),
          redirect: "error",
        });
        if (!response.ok) throw new Error("Public address unavailable");
        const ip = canonicalIp((await response.text()).trim());
        if (!ip || localAddress(ip) || ip === "0.0.0.0" || ip === "::")
          throw new Error("Invalid public address");
        cached = ip;
        expiresAt = now() + 60_000;
        return ip;
      } catch {
        throw Object.assign(
          new Error("IBKR client public address unavailable"),
          {
            statusCode: 503,
            code: "BROKER_CLIENT_IP_UNAVAILABLE",
          },
        );
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
