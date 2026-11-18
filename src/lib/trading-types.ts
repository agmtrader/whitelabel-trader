export type Amount = {
  value: number | null;
  currency: string | null;
  providerUpdatedAt: number | null;
};
export type Position = {
  conid: string;
  symbol: string;
  name: string;
  assetClass: string;
  currency: string | null;
  quantity: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  averageCost: number | null;
  unrealizedPnl: number | null;
  realizedPnlToday: number | null;
  tradableAsset: boolean;
};
export type Portfolio = {
  accountId: string;
  baseCurrency: string | null;
  receivedAt: number;
  errors: string[];
  summary: {
    netLiquidation: Amount;
    availableFunds: Amount;
    buyingPower: Amount;
    totalCash: Amount;
  } | null;
  cash:
    | {
        currency: string;
        balance: number | null;
        settled: number | null;
        providerUpdatedAt: number | null;
      }[]
    | null;
  positions: Position[] | null;
};
export type OrderTicket = {
  conid: number;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MKT" | "LMT";
  price?: number;
};
export type OrderState =
  | "previewed"
  | "submitting"
  | "warning"
  | "acknowledged"
  | "partial_fill"
  | "filled"
  | "cancel_pending"
  | "cancelled"
  | "declined"
  | "rejected"
  | "unknown";
export type OrderIntent = {
  writesEnabled?: boolean;
  id: string;
  reference: string;
  kind: "submit" | "modify" | "cancel";
  state: OrderState;
  ticket?: OrderTicket;
  orderId: string | null;
  currency?: string;
  symbol: string;
  estimates?: {
    amount: Record<string, string | null>;
    equity: Record<string, string | null>;
    initial: Record<string, string | null>;
    maintenance: Record<string, string | null>;
    warning: string | null;
  };
  quote?: {
    last: string | null;
    availability: string | null;
    providerUpdatedAt: number | null;
    receivedAt: number;
  };
  previewReceivedAt?: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  warningVersion?: number;
  replyUntil?: number;
  messages?: string[];
  brokerStatus?: string;
  filled?: number | null;
  remaining?: number | null;
  averagePrice?: number | null;
};
export type BrokerOrder = {
  orderId: string;
  reference: string | null;
  conid: number | null;
  symbol: string;
  side: string;
  status: string;
  quantity: number | null;
  filled: number | null;
  remaining: number | null;
  averagePrice: number | null;
  orderType: string;
  tif: string;
  price: number | null;
  assetClass: string;
  outsideRTH: boolean | null;
  canManage: boolean;
};
export type Execution = {
  executionId: string;
  orderId: string | null;
  reference: string | null;
  symbol: string;
  quantity: number | null;
  price: number | null;
  commission: string | null;
  commissionCurrency: string | null;
  time: string | null;
  providerUpdatedAt: number | null;
};
export type OrderActivity = {
  errors?: string[];
  intents: OrderIntent[];
  orders: BrokerOrder[] | null;
  executions: Execution[] | null;
  receivedAt: number;
  executionsReceivedAt: number | null;
  writesEnabled: boolean;
};
