import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type AccountsResponse,
  APIError,
  type ContractInfo,
  fetchBrokerageAccounts,
  fetchContractInfo,
  fetchHistoricalMarketData,
  fetchMarketSnapshots,
  fetchOpenOrders,
  fetchWatchlistDetail,
  fetchWatchlists,
  loginToBrokerage,
  logoutOfBrokerage,
  type MarketSnapshot,
  type OpenOrder,
  searchSecurities,
  type SecuritySearchResult,
  type WatchlistDetail,
  type WatchlistInstrument,
  type WatchlistSummary,
} from '@/lib/api';

type AppTab = 'home' | 'watchlist' | 'search' | 'activity' | 'account';
type RangeKey = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';

type QuoteInstrument = {
  conid: string;
  symbol: string;
  name: string;
  description?: string;
  assetClass?: string;
};

type HistoryPoint = {
  close: number;
};

const RANGE_OPTIONS: RangeKey[] = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

const HISTORY_QUERY: Record<RangeKey, { period: string; bar: string }> = {
  '1D': { period: '1d', bar: '5min' },
  '1W': { period: '1w', bar: '1h' },
  '1M': { period: '1m', bar: '1d' },
  '3M': { period: '3m', bar: '1d' },
  '1Y': { period: '1y', bar: '1w' },
  ALL: { period: '1y', bar: '1d' },
};

export default function TraderAppScreen() {
  const [credential, setCredential] = useState('');
  const [accountsInfo, setAccountsInfo] = useState<AccountsResponse | null>(null);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<QuoteInstrument | null>(null);
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [watchlistDetail, setWatchlistDetail] = useState<WatchlistDetail | null>(null);
  const [snapshotsByConid, setSnapshotsByConid] = useState<Record<string, MarketSnapshot>>({});
  const [featuredHistory, setFeaturedHistory] = useState<HistoryPoint[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<HistoryPoint[]>([]);
  const [selectedContract, setSelectedContract] = useState<ContractInfo | null>(null);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SecuritySearchResult[]>([]);
  const [homeRange, setHomeRange] = useState<RangeKey>('1D');
  const [positionRange, setPositionRange] = useState<RangeKey>('1D');
  const [isLoading, setIsLoading] = useState(false);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [isPositionLoading, setIsPositionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAlias = useMemo(() => {
    if (!accountsInfo) {
      return '';
    }

    return accountsInfo.aliases[accountsInfo.selectedAccount] || accountsInfo.selectedAccount;
  }, [accountsInfo]);

  const featuredInstrument = useMemo(
    () => watchlistDetail?.instruments?.[0] ?? null,
    [watchlistDetail]
  );

  const featuredSnapshot = featuredInstrument ? snapshotsByConid[featuredInstrument.conid] : undefined;
  const selectedSnapshot = selectedInstrument ? snapshotsByConid[selectedInstrument.conid] : undefined;

  async function hydrateWatchlist(watchlistId: string) {
    const detail = await fetchWatchlistDetail(watchlistId);
    setWatchlistDetail(detail);

    if (detail.instruments.length === 0) {
      setSnapshotsByConid({});
      return detail;
    }

    const snapshots = await fetchMarketSnapshots(detail.instruments.map((item) => item.conid));
    setSnapshotsByConid((current) => {
      const next = { ...current };
      for (const snapshot of snapshots) {
        next[snapshot.conid] = snapshot;
      }
      return next;
    });

    return detail;
  }

  async function loadDashboard(accounts: AccountsResponse) {
    setIsDashboardLoading(true);
    setError(null);

    try {
      const [watchlistPayload, ordersPayload] = await Promise.all([
        fetchWatchlists(),
        fetchOpenOrders(),
      ]);

      setWatchlists(watchlistPayload);
      setOpenOrders(ordersPayload);

      if (watchlistPayload.length > 0) {
        const initialWatchlistId = watchlistPayload[0].id;
        setSelectedWatchlistId(initialWatchlistId);
        const detail = await hydrateWatchlist(initialWatchlistId);
        if (detail.instruments.length > 0) {
          setSelectedInstrument(null);
        }
      } else {
        setSelectedWatchlistId(null);
        setWatchlistDetail(null);
        setSnapshotsByConid({});
      }

      setActiveTab('home');
      return accounts;
    } catch (caughtError) {
      const message =
        caughtError instanceof APIError || caughtError instanceof Error
          ? caughtError.message
          : 'Unknown error';
      setError(message);
      throw caughtError;
    } finally {
      setIsDashboardLoading(false);
    }
  }

  async function handleLogin() {
    const trimmedCredential = credential.trim();
    if (!trimmedCredential || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ip = await loginToBrokerage(trimmedCredential);
      const accounts = await fetchBrokerageAccounts();
      setPublicIp(ip);
      setAccountsInfo(accounts);
      await loadDashboard(accounts);
    } catch (caughtError) {
      const message =
        caughtError instanceof APIError || caughtError instanceof Error
          ? caughtError.message
          : 'Unknown error';
      setError(message);
      setAccountsInfo(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefreshSession() {
    if (!accountsInfo || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const refreshedAccounts = await fetchBrokerageAccounts();
      setAccountsInfo(refreshedAccounts);
      await loadDashboard(refreshedAccounts);
    } catch (caughtError) {
      const message =
        caughtError instanceof APIError || caughtError instanceof Error
          ? caughtError.message
          : 'Unknown error';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await logoutOfBrokerage();
      setAccountsInfo(null);
      setPublicIp(null);
      setSelectedInstrument(null);
      setWatchlists([]);
      setWatchlistDetail(null);
      setSnapshotsByConid({});
      setFeaturedHistory([]);
      setSelectedHistory([]);
      setSelectedContract(null);
      setOpenOrders([]);
      setSearchResults([]);
      setSearchQuery('');
      setCredential('');
      setActiveTab('home');
    } catch (caughtError) {
      const message =
        caughtError instanceof APIError || caughtError instanceof Error
          ? caughtError.message
          : 'Unknown error';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectWatchlist(watchlistId: string) {
    if (watchlistId === selectedWatchlistId || isDashboardLoading) {
      return;
    }

    setSelectedWatchlistId(watchlistId);
    setSelectedInstrument(null);
    setSelectedHistory([]);
    setSelectedContract(null);

    try {
      await hydrateWatchlist(watchlistId);
    } catch (caughtError) {
      const message =
        caughtError instanceof APIError || caughtError instanceof Error
          ? caughtError.message
          : 'Unknown error';
      setError(message);
    }
  }

  async function handleSearch() {
    const trimmed = searchQuery.trim();
    if (!trimmed || isSearchLoading) {
      return;
    }

    setIsSearchLoading(true);
    setError(null);

    try {
      const results = await searchSecurities(trimmed, 'STK');
      setSearchResults(results);
    } catch (caughtError) {
      const message =
        caughtError instanceof APIError || caughtError instanceof Error
          ? caughtError.message
          : 'Unknown error';
      setError(message);
      setSearchResults([]);
    } finally {
      setIsSearchLoading(false);
    }
  }

  function openInstrument(instrument: QuoteInstrument) {
    setSelectedInstrument(instrument);
    setPositionRange('1D');
  }

  useEffect(() => {
    if (!featuredInstrument) {
      setFeaturedHistory([]);
      return;
    }

    const instrument = featuredInstrument;
    let cancelled = false;

    async function run() {
      try {
        const query = HISTORY_QUERY[homeRange];
        const history = await fetchHistoricalMarketData(instrument.conid, query.period, query.bar);
        if (!cancelled) {
          setFeaturedHistory(history);
        }
      } catch {
        if (!cancelled) {
          setFeaturedHistory([]);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [featuredInstrument?.conid, homeRange]);

  useEffect(() => {
    if (!selectedInstrument) {
      setSelectedHistory([]);
      setSelectedContract(null);
      return;
    }

    const instrument = selectedInstrument;
    let cancelled = false;
    setIsPositionLoading(true);

    async function run() {
      try {
        const query = HISTORY_QUERY[positionRange];
        const [history, contract, freshSnapshot] = await Promise.all([
          fetchHistoricalMarketData(instrument.conid, query.period, query.bar),
          fetchContractInfo(instrument.conid),
          fetchMarketSnapshots([instrument.conid]),
        ]);

        if (!cancelled) {
          setSelectedHistory(history);
          setSelectedContract(contract);
          if (freshSnapshot[0]) {
            setSnapshotsByConid((current) => ({
              ...current,
              [freshSnapshot[0].conid]: freshSnapshot[0],
            }));
          }
        }
      } catch (caughtError) {
        if (!cancelled) {
          const message =
            caughtError instanceof APIError || caughtError instanceof Error
              ? caughtError.message
              : 'Unknown error';
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsPositionLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedInstrument?.conid, positionRange]);

  if (!accountsInfo) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.loginScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.loginShell}>
              <View style={styles.loginHeader}>
                <View style={styles.brandRow}>
                  <View style={styles.brandMark}>
                    <View style={[styles.brandStroke, styles.brandStrokeLeft]} />
                    <View style={[styles.brandStroke, styles.brandStrokeCenter]} />
                    <View style={[styles.brandStroke, styles.brandStrokeRight]} />
                  </View>
                  <Text style={styles.brandText}>AGM Trader</Text>
                </View>
                <Text style={styles.loginTitle}>Live IBKR session</Text>
                <Text style={styles.loginSubtitle}>
                  Sign in to load your real watchlists, quotes, charts, and open orders through AGM API.
                </Text>
              </View>

              <View style={styles.loginCard}>
                <Text style={styles.inputLabel}>IBKR credential</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  onChangeText={setCredential}
                  placeholder="Username or credential"
                  placeholderTextColor="#94A3B8"
                  style={styles.loginInput}
                  value={credential}
                />
                <Pressable
                  disabled={isLoading || credential.trim().length === 0}
                  onPress={handleLogin}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (pressed || isLoading || credential.trim().length === 0) && styles.buttonPressed,
                  ]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Login</Text>
                  )}
                </Pressable>
                {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (selectedInstrument) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.flex}>
          <PositionScreen
            activeTab={activeTab}
            contract={selectedContract}
            history={selectedHistory}
            isLoading={isPositionLoading}
            onBack={() => setSelectedInstrument(null)}
            onTabChange={setActiveTab}
            selectedInstrument={selectedInstrument}
            selectedRange={positionRange}
            setSelectedRange={setPositionRange}
            snapshot={selectedSnapshot}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.flex}>
        {activeTab === 'home' ? (
          <HomeScreen
            featuredHistory={featuredHistory}
            featuredInstrument={featuredInstrument}
            featuredSnapshot={featuredSnapshot}
            isLoading={isDashboardLoading}
            onOpenInstrument={openInstrument}
            onSelectWatchlist={handleSelectWatchlist}
            selectedAlias={selectedAlias}
            selectedRange={homeRange}
            selectedWatchlistId={selectedWatchlistId}
            setSelectedRange={setHomeRange}
            watchlistDetail={watchlistDetail}
            watchlists={watchlists}
          />
        ) : null}

        {activeTab === 'watchlist' ? (
          <WatchlistScreen
            isLoading={isDashboardLoading}
            onOpenInstrument={openInstrument}
            onSelectWatchlist={handleSelectWatchlist}
            selectedWatchlistId={selectedWatchlistId}
            snapshotsByConid={snapshotsByConid}
            watchlistDetail={watchlistDetail}
            watchlists={watchlists}
          />
        ) : null}

        {activeTab === 'search' ? (
          <SearchScreen
            isLoading={isSearchLoading}
            onOpenInstrument={(result) =>
              openInstrument({
                conid: result.conid,
                symbol: result.symbol,
                name: result.companyName || result.description,
                description: result.description,
                assetClass: result.secType,
              })
            }
            onSearch={handleSearch}
            query={searchQuery}
            results={searchResults}
            setQuery={setSearchQuery}
          />
        ) : null}

        {activeTab === 'activity' ? (
          <ActivityScreen isLoading={isDashboardLoading} orders={openOrders} />
        ) : null}

        {activeTab === 'account' ? (
          <AccountScreen
            accountsInfo={accountsInfo}
            isLoading={isLoading}
            onLogout={handleLogout}
            onRefresh={handleRefreshSession}
            openOrders={openOrders}
            publicIp={publicIp}
            selectedAlias={selectedAlias}
            watchlists={watchlists}
          />
        ) : null}

        <BottomNav activeTab={activeTab} onChange={setActiveTab} />
      </View>
    </SafeAreaView>
  );
}

function HomeScreen({
  featuredHistory,
  featuredInstrument,
  featuredSnapshot,
  isLoading,
  onOpenInstrument,
  onSelectWatchlist,
  selectedAlias,
  selectedRange,
  selectedWatchlistId,
  setSelectedRange,
  watchlistDetail,
  watchlists,
}: {
  featuredHistory: HistoryPoint[];
  featuredInstrument: WatchlistInstrument | null;
  featuredSnapshot?: MarketSnapshot;
  isLoading: boolean;
  onOpenInstrument: (instrument: QuoteInstrument) => void;
  onSelectWatchlist: (watchlistId: string) => void;
  selectedAlias: string;
  selectedRange: RangeKey;
  selectedWatchlistId: string | null;
  setSelectedRange: (range: RangeKey) => void;
  watchlistDetail: WatchlistDetail | null;
  watchlists: WatchlistSummary[];
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <HeaderBar subtitle={selectedAlias} title="AGM Trader" right={<CircleButton label="◎" />} />

      <View style={styles.heroSection}>
        <View style={styles.flex}>
          <Text style={styles.heroLabel}>
            {featuredInstrument ? featuredInstrument.symbol : 'No featured instrument'}
          </Text>
          <Text style={styles.heroValue}>
            {formatPrice(featuredSnapshot?.lastPrice)}
          </Text>
          <Text
            style={[
              styles.heroGain,
              (featuredSnapshot?.change ?? 0) < 0 && styles.heroLoss,
            ]}
          >
            {formatChange(featuredSnapshot?.change, featuredSnapshot?.changePercent)}
          </Text>
        </View>
        <View style={styles.freeStockPill}>
          <Text style={styles.freeStockText}>
            {watchlistDetail ? watchlistDetail.name : 'No watchlist'}
          </Text>
        </View>
      </View>

      <LineChart values={featuredHistory.map((item) => item.close)} height={150} />
      <RangeSelector selected={selectedRange} onSelect={setSelectedRange} />

      <InfoCard>
        <Text style={styles.infoCardTitle}>Watchlists</Text>
        {watchlists.length === 0 ? (
          <Text style={styles.emptyText}>No watchlists returned by the current SSO session.</Text>
        ) : (
          watchlists.slice(0, 3).map((watchlist, index) => (
            <View key={watchlist.id}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => onSelectWatchlist(watchlist.id)}
                style={styles.accountListRow}
              >
                <View>
                  <Text style={styles.accountListTitle}>{watchlist.name}</Text>
                  <Text style={styles.accountListSubtitle}>Watchlist ID: {watchlist.id}</Text>
                </View>
                {watchlist.id === selectedWatchlistId ? <View style={styles.activeDot} /> : null}
              </Pressable>
            </View>
          ))
        )}
      </InfoCard>

      <SectionTitle action="See all" title="Live instruments" />
      {isLoading ? (
        <LoadingCard label="Loading watchlist instruments..." />
      ) : watchlistDetail?.instruments.length ? (
        watchlistDetail.instruments.slice(0, 4).map((instrument) => (
          <StockRow
            key={instrument.conid}
            instrument={instrument}
            onPress={() =>
              onOpenInstrument({
                conid: instrument.conid,
                symbol: instrument.symbol,
                name: instrument.name,
                description: instrument.description,
                assetClass: instrument.assetClass,
              })
            }
            snapshot={featuredSnapshot?.conid === instrument.conid ? featuredSnapshot : undefined}
          />
        ))
      ) : (
        <EmptyCard label="No instruments available for the selected watchlist." />
      )}
    </ScrollView>
  );
}

function WatchlistScreen({
  isLoading,
  onOpenInstrument,
  onSelectWatchlist,
  selectedWatchlistId,
  snapshotsByConid,
  watchlistDetail,
  watchlists,
}: {
  isLoading: boolean;
  onOpenInstrument: (instrument: QuoteInstrument) => void;
  onSelectWatchlist: (watchlistId: string) => void;
  selectedWatchlistId: string | null;
  snapshotsByConid: Record<string, MarketSnapshot>;
  watchlistDetail: WatchlistDetail | null;
  watchlists: WatchlistSummary[];
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <HeaderBar title="Watchlists" right={<CircleButton label="⌕" />} />

      <SectionTitle title="Available lists" />
      <InfoCard>
        {watchlists.length === 0 ? (
          <Text style={styles.emptyText}>No watchlists returned by the API.</Text>
        ) : (
          watchlists.map((watchlist, index) => (
            <View key={watchlist.id}>
              {index > 0 ? <Divider /> : null}
              <Pressable onPress={() => onSelectWatchlist(watchlist.id)} style={styles.accountListRow}>
                <View>
                  <Text style={styles.accountListTitle}>{watchlist.name}</Text>
                  <Text style={styles.accountListSubtitle}>ID {watchlist.id}</Text>
                </View>
                {watchlist.id === selectedWatchlistId ? <View style={styles.activeDot} /> : null}
              </Pressable>
            </View>
          ))
        )}
      </InfoCard>

      <SectionTitle title={watchlistDetail?.name || 'Selected watchlist'} />
      {isLoading ? (
        <LoadingCard label="Loading watchlist..." />
      ) : watchlistDetail?.instruments.length ? (
        watchlistDetail.instruments.map((instrument) => (
          <StockRow
            key={instrument.conid}
            instrument={instrument}
            onPress={() =>
              onOpenInstrument({
                conid: instrument.conid,
                symbol: instrument.symbol,
                name: instrument.name,
                description: instrument.description,
                assetClass: instrument.assetClass,
              })
            }
            snapshot={snapshotsByConid[instrument.conid]}
          />
        ))
      ) : (
        <EmptyCard label="This watchlist does not contain instruments." />
      )}
    </ScrollView>
  );
}

function SearchScreen({
  isLoading,
  onOpenInstrument,
  onSearch,
  query,
  results,
  setQuery,
}: {
  isLoading: boolean;
  onOpenInstrument: (result: SecuritySearchResult) => void;
  onSearch: () => void;
  query: string;
  results: SecuritySearchResult[];
  setQuery: (value: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <HeaderBar title="Search" />
      <View style={styles.searchRow}>
        <TextInput
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={setQuery}
          onSubmitEditing={onSearch}
          placeholder="Search symbol"
          placeholderTextColor="#94A3B8"
          style={styles.searchInput}
          value={query}
        />
        <Pressable
          onPress={onSearch}
          style={({ pressed }) => [styles.searchButton, pressed && styles.buttonPressed]}
        >
          {isLoading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>Go</Text>
          )}
        </Pressable>
      </View>

      <SectionTitle title="Results" />
      {results.length ? (
        results.map((result) => (
          <Pressable
            key={`${result.conid}-${result.symbol}`}
            onPress={() => onOpenInstrument(result)}
            style={styles.searchResultCard}
          >
            <Text style={styles.stockSymbol}>{result.symbol}</Text>
            <Text style={styles.stockName}>{result.companyName || result.description}</Text>
            <Text style={styles.accountListSubtitle}>
              {result.secType || 'Unknown type'} · conid {result.conid}
            </Text>
          </Pressable>
        ))
      ) : (
        <EmptyCard label="Search results will show here." />
      )}
    </ScrollView>
  );
}

function ActivityScreen({
  isLoading,
  orders,
}: {
  isLoading: boolean;
  orders: OpenOrder[];
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <HeaderBar title="Activity" />
      <SectionTitle title="Open orders" />
      {isLoading ? (
        <LoadingCard label="Loading open orders..." />
      ) : orders.length ? (
        <InfoCard>
          {orders.map((order, index) => (
            <View key={order.orderId}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.orderRow}>
                <View style={styles.flex}>
                  <Text style={styles.accountListTitle}>{order.ticker || 'Unknown symbol'}</Text>
                  <Text style={styles.accountListSubtitle}>
                    {order.side || 'N/A'} · {order.status || 'Unknown status'}
                  </Text>
                </View>
                <View style={styles.orderMeta}>
                  <Text style={styles.accountListTitle}>{order.size || '-'}</Text>
                  <Text style={styles.accountListSubtitle}>{order.price || '-'}</Text>
                </View>
              </View>
            </View>
          ))}
        </InfoCard>
      ) : (
        <EmptyCard label="No open orders returned by the API." />
      )}
    </ScrollView>
  );
}

function AccountScreen({
  accountsInfo,
  isLoading,
  onLogout,
  onRefresh,
  openOrders,
  publicIp,
  selectedAlias,
  watchlists,
}: {
  accountsInfo: AccountsResponse;
  isLoading: boolean;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
  openOrders: OpenOrder[];
  publicIp: string | null;
  selectedAlias: string;
  watchlists: WatchlistSummary[];
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <HeaderBar title="Account" />

      <InfoCard>
        <Text style={styles.accountBigTitle}>{selectedAlias}</Text>
        <Text style={styles.accountPanelSubtitle}>{accountsInfo.selectedAccount}</Text>
        <Text style={styles.accountPanelMeta}>
          Allowed assets: {accountsInfo.allowFeatures.allowedAssetTypes}
        </Text>
        {publicIp ? <Text style={styles.accountPanelMeta}>IP: {publicIp}</Text> : null}
      </InfoCard>

      <InfoCard>
        <Text style={styles.accountSectionTitle}>Session summary</Text>
        <RowLabelValue label="Accounts" value={String(accountsInfo.accounts.length)} />
        <Divider />
        <RowLabelValue label="Watchlists" value={String(watchlists.length)} />
        <Divider />
        <RowLabelValue label="Open orders" value={String(openOrders.length)} />
      </InfoCard>

      <View style={styles.buttonRow}>
        <Pressable
          disabled={isLoading}
          onPress={onRefresh}
          style={({ pressed }) => [
            styles.secondaryButton,
            (pressed || isLoading) && styles.buttonPressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </Pressable>
        <Pressable
          disabled={isLoading}
          onPress={onLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            (pressed || isLoading) && styles.buttonPressed,
          ]}
        >
          {isLoading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>Logout</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function PositionScreen({
  activeTab,
  contract,
  history,
  isLoading,
  onBack,
  onTabChange,
  selectedInstrument,
  selectedRange,
  setSelectedRange,
  snapshot,
}: {
  activeTab: AppTab;
  contract: ContractInfo | null;
  history: HistoryPoint[];
  isLoading: boolean;
  onBack: () => void;
  onTabChange: (tab: AppTab) => void;
  selectedInstrument: QuoteInstrument;
  selectedRange: RangeKey;
  setSelectedRange: (range: RangeKey) => void;
  snapshot?: MarketSnapshot;
}) {
  const contractEntries = useMemo(
    () =>
      Object.entries(contract || {})
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .slice(0, 6),
    [contract]
  );

  return (
    <>
      <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
        <View style={styles.positionTopBar}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
          <View style={styles.positionTopText}>
            <Text style={styles.positionTopTitle}>Instrument</Text>
            <Text style={styles.positionTopSubtitle}>{selectedInstrument.symbol}</Text>
          </View>
          <CircleButton label="⌕" />
        </View>

        <View style={styles.positionCompanyRow}>
          <View style={styles.positionAvatar}>
            <Text style={styles.positionAvatarText}>{selectedInstrument.symbol.charAt(0)}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.positionSymbol}>{selectedInstrument.symbol}</Text>
            <Text style={styles.positionCompany}>{selectedInstrument.name}</Text>
          </View>
        </View>

        <Text style={styles.positionPrice}>{formatPrice(snapshot?.lastPrice)}</Text>
        <Text
          style={[
            styles.positionGain,
            (snapshot?.change ?? 0) < 0 && styles.heroLoss,
          ]}
        >
          {formatChange(snapshot?.change, snapshot?.changePercent)}
        </Text>

        <LineChart values={history.map((item) => item.close)} height={150} />
        <RangeSelector selected={selectedRange} onSelect={setSelectedRange} />

        {isLoading ? <LoadingCard label="Loading instrument details..." /> : null}

        <SectionTitle title="Quote" />
        <InfoCard>
          <View style={styles.metricsGrid}>
            <MetricBlock label="Bid" value={formatPrice(snapshot?.bidPrice)} />
            <MetricBlock label="Ask" value={formatPrice(snapshot?.askPrice)} />
            <MetricBlock label="Avg Price" value={formatPrice(snapshot?.avgPrice)} />
            <MetricBlock label="Daily PnL" value={formatSignedPrice(snapshot?.dailyPnl)} />
          </View>
          <Divider />
          <RowLabelValue label="Exchange" value={snapshot?.listingExchange || '—'} />
          <Divider />
          <RowLabelValue label="Asset Class" value={snapshot?.assetClass || selectedInstrument.assetClass || '—'} />
          <Divider />
          <RowLabelValue label="Position" value={snapshot?.formattedPosition || 'Unavailable'} />
        </InfoCard>

        <SectionTitle title="Metadata" />
        <InfoCard>
          {contractEntries.length ? (
            contractEntries.map(([key, value], index) => (
              <View key={key}>
                {index > 0 ? <Divider /> : null}
                <RowLabelValue label={prettifyKey(key)} value={String(value)} />
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No contract metadata returned by the API.</Text>
          )}
        </InfoCard>
      </ScrollView>

      <BottomNav activeTab={activeTab} onChange={onTabChange} />
    </>
  );
}

function HeaderBar({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.headerBar}>
      <View style={styles.brandRow}>
        <View style={styles.brandMarkSmall}>
          <View style={[styles.brandStrokeSmall, styles.brandStrokeSmallLeft]} />
          <View style={[styles.brandStrokeSmall, styles.brandStrokeSmallCenter]} />
          <View style={[styles.brandStrokeSmall, styles.brandStrokeSmallRight]} />
        </View>
        <View>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {right}
    </View>
  );
}

function CircleButton({ label }: { label: string }) {
  return (
    <View style={styles.circleButton}>
      <Text style={styles.circleButtonText}>{label}</Text>
    </View>
  );
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function EmptyCard({ label }: { label: string }) {
  return (
    <InfoCard>
      <Text style={styles.emptyText}>{label}</Text>
    </InfoCard>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <InfoCard>
      <View style={styles.loadingRow}>
        <ActivityIndicator color="#16A34A" />
        <Text style={styles.emptyText}>{label}</Text>
      </View>
    </InfoCard>
  );
}

function StockRow({
  instrument,
  onPress,
  snapshot,
}: {
  instrument: QuoteInstrument;
  onPress: () => void;
  snapshot?: MarketSnapshot;
}) {
  const changePercent = snapshot?.changePercent ?? 0;
  const positive = changePercent >= 0;

  return (
    <Pressable onPress={onPress} style={styles.stockCard}>
      <View style={[styles.stockAvatar, { backgroundColor: '#16A34A' }]}>
        <Text style={styles.stockAvatarText}>{instrument.symbol.charAt(0)}</Text>
      </View>

      <View style={styles.stockMain}>
        <Text style={styles.stockSymbol}>{instrument.symbol}</Text>
        <Text style={styles.stockName}>{snapshot?.companyName || instrument.name}</Text>
      </View>

      <View style={styles.stockRight}>
        <View style={[styles.stockBadge, positive ? styles.stockBadgeUp : styles.stockBadgeDown]}>
          <Text style={styles.stockBadgeText}>
            {snapshot?.changePercent !== undefined
              ? `${positive ? '+' : ''}${snapshot.changePercent.toFixed(2)}%`
              : '—'}
          </Text>
        </View>
        <Text style={styles.stockPrice}>{formatPrice(snapshot?.lastPrice)}</Text>
      </View>
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function RangeSelector({
  selected,
  onSelect,
}: {
  selected: RangeKey;
  onSelect: (range: RangeKey) => void;
}) {
  return (
    <View style={styles.rangeRow}>
      {RANGE_OPTIONS.map((option) => {
        const isActive = selected === option;
        return (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            style={[styles.rangePill, isActive && styles.rangePillActive]}
          >
            <Text style={[styles.rangeText, isActive && styles.rangeTextActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LineChart({ values, height }: { values: number[]; height: number }) {
  if (!values.length) {
    return (
      <View style={[styles.chartWrap, styles.chartEmpty, { height }]}>
        <Text style={styles.emptyText}>No chart data</Text>
      </View>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  return (
    <View style={[styles.chartWrap, { height }]}>
      <View style={styles.chartBaseline} />
      <View style={styles.chartLineRow}>
        {values.map((value, index) => {
          const ratio = (value - min) / range;
          return (
            <View key={`${value}-${index}`} style={styles.chartColumn}>
              <View
                style={[
                  styles.chartBar,
                  {
                    height: 24 + ratio * (height - 40),
                    opacity: 0.3 + ratio * 0.7,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBlock}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function RowLabelValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricInlineValue}>{value}</Text>
    </View>
  );
}

function BottomNav({
  activeTab,
  onChange,
}: {
  activeTab: AppTab;
  onChange: (tab: AppTab) => void;
}) {
  const items: Array<{ key: AppTab; label: string; icon: string }> = [
    { key: 'home', label: 'Home', icon: '⌂' },
    { key: 'watchlist', label: 'Watchlist', icon: '☆' },
    { key: 'search', label: 'Search', icon: '⌕' },
    { key: 'activity', label: 'Activity', icon: '◔' },
    { key: 'account', label: 'Account', icon: '◎' },
  ];

  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const active = activeTab === item.key;
        return (
          <Pressable key={item.key} onPress={() => onChange(item.key)} style={styles.navItem}>
            <Text style={[styles.navIcon, active && styles.navActive]}>{item.icon}</Text>
            <Text style={[styles.navLabel, active && styles.navActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function formatPrice(value?: number) {
  return value === undefined ? '—' : `$${value.toFixed(2)}`;
}

function formatSignedPrice(value?: number) {
  if (value === undefined) {
    return '—';
  }

  return `${value >= 0 ? '+' : ''}$${Math.abs(value).toFixed(2)}`;
}

function formatChange(change?: number, changePercent?: number) {
  if (change === undefined || changePercent === undefined) {
    return 'No change data';
  }

  const priceText = `${change >= 0 ? '+' : ''}$${Math.abs(change).toFixed(2)}`;
  const percentText = `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
  return `${priceText} (${percentText}) Today`;
}

function prettifyKey(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  flex: {
    flex: 1,
  },
  loginScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F7FAF7',
  },
  loginShell: {
    gap: 18,
  },
  loginHeader: {
    gap: 12,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  brandMark: {
    height: 28,
    position: 'relative',
    width: 34,
  },
  brandStroke: {
    borderBottomWidth: 4,
    borderColor: '#10B981',
    borderLeftWidth: 4,
    height: 18,
    position: 'absolute',
    transform: [{ skewX: '-22deg' }],
    width: 12,
  },
  brandStrokeLeft: {
    left: 0,
    top: 5,
  },
  brandStrokeCenter: {
    left: 10,
    top: 0,
  },
  brandStrokeRight: {
    left: 18,
    top: 5,
  },
  brandText: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '700',
  },
  loginTitle: {
    color: '#111827',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  loginSubtitle: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
  },
  loginCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0EC',
    borderRadius: 28,
    borderWidth: 1,
    gap: 14,
    padding: 20,
  },
  inputLabel: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
  },
  loginInput: {
    backgroundColor: '#F8FAF8',
    borderColor: '#E2E8E2',
    borderRadius: 18,
    borderWidth: 1,
    color: '#111827',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 54,
  },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 999,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  searchButton: {
    alignItems: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 18,
    justifyContent: 'center',
    minHeight: 54,
    minWidth: 72,
  },
  buttonPressed: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  errorBanner: {
    color: '#DC2626',
    fontSize: 14,
    lineHeight: 20,
  },
  screenContent: {
    gap: 16,
    paddingBottom: 120,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  headerBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  brandMarkSmall: {
    height: 20,
    position: 'relative',
    width: 24,
  },
  brandStrokeSmall: {
    borderBottomWidth: 3,
    borderColor: '#10B981',
    borderLeftWidth: 3,
    height: 13,
    position: 'absolute',
    transform: [{ skewX: '-20deg' }],
    width: 8,
  },
  brandStrokeSmallLeft: {
    left: 0,
    top: 4,
  },
  brandStrokeSmallCenter: {
    left: 7,
    top: 0,
  },
  brandStrokeSmallRight: {
    left: 13,
    top: 4,
  },
  headerTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  heroSection: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroLabel: {
    color: '#111827',
    fontSize: 22,
    marginBottom: 4,
  },
  heroValue: {
    color: '#111827',
    fontSize: 52,
    fontWeight: '700',
    letterSpacing: -1.2,
  },
  heroGain: {
    color: '#16A34A',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 6,
  },
  heroLoss: {
    color: '#DC2626',
  },
  freeStockPill: {
    backgroundColor: '#EAF9EE',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  freeStockText: {
    color: '#16A34A',
    fontSize: 13,
    fontWeight: '700',
  },
  chartWrap: {
    justifyContent: 'flex-end',
    marginTop: 4,
    position: 'relative',
  },
  chartEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartBaseline: {
    borderColor: '#C9D5CA',
    borderStyle: 'dashed',
    borderTopWidth: 1,
    bottom: 22,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  chartLineRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 6,
    height: '100%',
  },
  chartColumn: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  chartBar: {
    backgroundColor: '#16A34A',
    borderRadius: 999,
    minHeight: 12,
    width: '85%',
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  rangePill: {
    borderRadius: 999,
    minWidth: 38,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  rangePillActive: {
    backgroundColor: '#16A34A',
  },
  rangeText: {
    color: '#16A34A',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  rangeTextActive: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2EE',
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
  },
  infoCardTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 21,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionHeaderText: {
    color: '#111827',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  sectionAction: {
    color: '#16A34A',
    fontSize: 15,
    fontWeight: '700',
  },
  stockCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2EE',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  stockAvatar: {
    alignItems: 'center',
    borderRadius: 999,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  stockAvatarText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  stockMain: {
    flex: 1,
  },
  stockSymbol: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
  },
  stockName: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 2,
  },
  stockRight: {
    alignItems: 'flex-end',
    minWidth: 92,
  },
  stockBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stockBadgeUp: {
    backgroundColor: '#16A34A',
  },
  stockBadgeDown: {
    backgroundColor: '#DC2626',
  },
  stockBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  stockPrice: {
    color: '#111827',
    fontSize: 15,
    marginTop: 8,
  },
  accountBigTitle: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '700',
  },
  accountSectionTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  accountPanelSubtitle: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 4,
  },
  accountPanelMeta: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 8,
  },
  accountListRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  accountListTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '600',
  },
  accountListSubtitle: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 2,
  },
  activeDot: {
    backgroundColor: '#16A34A',
    borderRadius: 999,
    height: 14,
    width: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
  },
  searchInput: {
    backgroundColor: '#F8FAF8',
    borderColor: '#E2E8E2',
    borderRadius: 18,
    borderWidth: 1,
    color: '#111827',
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  searchResultCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2EE',
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  orderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  orderMeta: {
    alignItems: 'flex-end',
  },
  circleButton: {
    alignItems: 'center',
    borderColor: '#16A34A',
    borderRadius: 999,
    borderWidth: 1.5,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  circleButtonText: {
    color: '#16A34A',
    fontSize: 18,
    fontWeight: '600',
  },
  divider: {
    backgroundColor: '#EEF2EE',
    height: 1,
    marginVertical: 14,
    width: '100%',
  },
  positionTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  backButtonText: {
    color: '#16A34A',
    fontSize: 30,
    lineHeight: 32,
  },
  positionTopText: {
    alignItems: 'center',
    flex: 1,
  },
  positionTopTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '700',
  },
  positionTopSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  positionCompanyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginTop: 12,
  },
  positionAvatar: {
    alignItems: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 999,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  positionAvatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  positionSymbol: {
    color: '#111827',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  positionCompany: {
    color: '#64748B',
    fontSize: 15,
  },
  positionPrice: {
    color: '#111827',
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: -1,
    marginTop: 16,
  },
  positionGain: {
    color: '#16A34A',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 6,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 18,
  },
  metricBlock: {
    paddingRight: 10,
    width: '50%',
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 13,
  },
  metricValue: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  metricInlineValue: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
    maxWidth: '55%',
    textAlign: 'right',
  },
  bottomNav: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2EE',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: 20,
    paddingTop: 10,
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
    minWidth: 62,
  },
  navIcon: {
    color: '#94A3B8',
    fontSize: 22,
  },
  navLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
  },
  navActive: {
    color: '#16A34A',
  },
});
