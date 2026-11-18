import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { usePrototype } from "@/features/prototype/context";
import {
  Button,
  Header,
  KeyValue,
  Label,
  MenuRow,
  PrimaryButton,
  Section,
  Txt,
  ui,
} from "@/features/prototype/ui";
import type { Amount } from "@/lib/trading-types";
import { useTrading } from "./context";
import { OrderButtons } from "./orders";

export function money(
  value: number | null | undefined,
  currency?: string | null,
) {
  return value == null
    ? "—"
    : `${currency ? currency + " " : ""}${value.toLocaleString("es-CR", { maximumFractionDigits: 4 })}`;
}

function Balance({ label, field }: { label: string; field?: Amount }) {
  return (
    <View>
      <KeyValue label={label} value={money(field?.value, field?.currency)} />
      {field?.providerUpdatedAt && (
        <Txt size={10}>
          Hora IBKR ·{" "}
          {new Date(field.providerUpdatedAt).toLocaleString("es-CR")}
        </Txt>
      )}
    </View>
  );
}

export function BalanceSummary() {
  const trading = useTrading();
  const { colors } = usePrototype();
  if (trading.status !== "connected") return null;
  return (
    <Section style={{ padding: 16, gap: 8, marginBottom: 16 }}>
      <Label>MI CUENTA</Label>
      {trading.portfolioBusy && <ActivityIndicator color={colors.primary} />}
      {trading.portfolioError && (
        <Txt color={colors.red} size={12}>
          {trading.portfolio ? "Datos anteriores o parciales. " : ""}
          {trading.portfolioError}
        </Txt>
      )}
      <Balance
        label="Valor de la cuenta"
        field={trading.portfolio?.summary?.netLiquidation}
      />
      <Balance
        label="Fondos disponibles"
        field={trading.portfolio?.summary?.availableFunds}
      />
      <Balance
        label="Poder de compra IBKR"
        field={trading.portfolio?.summary?.buyingPower}
      />
      <Balance
        label="Efectivo total en moneda base"
        field={trading.portfolio?.summary?.totalCash}
      />
      {trading.portfolio && (
        <Txt size={10} color={colors.secondary}>
          Recibido ·{" "}
          {new Date(trading.portfolio.receivedAt).toLocaleString("es-CR")}
        </Txt>
      )}
    </Section>
  );
}

export function PortfolioScreen({ connect }: { connect: () => void }) {
  const trading = useTrading();
  const { colors } = usePrototype();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <View style={ui.page}>
      <Header title="Portafolio" />
      {trading.status !== "connected" ? (
        <>
          <Txt>
            Conectá tu cuenta verificada para consultar posiciones, saldos y
            efectivo.
          </Txt>
          <PrimaryButton
            title={trading.signedIn ? "Reconectar IBKR" : "Conectar IBKR"}
            onPress={connect}
          />
        </>
      ) : (
        <>
          <BalanceSummary />
          <PrimaryButton
            title={
              trading.portfolioBusy ? "Actualizando…" : "Actualizar portafolio"
            }
            disabled={trading.portfolioBusy}
            onPress={() => void trading.refreshPortfolio()}
            secondary
          />
          <MenuRow
            label="Actividad y órdenes"
            onPress={() => router.push("/app/activity")}
          />
          <Label>EFECTIVO POR MONEDA</Label>
          {!trading.portfolio?.cash ? (
            <Txt color={colors.secondary}>Efectivo no disponible.</Txt>
          ) : trading.portfolio.cash.length === 0 ? (
            <Txt>IBKR no reportó monedas con efectivo.</Txt>
          ) : (
            trading.portfolio.cash.map((row) => (
              <Section
                key={row.currency}
                style={{ padding: 16, marginBottom: 12 }}
              >
                <KeyValue
                  label={`Saldo ${row.currency}`}
                  value={money(row.balance, row.currency)}
                />
                <KeyValue
                  label="Efectivo liquidado"
                  value={money(row.settled, row.currency)}
                />
                {row.providerUpdatedAt && (
                  <Txt size={10} color={colors.secondary}>
                    Hora IBKR ·{" "}
                    {new Date(row.providerUpdatedAt).toLocaleString("es-CR")}
                  </Txt>
                )}
              </Section>
            ))
          )}
          <Label>POSICIONES</Label>
          {!trading.portfolio?.positions ? (
            <Txt color={colors.secondary}>
              {trading.portfolioBusy
                ? "Cargando posiciones…"
                : "Posiciones no disponibles."}
            </Txt>
          ) : trading.portfolio.positions.length === 0 ? (
            <Txt>IBKR no reportó posiciones en esta cuenta.</Txt>
          ) : (
            trading.portfolio.positions.map((row) => (
              <Section
                key={row.conid}
                style={{ padding: 16, marginBottom: 12, gap: 10 }}
              >
                <Button
                  label={`Detalle de ${row.symbol} · ${row.assetClass}`}
                  onPress={() =>
                    setSelected(selected === row.conid ? null : row.conid)
                  }
                  style={{ minHeight: 44 }}
                >
                  <View style={[ui.row, { justifyContent: "space-between" }]}>
                    <Txt weight={700}>{row.symbol}</Txt>
                    <Txt>{money(row.marketValue, row.currency)}</Txt>
                  </View>
                  <Txt size={12} color={colors.secondary}>
                    {row.name} · {row.assetClass || "Tipo no disponible"}
                  </Txt>
                  <Txt size={12}>{money(row.quantity)} unidades</Txt>
                </Button>
                {selected === row.conid && (
                  <>
                    <KeyValue
                      label="Precio de mercado"
                      value={money(row.marketPrice, row.currency)}
                    />
                    <KeyValue
                      label="Costo medio por unidad × multiplicador"
                      value={money(row.averageCost, row.currency)}
                    />
                    <KeyValue
                      label="P&L no realizado"
                      value={money(row.unrealizedPnl, row.currency)}
                    />
                    <KeyValue
                      label="P&L realizado hoy"
                      value={money(row.realizedPnlToday, row.currency)}
                    />
                    {row.tradableAsset ? (
                      <OrderButtons conid={row.conid} symbol={row.symbol} />
                    ) : (
                      <Txt size={12} color={colors.secondary}>
                        Posición de solo lectura. La entrada de órdenes admite
                        acciones y ETFs.
                      </Txt>
                    )}
                  </>
                )}
              </Section>
            ))
          )}
        </>
      )}
    </View>
  );
}
