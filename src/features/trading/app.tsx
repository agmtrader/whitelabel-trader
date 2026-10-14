import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  type DimensionValue,
} from "react-native";
import {
  useSafeAreaInsets,
  SafeAreaView,
} from "react-native-safe-area-context";
import {
  useLocalSearchParams,
  usePathname,
  useRouter,
  type Href,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import {
  ChartColumn,
  House,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react-native";
import {
  fetchContractInfo,
  fetchHistoricalMarketData,
  searchSecurities,
  type HistoricalBar,
  type MarketSnapshot,
} from "@/lib/api";
import { historyQueries, marketDelivery, text } from "@/lib/market-data";
import { usePrototype } from "@/features/prototype/context";
import {
  Brand,
  Button,
  Chart,
  Header,
  IconButton,
  Input,
  KeyValue,
  Label,
  MenuRow,
  PrimaryButton,
  SearchBox,
  Section,
  Segments,
  StockLogo,
  Txt,
  ui,
} from "@/features/prototype/ui";
import { useTrading, type TradingInstrument } from "./context";

const price = (value?: number) =>
  value === undefined
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });
const signed = (value?: number, percent = false) =>
  value === undefined
    ? "—"
    : `${value >= 0 ? "+" : ""}${price(value)}${percent ? "%" : ""}`;

export default function TradingApp() {
  const pathname = usePathname(),
    params = useLocalSearchParams<{ conid?: string; symbol?: string }>();
  return <TradingScreen key={`${pathname}-${params.conid || ""}`} />;
}
function TradingScreen() {
  const pathname = usePathname(),
    params = useLocalSearchParams<{ conid?: string; symbol?: string }>(),
    router = useRouter();
  const { colors, isDark } = usePrototype(),
    trading = useTrading(),
    insets = useSafeAreaInsets();
  const [loginOpen, setLoginOpen] = useState(false);
  const parts = pathname.split("/").filter(Boolean),
    page = parts[1] || "home";
  const detail =
    page === "instrument" || (page === "market" && parts.length === 3);
  const go = (page: string) => router.push(`/app/${page}` as Href);
  const open = (item: TradingInstrument) => {
    trading.remember([item]);
    router.push(
      `/app/instrument?conid=${encodeURIComponent(item.conid)}&symbol=${encodeURIComponent(item.symbol)}` as Href,
    );
  };
  const back = () => (router.canGoBack() ? router.back() : go("market"));
  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <StatusBar style={isDark ? "light" : "dark"} />
      <View
        style={{ flex: 1, alignItems: "center", backgroundColor: colors.bg }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 430,
            flex: 1,
            height:
              Platform.OS === "web" ? ("100dvh" as DimensionValue) : undefined,
          }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {detail ? (
              <InstrumentDetail
                conid={params.conid || ""}
                symbol={params.symbol || parts[2] || ""}
                back={back}
                connect={() => setLoginOpen(true)}
              />
            ) : page === "home" ? (
              <Home go={go} open={open} connect={() => setLoginOpen(true)} />
            ) : page === "market" ? (
              <Market open={open} connect={() => setLoginOpen(true)} />
            ) : (
              <More connect={() => setLoginOpen(true)} />
            )}
            <Txt
              size={10}
              color={colors.muted}
              style={{ marginTop: 20, textAlign: "center" }}
            >
              Datos de mercado · IBKR Trading API
            </Txt>
          </ScrollView>
          <View
            style={[
              ui.row,
              {
                justifyContent: "space-around",
                borderTopWidth: 1,
                borderColor: colors.divider,
                backgroundColor: colors.card,
                paddingTop: 6,
                paddingBottom: Math.max(8, insets.bottom),
              },
            ]}
          >
            {[
              { page: "home", label: "Inicio", icon: House },
              { page: "market", label: "Mercado", icon: ChartColumn },
              { page: "more", label: "Más", icon: Menu },
            ].map((item) => (
              <Button
                key={item.page}
                role="tab"
                selected={
                  page === item.page || (item.page === "market" && detail)
                }
                label={item.label}
                onPress={() => go(item.page)}
                style={{
                  flex: 1,
                  minHeight: 50,
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <item.icon
                  size={20}
                  color={
                    page === item.page || (item.page === "market" && detail)
                      ? colors.primaryText
                      : colors.muted
                  }
                  strokeWidth={1.7}
                />
                <Txt
                  size={10}
                  weight={600}
                  color={
                    page === item.page || (item.page === "market" && detail)
                      ? colors.primaryText
                      : colors.muted
                  }
                >
                  {item.label}
                </Txt>
              </Button>
            ))}
          </View>
          <ConnectionSheet open={loginOpen} close={() => setLoginOpen(false)} />
        </View>
      </View>
    </SafeAreaView>
  );
}
function ConnectionSheet({
  open,
  close,
}: {
  open: boolean;
  close: () => void;
}) {
  const { colors } = usePrototype(),
    trading = useTrading(),
    insets = useSafeAreaInsets();
  const [credential, setCredential] = useState("");
  const connecting = trading.status === "connecting";
  const submit = async () => {
    if (await trading.connect(credential)) {
      setCredential("");
      close();
    }
  };
  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      onRequestClose={() => {
        if (!connecting) close();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "flex-end",
          backgroundColor: "#00000066",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar conexión"
          onPress={() => {
            if (!connecting) close();
          }}
          style={{ position: "absolute", inset: 0 }}
        />
        <View
          accessibilityViewIsModal
          style={{
            width: "100%",
            maxWidth: 430,
            padding: 24,
            paddingBottom: Math.max(24, insets.bottom),
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            backgroundColor: colors.bg,
            gap: 16,
          }}
        >
          <Header
            title="Conectar IBKR"
            right={
              <IconButton
                icon={X}
                label="Cerrar"
                onPress={() => {
                  if (!connecting) close();
                }}
              />
            }
          />
          <Txt color={colors.secondary}>
            Ingresá tu usuario IBKR para conectar con la identidad FD
            configurada.
          </Txt>
          <Input
            accessibilityLabel="Usuario IBKR"
            placeholder="Usuario IBKR"
            autoCapitalize="none"
            autoCorrect={false}
            value={credential}
            onChangeText={setCredential}
            editable={!connecting}
            onSubmitEditing={() => void submit()}
          />
          {trading.error && (
            <Txt size={12} color={colors.red}>
              {trading.error}
            </Txt>
          )}
          <PrimaryButton
            title={connecting ? "Conectando…" : "Conectar"}
            disabled={!credential.trim() || connecting}
            onPress={() => void submit()}
          />
          <Txt size={11} color={colors.muted}>
            La conexión usa tu sesión de IBKR. Las claves permanecen en el
            servidor.
          </Txt>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
function ConnectionPrompt({ connect }: { connect: () => void }) {
  const { colors } = usePrototype(),
    trading = useTrading();
  return (
    <Section style={{ padding: 20, gap: 16 }}>
      <Txt size={18} weight={700}>
        Tu mercado, conectado
      </Txt>
      <Txt color={colors.secondary}>
        Conectá tu sesión IBKR para consultar precios, listas y gráficos reales.
      </Txt>
      {trading.error && (
        <Txt size={12} color={colors.red}>
          {trading.error}
        </Txt>
      )}
      <PrimaryButton title="Conectar IBKR" onPress={connect} />
    </Section>
  );
}
function QuoteState({ quote }: { quote?: MarketSnapshot }) {
  const { colors } = usePrototype();
  return (
    <Txt size={10} color={colors.muted}>
      {marketDelivery(quote?.availability)}
      {quote?.updatedAt
        ? ` · ${new Date(quote.updatedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`
        : ""}
    </Txt>
  );
}
function QuoteRow({
  item,
  open,
}: {
  item: TradingInstrument;
  open: (item: TradingInstrument) => void;
}) {
  const { colors } = usePrototype(),
    { snapshots } = useTrading(),
    quote = snapshots[item.conid];
  return (
    <Button
      label={`${item.symbol} ${item.name}${item.description && item.description !== item.name ? ` ${item.description}` : ""}`}
      onPress={() => open(item)}
      style={[
        ui.row,
        {
          gap: 12,
          paddingVertical: 15,
          borderBottomWidth: 1,
          borderColor: colors.divider,
        },
      ]}
    >
      <StockLogo symbol={item.symbol} />
      <View style={{ flex: 1 }}>
        <Txt weight={700}>{quote?.symbol || item.symbol}</Txt>
        <Txt size={12} color={colors.muted} lines={1}>
          {quote?.companyName || item.name}
        </Txt>
        {!!(quote?.listingExchange || item.description) &&
          (quote?.listingExchange || item.description) !==
            (quote?.companyName || item.name) && (
            <Txt size={10} color={colors.muted} lines={1}>
              {quote?.listingExchange || item.description}
            </Txt>
          )}
        <QuoteState quote={quote} />
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Txt weight={600}>{price(quote?.lastPrice)}</Txt>
        <Txt
          size={12}
          color={
            quote?.changePercent === undefined
              ? colors.muted
              : quote.changePercent >= 0
                ? colors.green
                : colors.red
          }
        >
          {signed(quote?.changePercent, true)}
        </Txt>
      </View>
    </Button>
  );
}
function Home({
  go,
  open,
  connect,
}: {
  go: (page: string) => void;
  open: (item: TradingInstrument) => void;
  connect: () => void;
}) {
  const { colors } = usePrototype(),
    trading = useTrading();
  const { instruments, status, watch } = trading;
  useEffect(() => {
    if (status === "connected") watch(instruments);
  }, [instruments, status, watch]);
  return (
    <>
      <LinearGradient
        colors={[colors.primary + "12", colors.bg]}
        style={{ padding: 16, paddingBottom: 24 }}
      >
        <View style={[ui.row, { gap: 10, marginBottom: 20 }]}>
          <Brand />
          <View>
            <Txt size={12} color={colors.muted}>
              Hola,
            </Txt>
            <Txt weight={700}>{trading.username || "bienvenido"}</Txt>
          </View>
        </View>
        <LinearGradient
          colors={["#f26c0d", "#cc5a08", "#a34700"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 16, padding: 20, gap: 8 }}
        >
          <Txt size={12} color="#ffffffb3">
            IBKR Trading API
          </Txt>
          <Txt size={26} weight={800} color="#fff">
            {trading.status === "connected"
              ? "Mercado conectado"
              : "Tu próxima inversión"}
          </Txt>
          <Txt size={12} color="#ffffffb3">
            {trading.status === "connected"
              ? "Precios y gráficos desde tu sesión IBKR"
              : "Información real para decidir mejor"}
          </Txt>
          <Button
            label={
              trading.status === "connected"
                ? "Explorar mercado"
                : "Conectar IBKR"
            }
            onPress={() =>
              trading.status === "connected" ? go("market") : connect()
            }
            style={[
              ui.row,
              {
                marginTop: 12,
                justifyContent: "center",
                padding: 12,
                gap: 8,
                backgroundColor: "#ffffff26",
                borderRadius: 12,
              },
            ]}
          >
            <Search size={16} color="#fff" />
            <Txt weight={600} color="#fff">
              {trading.status === "connected"
                ? "Explorar mercado"
                : "Conectar IBKR"}
            </Txt>
          </Button>
        </LinearGradient>
      </LinearGradient>
      <View style={{ paddingHorizontal: 16 }}>
        {trading.status === "connected" ? (
          <>
            <Label>MIS LISTAS</Label>
            {trading.watchlists.length > 0 && (
              <Segments
                values={trading.watchlists.map((item) => item.name)}
                value={
                  trading.watchlists.find(
                    (item) => item.id === trading.watchlistId,
                  )?.name || ""
                }
                onChange={(name) => {
                  const item = trading.watchlists.find(
                    (item) => item.name === name,
                  );
                  if (item) void trading.selectWatchlist(item.id);
                }}
                scroll
                small
              />
            )}
            {trading.busy && (
              <ActivityIndicator
                color={colors.primary}
                style={{ margin: 20 }}
              />
            )}
            {trading.error && (
              <Txt size={12} color={colors.red} style={{ marginVertical: 12 }}>
                {trading.error}
              </Txt>
            )}
            {trading.quoteError && (
              <Txt size={12} color={colors.red} style={{ marginVertical: 12 }}>
                {trading.quoteError} · Los precios mostrados pueden estar
                desactualizados.
              </Txt>
            )}
            {trading.instruments.slice(0, 25).map((item) => (
              <QuoteRow key={item.conid} item={item} open={open} />
            ))}
            {!trading.busy && !trading.instruments.length && (
              <Section style={{ padding: 20 }}>
                <Txt color={colors.secondary}>
                  Tu lista está vacía. Buscá un instrumento en Mercado para
                  consultar su precio y gráfico.
                </Txt>
              </Section>
            )}
          </>
        ) : (
          <ConnectionPrompt connect={connect} />
        )}
      </View>
    </>
  );
}
function Market({
  open,
  connect,
}: {
  open: (item: TradingInstrument) => void;
  connect: () => void;
}) {
  const { colors } = usePrototype(),
    trading = useTrading();
  const [query, setQuery] = useState(""),
    [searchType, setSearchType] = useState("Ticker");
  const [results, setResults] = useState<TradingInstrument[] | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const { instruments, status, watch } = trading;
  useEffect(() => {
    if (status === "connected") watch(results ?? instruments);
  }, [instruments, results, status, watch]);
  const search = async () => {
    if (!query.trim() || loading || trading.status !== "connected") return;
    setLoading(true);
    setError(null);
    try {
      const rows = await searchSecurities(
        query.trim(),
        "STK",
        searchType === "Nombre",
      );
      if (!active.current) return;
      const items = rows
        .filter((row) => row.secType === "STK")
        .map((row) => ({
          conid: row.conid,
          symbol: row.symbol,
          name: row.companyName || row.description,
          description: row.description,
          assetClass: row.secType,
          raw: row.raw,
        }));
      setResults(items);
    } catch (caught) {
      if (!active.current) return;
      setResults([]);
      setError(
        caught instanceof Error ? caught.message : "No se pudo buscar en IBKR",
      );
    } finally {
      if (active.current) setLoading(false);
    }
  };
  const items = results ?? trading.instruments;
  return (
    <View style={ui.page}>
      <Header
        title="Mercado"
        right={
          trading.status === "connected" ? (
            <IconButton
              icon={RefreshCw}
              label="Actualizar precios"
              onPress={() => void trading.refreshQuotes()}
            />
          ) : undefined
        }
      />
      {trading.status !== "connected" ? (
        <ConnectionPrompt connect={connect} />
      ) : (
        <>
          <Txt size={12} color={colors.muted}>
            Acciones y ETFs · IBKR
          </Txt>
          <Segments
            values={["Ticker", "Nombre"]}
            value={searchType}
            onChange={setSearchType}
          />
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={
              searchType === "Ticker" ? "Buscar ticker…" : "Buscar empresa…"
            }
          />
          <PrimaryButton
            title={loading ? "Buscando…" : "Buscar"}
            disabled={!query.trim() || loading}
            onPress={() => void search()}
          />
          {error && (
            <Txt size={12} color={colors.red} style={{ marginVertical: 16 }}>
              {error}
            </Txt>
          )}
          {trading.quoteError && (
            <Txt size={12} color={colors.red} style={{ marginVertical: 16 }}>
              {trading.quoteError} · Última cotización disponible.
            </Txt>
          )}
          <View style={{ marginTop: 16 }}>
            {items.slice(0, 25).map((item) => (
              <QuoteRow key={item.conid} item={item} open={open} />
            ))}
          </View>
          {!loading && !items.length && (
            <Txt
              color={colors.muted}
              style={{ textAlign: "center", padding: 24 }}
            >
              {results
                ? "Sin resultados en IBKR"
                : "Buscá un ticker o una empresa para explorar el mercado."}
            </Txt>
          )}
        </>
      )}
    </View>
  );
}
function InstrumentDetail({
  conid,
  symbol,
  back,
  connect,
}: {
  conid: string;
  symbol: string;
  back: () => void;
  connect: () => void;
}) {
  const { colors } = usePrototype(),
    trading = useTrading(),
    [range, setRange] = useState("1D");
  const [info, setInfo] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState<string | null>(null);
  const remembered = trading.contracts[conid],
    quote = trading.snapshots[conid];
  const { remember, watch, status } = trading;
  useEffect(() => {
    if (status !== "connected" || !/^\d+$/.test(conid)) return;
    let cancelled = false;
    fetchContractInfo(conid)
      .then((raw) => {
        if (cancelled) return;
        setInfo(raw);
        const item: TradingInstrument = {
          conid,
          symbol: text(raw.symbol ?? raw.local_symbol) || symbol,
          name: text(raw.company_name ?? raw.companyName) || symbol,
          assetClass: text(raw.instrument_type),
          raw,
        };
        remember([item]);
        watch([item]);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar el contrato",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [conid, symbol, status, remember, watch]);
  const currency = text(info?.currency),
    title = remembered?.symbol || quote?.symbol || symbol;
  return (
    <View style={ui.page}>
      <Header
        title={title || "Instrumento"}
        back={back}
        right={<StockLogo symbol={title || ""} size={28} />}
      />
      {status !== "connected" ? (
        <ConnectionPrompt connect={connect} />
      ) : !/^\d+$/.test(conid) ? (
        <Txt color={colors.muted}>
          Seleccioná el contrato desde Mercado para consultar información de
          IBKR.
        </Txt>
      ) : (
        <>
          <Txt size={12} color={colors.muted}>
            {remembered?.name || quote?.companyName || ""}
          </Txt>
          <Txt size={30} weight={800}>
            {currency ? currency + " " : ""}
            {price(quote?.lastPrice)}
          </Txt>
          <Txt
            weight={600}
            color={
              quote?.change === undefined
                ? colors.muted
                : quote.change >= 0
                  ? colors.green
                  : colors.red
            }
          >
            {signed(quote?.change)} ({signed(quote?.changePercent, true)})
          </Txt>
          <QuoteState quote={quote} />
          {error && (
            <Txt size={12} color={colors.red}>
              {error}
            </Txt>
          )}
          {trading.quoteError && (
            <Txt size={12} color={colors.red}>
              {trading.quoteError} · Última cotización disponible.
            </Txt>
          )}
          <HistoryChart key={conid + range} conid={conid} range={range} />
          <Segments
            values={Object.keys(historyQueries)}
            value={range}
            onChange={setRange}
            small
          />
          <View style={{ marginTop: 24 }}>
            <Txt weight={600} style={{ marginBottom: 12 }}>
              Datos del mercado
            </Txt>
            <Section style={{ paddingHorizontal: 16 }}>
              {[
                ["Bid", price(quote?.bidPrice)],
                ["Ask", price(quote?.askPrice)],
                ["Apertura", price(quote?.open)],
                ["Máximo diario", price(quote?.high)],
                ["Mínimo diario", price(quote?.low)],
                ["Volumen", quote?.volume?.toLocaleString("en-US") || "—"],
                [
                  "Cap. mercado",
                  quote?.marketCap?.toLocaleString("en-US", {
                    notation: "compact",
                  }) || "—",
                ],
                ["P/E", price(quote?.peRatio)],
                [
                  "Dividendo",
                  quote?.dividendYield === undefined
                    ? "—"
                    : price(quote.dividendYield) + "%",
                ],
                ["Máximo 52 semanas", price(quote?.yearHigh)],
                ["Mínimo 52 semanas", price(quote?.yearLow)],
                ["Moneda", currency || "—"],
                [
                  "Exchange",
                  quote?.listingExchange || text(info?.exchange) || "—",
                ],
              ].map(([label, value]) => (
                <KeyValue key={label} label={label} value={value} />
              ))}
            </Section>
          </View>
          <Txt size={11} color={colors.muted} style={{ marginTop: 16 }}>
            Los campos no disponibles se muestran como —. Operaciones y
            portafolio se incorporarán en una próxima etapa.
          </Txt>
        </>
      )}
    </View>
  );
}
function HistoryChart({ conid, range }: { conid: string; range: string }) {
  const { colors } = usePrototype();
  const [bars, setBars] = useState<HistoricalBar[] | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const query = historyQueries[range];
    fetchHistoricalMarketData(conid, query.period, query.bar)
      .then((bars) => {
        if (!cancelled) setBars(bars);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar el gráfico",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [conid, range]);
  const labels =
    bars && bars.length
      ? [bars[0], bars[Math.floor(bars.length / 2)], bars[bars.length - 1]].map(
          (bar) =>
            bar.timestamp
              ? range === "1D"
                ? new Date(bar.timestamp).toLocaleTimeString("es", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : new Date(bar.timestamp).toLocaleDateString("es", {
                    month: "short",
                    day: "numeric",
                  })
              : "",
        )
      : [];
  return (
    <View style={{ marginVertical: 20, minHeight: 200 }}>
      {error ? (
        <Txt color={colors.red} size={12}>
          {error}
        </Txt>
      ) : !bars ? (
        <ActivityIndicator color={colors.primary} style={{ margin: 64 }} />
      ) : bars.length < 2 ? (
        <Txt
          color={colors.muted}
          style={{ marginVertical: 64, textAlign: "center" }}
        >
          IBKR no devolvió suficientes barras para este período.
        </Txt>
      ) : (
        <>
          <Chart
            values={bars.map((bar) => bar.close)}
            labels={labels}
            height={170}
            grid
            color={
              bars[bars.length - 1].close >= bars[0].close
                ? colors.green
                : colors.red
            }
          />
          <Txt size={10} color={colors.muted}>
            Histórico IBKR · {range} · Hora local
          </Txt>
        </>
      )}
    </View>
  );
}
function More({ connect }: { connect: () => void }) {
  const { colors, isDark, setDark } = usePrototype(),
    trading = useTrading();
  return (
    <View style={ui.page}>
      <Header title="Más" />
      <Section style={{ paddingHorizontal: 16, marginBottom: 20 }}>
        <KeyValue label="Fuente de datos" value="IBKR Trading API" />
        <KeyValue
          label="Estado"
          value={
            trading.status === "connected"
              ? "Conectado"
              : trading.status === "connecting"
                ? "Conectando"
                : "Desconectado"
          }
        />
        {trading.username && (
          <KeyValue label="Usuario" value={trading.username} />
        )}
        {trading.accounts && (
          <KeyValue
            label="Cuenta"
            value={
              trading.accounts.aliases[trading.accounts.selectedAccount] ||
              trading.accounts.selectedAccount
            }
          />
        )}
      </Section>
      <Section>
        <View style={[ui.row, { padding: 16, gap: 12 }]}>
          <Sun color={colors.accent} size={20} />
          <Txt style={{ flex: 1 }}>Tema oscuro</Txt>
          <Button
            role="switch"
            checked={isDark}
            label="Tema oscuro"
            onPress={() => setDark(!isDark)}
            style={{ minHeight: 40, justifyContent: "center" }}
          >
            <View
              style={{
                width: 44,
                height: 24,
                padding: 2,
                backgroundColor: isDark ? colors.accent : "#d1d5db",
                borderRadius: 12,
                alignItems: isDark ? "flex-end" : "flex-start",
              }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: "#fff",
                }}
              />
            </View>
          </Button>
        </View>
        {trading.status === "connected" ? (
          <MenuRow
            icon={LogOut}
            label="Desconectar IBKR"
            onPress={() => void trading.disconnect()}
          />
        ) : (
          <MenuRow label="Conectar IBKR" onPress={connect} />
        )}
      </Section>
      {trading.error && (
        <Txt size={12} color={colors.red} style={{ marginTop: 16 }}>
          {trading.error}
        </Txt>
      )}
    </View>
  );
}
