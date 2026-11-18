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
  clearAppSession,
  connectBrokerage,
  fetchBrokerageStatus,
  fetchMarketSnapshots,
  fetchPortfolio,
  fetchOrderActivity,
  fetchWatchlistDetail,
  fetchWatchlists,
  signInToTrader,
  signOutOfTrader,
  type TraderLoginProof,
  type AccountsResponse,
  type MarketSnapshot,
  type WatchlistInstrument,
  type WatchlistSummary,
} from "@/lib/api";
import type {
  OrderActivity,
  OrderIntent,
  Portfolio,
} from "@/lib/trading-types";

export type TradingInstrument = WatchlistInstrument;
type Status =
  "disconnected" | "connecting" | "connected" | "expired" | "competing";
function useTradingState() {
  const [mode, setMode] = useState<"ibkr" | "demo">("ibkr");
  const [status, setStatus] = useState<Status>("disconnected");
  const [signedIn, setSignedIn] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
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
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const [activity, setActivity] = useState<OrderActivity | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const portfolioRunning = useRef(false);
  const activityRunning = useRef(false);
  const confirmationPending = useRef(false);
  const activityVersion = useRef(0);
  const generation = useRef(0);
  const quoteBusy = useRef(false);
  const snapshotIds = useRef<string[]>([]);
  const connected = useRef(false);
  const connecting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const resetBrokerage = useCallback((keepIdentity = false) => {
    connected.current = false;
    generation.current++;
    quoteBusy.current = false;
    snapshotIds.current = [];
    setSessionVersion(generation.current);
    if (!keepIdentity) {
      setAccounts(null);
      setUsername("");
    }
    setSnapshots({});
    setContracts({});
    setInstruments([]);
    setWatchlists([]);
    setWatchlistId(null);
    setBusy(false);
    setQuoteError(null);
    setPortfolio(null);
    setPortfolioError(null);
    setPortfolioBusy(false);
    setActivity(null);
    setActivityError(null);
    setActivityBusy(false);
    portfolioRunning.current = false;
    activityRunning.current = false;
    confirmationPending.current = false;
    activityVersion.current++;
  }, []);
  const remember = useCallback(
    (items: TradingInstrument[]) =>
      setContracts((current) => ({
        ...current,
        ...Object.fromEntries(items.map((item) => [item.conid, item])),
      })),
    [],
  );
  const fail = useCallback(
    (caught: unknown) => {
      const message =
        caught instanceof Error ? caught.message : "Error de conexión IBKR";
      if (
        caught instanceof APIError &&
        caught.code === "APP_SESSION_REQUIRED"
      ) {
        resetBrokerage();
        clearAppSession();
        setSignedIn(false);
        setStatus("expired");
        setError(message);
      } else if (
        caught instanceof APIError &&
        ["BROKER_RECONNECT", "BROKER_COMPETING", "ACCOUNT_MISMATCH"].includes(
          caught.code ?? "",
        )
      ) {
        resetBrokerage(true);
        setStatus(caught.code === "BROKER_COMPETING" ? "competing" : "expired");
        setError(message);
      }
      return message;
    },
    [resetBrokerage],
  );
  const refreshPortfolio = useCallback(async () => {
    if (
      !connected.current ||
      portfolioRunning.current ||
      confirmationPending.current
    )
      return;
    const run = generation.current;
    portfolioRunning.current = true;
    setPortfolioBusy(true);
    try {
      const result = await fetchPortfolio();
      if (run !== generation.current || !mounted.current) return;
      setPortfolio(result);
      setPortfolioError(
        result.errors.length
          ? "IBKR devolvió información parcial. Las secciones no disponibles se muestran como —."
          : null,
      );
    } catch (caught) {
      if (run === generation.current && mounted.current)
        setPortfolioError(fail(caught));
    } finally {
      if (run === generation.current && mounted.current) {
        portfolioRunning.current = false;
        setPortfolioBusy(false);
      }
    }
  }, [fail]);
  const refreshActivity = useCallback(async () => {
    if (!connected.current || activityRunning.current) return;
    const run = generation.current;
    const version = activityVersion.current;
    activityRunning.current = true;
    setActivityBusy(true);
    try {
      const result = await fetchOrderActivity();
      if (
        run !== generation.current ||
        version !== activityVersion.current ||
        !mounted.current
      )
        return;
      confirmationPending.current = result.intents.some(
        (intent) => intent.state === "warning",
      );
      setActivity(result);
      setActivityError(null);
    } catch (caught) {
      if (run === generation.current && mounted.current)
        setActivityError(fail(caught));
    } finally {
      if (run === generation.current && mounted.current) {
        activityRunning.current = false;
        setActivityBusy(false);
      }
    }
  }, [fail]);
  const recordOrder = useCallback((intent: OrderIntent) => {
    activityVersion.current++;
    confirmationPending.current = intent.state === "warning";
    setActivity((current) =>
      current
        ? {
            ...current,
            intents: [
              intent,
              ...current.intents.filter((row) => row.id !== intent.id),
            ],
          }
        : {
            intents: [intent],
            orders: null,
            executions: null,
            receivedAt: Date.now(),
            executionsReceivedAt: null,
            writesEnabled: intent.writesEnabled ?? false,
          },
    );
  }, []);
  const refreshQuotes = useCallback(
    async (ids?: string[]) => {
      const targets = ids || snapshotIds.current;
      if (
        !connected.current ||
        quoteBusy.current ||
        !targets.length ||
        confirmationPending.current
      )
        return;
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
        if (run === generation.current) quoteBusy.current = false;
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
  const connect = async (proof?: TraderLoginProof) => {
    if (connecting.current || (!signedIn && !proof)) return false;
    connecting.current = true;
    resetBrokerage(signedIn);
    const run = generation.current;
    setStatus("connecting");
    setError(null);
    try {
      if (!signedIn && proof) {
        await signInToTrader(proof);
        if (run !== generation.current || !mounted.current) return false;
        setSignedIn(true);
      }
      const info = await connectBrokerage();
      if (run !== generation.current || !mounted.current) return false;
      connected.current = true;
      setAccounts(info);
      setUsername(info.username);
      setMode("ibkr");
      try {
        const lists = await fetchWatchlists();
        if (run !== generation.current) return false;
        setWatchlists(lists);
        const first = lists.find((item) => !item.readOnly) || lists[0];
        if (first) await selectWatchlist(first.id);
      } catch (caught) {
        if (run === generation.current) setError(fail(caught));
      }
      if (run !== generation.current || !mounted.current) return false;
      setStatus("connected");
      return true;
    } catch (caught) {
      if (run === generation.current && mounted.current) {
        setStatus("disconnected");
        setError(fail(caught));
      }
      return false;
    } finally {
      connecting.current = false;
    }
  };
  const disconnect = async () => {
    if (connecting.current) return;
    resetBrokerage();
    setSignedIn(false);
    setStatus("disconnected");
    setError(null);
    try {
      await signOutOfTrader();
    } catch (caught) {
      if (caught instanceof APIError && caught.code === "APP_SESSION_REQUIRED")
        return;
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
    const checkStatus = async () => {
      if (
        AppState.currentState !== "active" ||
        running ||
        confirmationPending.current
      )
        return;
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
              "BROKER_RECONNECT",
            ),
          );
        }
      } catch (caught) {
        if (run === generation.current && mounted.current)
          setQuoteError(fail(caught));
      } finally {
        running = false;
      }
    };
    const keepalive = setInterval(checkStatus, 60_000);
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") void checkStatus();
    });
    return () => {
      clearInterval(timer);
      clearInterval(keepalive);
      appState.remove();
    };
  }, [status, mode, fail, refreshQuotes]);
  useEffect(() => {
    if (status !== "connected") return;
    const refresh = async () => {
      if (AppState.currentState !== "active") return;
      await refreshActivity();
      await refreshPortfolio();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [status, refreshActivity, refreshPortfolio]);
  return {
    portfolio,
    portfolioError,
    portfolioBusy,
    refreshPortfolio,
    activity,
    activityError,
    activityBusy,
    refreshActivity,
    recordOrder,
    mode,
    setMode,
    status,
    signedIn,
    sessionVersion,
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
    handleApiError: fail,
    clearError: () => setError(null),
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
