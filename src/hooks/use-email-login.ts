import { useCallback, useRef, useState } from "react";
import { requestTraderSignIn } from "@/lib/api";

export function useEmailLogin() {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    setUsername("");
    setCode("");
    setChallengeId("");
    setError(null);
  }, []);

  async function requestCode() {
    if (inFlight.current || !username.trim()) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const next = await requestTraderSignIn(username.trim());
      setChallengeId(next);
      setCode("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo solicitar el código.",
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return {
    username,
    setUsername,
    code,
    setCode,
    challengeId,
    sending,
    error,
    requestCode,
    reset,
    canVerify: /^\d{8}$/.test(code),
  };
}
