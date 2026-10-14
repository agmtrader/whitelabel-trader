import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import {
  APIError,
  clearBrokerageSession,
  fetchBrokerageAccounts,
  fetchBrokerageStatus,
  fetchMarketSnapshots,
  fetchWatchlistDetail,
  fetchWatchlists,
  loginToBrokerage,
  logoutOfBrokerage,
  type AccountsResponse,
  type MarketSnapshot,
  type WatchlistInstrument,
  type WatchlistSummary,
} from "@/lib/api";

export type TradingInstrument = WatchlistInstrument;
type Status = "disconnected" | "connecting" | "connected" | "expired";
function useTradingState() {
  const [mode, setMode] = useState<"ibkr" | "demo">("ibkr");
  const [status, setStatus] = useState<Status>("disconnected");
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<TradingInstrument[]>([]);
  const [contracts, setContracts] = useState<Record<string, TradingInstrument>>(
    {},
  );
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const quoteBusy = useRef(false);
  const snapshotIds = useRef<string[]>([]);
  const connected = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const remember = useCallback(
    (items: TradingInstrument[]) =>
      setContracts((current) => ({
        ...current,
        ...Object.fromEntries(items.map((item) => [item.conid, item])),
      })),
    [],
  );
  const fail = useCallback((caught: unknown) => {
    const message =
      caught instanceof Error ? caught.message : "Error de conexión IBKR";
    if (
      caught instanceof APIError &&
      [401, 409].includes(caught.statusCode || 0)
    ) {
      connected.current = false;
      generation.current++;
      clearBrokerageSession();
      setStatus("expired");
      setAccounts(null);
      setSnapshots({});
      setError(message);
    }
    return message;
  }, []);
  const refreshQuotes = useCallback(
    async (ids?: string[]) => {
      const targets = ids || snapshotIds.current;
      if (!connected.current || quoteBusy.current || !targets.length) return;
      quoteBusy.current = true;
      const run = generation.current;
      try {
        const rows = await fetchMarketSnapshots(targets.slice(0, 100));
        if (run !== generation.current || !mounted.current) return;
        setSnapshots((current) => ({
          ...current,
          ...Object.fromEntries(rows.map((row) => [row.conid, row])),
        }));
        setQuoteError(null);
      } catch (caught) {
        if (run === generation.current && mounted.current)
          setQuoteError(fail(caught));
      } finally {
        quoteBusy.current = false;
      }
    },
    [fail],
  );
  const selectWatchlist = useCallback(
    async (id: string) => {
      const run = generation.current;
      setBusy(true);
      setError(null);
      try {
        const detail = await fetchWatchlistDetail(id);
        if (run !== generation.current || !mounted.current) return;
        setWatchlistId(id);
        setInstruments(detail.instruments);
        remember(detail.instruments);
        snapshotIds.current = detail.instruments
          .slice(0, 25)
          .map((item) => item.conid);
        await refreshQuotes(snapshotIds.current);
      } catch (caught) {
        if (run === generation.current && mounted.current)
          setError(fail(caught));
      } finally {
        if (run === generation.current && mounted.current) setBusy(false);
      }
    },
    [fail, refreshQuotes, remember],
  );
  const connect = async (credential: string) => {
    if (status === "connecting" || !credential.trim()) return false;
    const run = ++generation.current;
    connected.current = false;
    setStatus("connecting");
    setError(null);
    setQuoteError(null);
    setSnapshots({});
    setContracts({});
    setInstruments([]);
    setWatchlists([]);
    setAccounts(null);
    try {
      await loginToBrokerage(credential.trim());
      const info = await fetchBrokerageAccounts();
      if (run !== generation.current || !mounted.current) return false;
      connected.current = true;
      setAccounts(info);
      setUsername(credential.trim());
      setStatus("connected");
      setMode("ibkr");
      try {
        const lists = await fetchWatchlists();
        if (run !== generation.current) return true;
        setWatchlists(lists);
        const first = lists.find((item) => !item.readOnly) || lists[0];
        if (first) await selectWatchlist(first.id);
      } catch (caught) {
        if (run === generation.current) setError(fail(caught));
      }
      return true;
    } catch (caught) {
      if (run === generation.current && mounted.current) {
        clearBrokerageSession();
        connected.current = false;
        setStatus("disconnected");
        setError(fail(caught));
      }
      return false;
    }
  };
  const disconnect = async () => {
    connected.current = false;
    generation.current++;
    snapshotIds.current = [];
    setSnapshots({});
    setContracts({});
    setInstruments([]);
    setWatchlists([]);
    setAccounts(null);
    setUsername("");
    setStatus("disconnected");
    setError(null);
    setQuoteError(null);
    try {
      await logoutOfBrokerage();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo cerrar la sesión remota",
      );
    }
  };
  const watch = useCallback(
    (items: TradingInstrument[]) => {
      remember(items);
      snapshotIds.current = items.slice(0, 25).map((item) => item.conid);
      void refreshQuotes(snapshotIds.current);
    },
    [remember, refreshQuotes],
  );
  useEffect(() => {
    if (status !== "connected" || mode !== "ibkr") return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refreshQuotes();
    }, 5000);
    let running = false;
    const keepalive = setInterval(async () => {
      if (AppState.currentState !== "active" || running) return;
      running = true;
      const run = generation.current;
      try {
        const health = await fetchBrokerageStatus();
        if (run !== generation.current || !mounted.current) return;
        if (!health.authenticated || !health.connected || health.competing) {
          fail(
            new APIError(
              "La sesión IBKR expiró o está en uso en otra plataforma. Reconectá para continuar.",
              409,
            ),
          );
        }
      } catch (caught) {
        if (run === generation.current && mounted.current)
          setQuoteError(fail(caught));
      } finally {
        running = false;
      }
    }, 60_000);
    return () => {
      clearInterval(timer);
      clearInterval(keepalive);
    };
  }, [status, mode, fail, refreshQuotes]);
  return {
    mode,
    setMode,
    status,
    accounts,
    username,
    error,
    quoteError,
    watchlists,
    watchlistId,
    instruments,
    contracts,
    snapshots,
    busy,
    connect,
    disconnect,
    selectWatchlist,
    remember,
    watch,
    refreshQuotes,
  };
}
const TradingContext = createContext<ReturnType<typeof useTradingState> | null>(
  null,
);
export function TradingProvider({ children }: PropsWithChildren) {
  return (
    <TradingContext.Provider value={useTradingState()}>
      {children}
    </TradingContext.Provider>
  );
}
export function useTrading() {
  const state = useContext(TradingContext);
  if (!state) throw new Error("TradingProvider required");
  return state;
}
