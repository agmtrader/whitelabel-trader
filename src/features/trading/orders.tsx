import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { usePrototype } from "@/features/prototype/context";
import {
  Button,
  Header,
  Input,
  KeyValue,
  Label,
  MenuRow,
  PrimaryButton,
  Section,
  Segments,
  Txt,
  ui,
} from "@/features/prototype/ui";
import {
  cancelOrder,
  previewOrder,
  replyToOrder,
  submitOrder,
} from "@/lib/api";
import { marketDelivery } from "@/lib/market-data";
import type {
  BrokerOrder,
  OrderIntent,
  OrderState,
  OrderTicket,
} from "@/lib/trading-types";
import { useTrading } from "./context";

const states: Record<OrderState, string> = {
  previewed: "Revisión",
  submitting: "Enviando",
  warning: "IBKR requiere tu respuesta",
  acknowledged: "Recibida por IBKR",
  partial_fill: "Ejecución parcial",
  filled: "Ejecutada",
  cancel_pending: "Cancelación solicitada",
  cancelled: "Cancelada",
  declined: "Advertencia rechazada",
  rejected: "Solicitud rechazada",
  unknown: "Resultado incierto",
};
const value = (number?: number | null) =>
  number == null
    ? "—"
    : number.toLocaleString("es-CR", { maximumFractionDigits: 8 });

function useOrderAction() {
  const trading = useTrading();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(
    operation: () => Promise<OrderIntent>,
    receive?: (result: OrderIntent) => void,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      trading.recordOrder(result);
      if (mounted.current) receive?.(result);
      if (!["warning", "previewed"].includes(result.state)) {
        void trading.refreshActivity();
        void trading.refreshPortfolio();
      }
    } catch (caught) {
      if (mounted.current) setError(trading.handleApiError(caught));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, run };
}

function WarningActions({
  intent,
  receive,
}: {
  intent: OrderIntent;
  receive?: (intent: OrderIntent) => void;
}) {
  const action = useOrderAction();
  const { colors } = usePrototype();
  return (
    <View style={{ gap: 12 }}>
      <Txt weight={700}>Respondé de inmediato para continuar esta orden.</Txt>
      {intent.messages?.map((message, index) => (
        <Txt key={index}>{message}</Txt>
      ))}
      {action.error && <Txt color={colors.red}>{action.error}</Txt>}
      <PrimaryButton
        title="Aceptar advertencia y continuar"
        disabled={action.busy}
        onPress={() =>
          void action.run(
            () => replyToOrder(intent.id, intent.warningVersion!, true),
            receive,
          )
        }
      />
      <PrimaryButton
        title="Rechazar advertencia"
        disabled={action.busy}
        secondary
        onPress={() =>
          void action.run(
            () => replyToOrder(intent.id, intent.warningVersion!, false),
            receive,
          )
        }
      />
    </View>
  );
}

export function OrderButtons({
  conid,
  symbol,
}: {
  conid: string;
  symbol: string;
}) {
  const trading = useTrading();
  const [side, setSide] = useState<"BUY" | "SELL" | null>(null);
  return (
    <View style={{ gap: 12, marginTop: 16 }}>
      <View style={[ui.row, { gap: 12 }]}>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            title="Comprar"
            disabled={trading.status !== "connected"}
            onPress={() => setSide("BUY")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            title="Vender"
            secondary
            disabled={trading.status !== "connected"}
            onPress={() => setSide("SELL")}
          />
        </View>
      </View>
      {side && (
        <OrderSheet
          key={`${trading.sessionVersion}:${side}`}
          conid={Number(conid)}
          symbol={symbol}
          initialSide={side}
          close={() => setSide(null)}
        />
      )}
    </View>
  );
}

export function OrderSheet({
  conid,
  symbol,
  initialSide,
  modifyOrder,
  close,
}: {
  conid: number;
  symbol: string;
  initialSide: "BUY" | "SELL";
  modifyOrder?: BrokerOrder;
  close: () => void;
}) {
  const { colors } = usePrototype();
  const trading = useTrading();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const action = useOrderAction();
  const [side, setSide] = useState(initialSide);
  const [quantity, setQuantity] = useState(
    modifyOrder?.quantity == null ? "" : String(modifyOrder.quantity),
  );
  const [type, setType] = useState<"MKT" | "LMT">(
    modifyOrder?.orderType === "LMT" ? "LMT" : "MKT",
  );
  const [price, setPrice] = useState(
    modifyOrder?.price == null ? "" : String(modifyOrder.price),
  );
  const [intent, setIntent] = useState<OrderIntent | null>(null);
  const ticket: OrderTicket = {
    conid,
    side,
    quantity: Number(quantity),
    orderType: type,
    ...(type === "LMT" ? { price: Number(price) } : {}),
  };
  const valid =
    /^\d+$/.test(quantity) &&
    Number.isSafeInteger(ticket.quantity) &&
    ticket.quantity > 0 &&
    (type === "MKT" || (/^\d+(\.\d+)?$/.test(price) && Number(price) > 0));
  const current =
    (intent && trading.activity?.intents.find((row) => row.id === intent.id)) ||
    intent;
  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={() => {
        if (!action.busy) close();
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
        <View
          accessibilityViewIsModal
          style={{
            width: "100%",
            maxWidth: 430,
            maxHeight: "94%",
            backgroundColor: colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: Math.max(16, insets.bottom),
          }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 20, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <Header
              title={`${modifyOrder ? "Modificar" : side === "BUY" ? "Comprar" : "Vender"} ${symbol}`}
              right={
                <Button
                  label="Cerrar orden"
                  disabled={action.busy}
                  onPress={close}
                  style={{ minHeight: 44, padding: 10 }}
                >
                  <Txt>Cerrar</Txt>
                </Button>
              }
            />
            {!current ? (
              <>
                {!modifyOrder && (
                  <Segments
                    values={["Comprar", "Vender"]}
                    value={side === "BUY" ? "Comprar" : "Vender"}
                    onChange={(value) =>
                      setSide(value === "Comprar" ? "BUY" : "SELL")
                    }
                  />
                )}
                <Label>CANTIDAD DE ACCIONES ENTERAS</Label>
                <Input
                  accessibilityLabel="Cantidad de acciones"
                  keyboardType="number-pad"
                  value={quantity}
                  onChangeText={setQuantity}
                  editable={!action.busy}
                />
                <Segments
                  values={["Mercado", "Límite"]}
                  value={type === "MKT" ? "Mercado" : "Límite"}
                  onChange={(value) =>
                    setType(value === "Mercado" ? "MKT" : "LMT")
                  }
                />
                {type === "LMT" && (
                  <>
                    <Label>PRECIO LÍMITE POR ACCIÓN</Label>
                    <Input
                      accessibilityLabel="Precio límite"
                      keyboardType="decimal-pad"
                      value={price}
                      onChangeText={setPrice}
                      editable={!action.busy}
                      placeholder="0.00"
                    />
                  </>
                )}
                <Txt size={12} color={colors.secondary}>
                  DAY · Solo horario regular · Sin ventas en corto ni
                  financiamiento. IBKR confirma permisos y reglas para cada
                  orden.
                </Txt>
                <PrimaryButton
                  title="Revisar orden"
                  disabled={action.busy || !valid}
                  onPress={() =>
                    void action.run(
                      () => previewOrder(ticket, modifyOrder?.orderId),
                      setIntent,
                    )
                  }
                />
              </>
            ) : (
              <>
                <Txt weight={700}>{states[current.state]}</Txt>
                {current.ticket && (
                  <>
                    <KeyValue
                      label="Operación"
                      value={
                        current.ticket.side === "BUY" ? "Comprar" : "Vender"
                      }
                    />
                    <KeyValue
                      label="Cantidad"
                      value={value(current.ticket.quantity)}
                    />
                    <KeyValue
                      label="Tipo y vigencia"
                      value={`${current.ticket.orderType} · DAY · Horario regular`}
                    />
                    {current.ticket.price != null && (
                      <KeyValue
                        label="Precio límite"
                        value={`${current.currency ?? ""} ${value(current.ticket.price)}`}
                      />
                    )}
                  </>
                )}
                {current.state === "previewed" && (
                  <>
                    <Txt size={12} color={colors.secondary}>
                      Estimaciones de IBKR. El importe final depende de la
                      ejecución.
                    </Txt>
                    <KeyValue
                      label="Importe estimado"
                      value={current.estimates?.amount.amount ?? "—"}
                    />
                    <KeyValue
                      label="Comisión estimada"
                      value={current.estimates?.amount.commission ?? "—"}
                    />
                    <KeyValue
                      label="Total estimado"
                      value={current.estimates?.amount.total ?? "—"}
                    />
                    <KeyValue
                      label="Cambio de margen inicial"
                      value={current.estimates?.initial.change ?? "—"}
                    />
                    <KeyValue
                      label="Cambio de margen de mantenimiento"
                      value={current.estimates?.maintenance.change ?? "—"}
                    />
                    <KeyValue
                      label="Último precio IBKR"
                      value={current.quote?.last ?? "—"}
                    />
                    <Txt size={10} color={colors.secondary}>
                      {marketDelivery(current.quote?.availability ?? undefined)}{" "}
                      · Hora IBKR{" "}
                      {current.quote?.providerUpdatedAt
                        ? new Date(
                            current.quote.providerUpdatedAt,
                          ).toLocaleString("es-CR")
                        : "—"}
                    </Txt>
                    {current.previewReceivedAt && (
                      <Txt size={10}>
                        Estimación recibida ·{" "}
                        {new Date(current.previewReceivedAt).toLocaleString(
                          "es-CR",
                        )}
                      </Txt>
                    )}
                    {current.estimates?.warning && (
                      <Txt>{current.estimates.warning}</Txt>
                    )}
                    {current.messages?.map((message, index) => (
                      <Txt key={index}>{message}</Txt>
                    ))}
                    {!trading.activity?.writesEnabled && (
                      <Txt color={colors.red}>
                        Configurá almacenamiento persistente en el servidor para
                        habilitar órdenes.
                      </Txt>
                    )}
                    <PrimaryButton
                      title={
                        modifyOrder
                          ? "Confirmar modificación"
                          : "Confirmar y enviar orden"
                      }
                      disabled={action.busy || !trading.activity?.writesEnabled}
                      onPress={() =>
                        void action.run(
                          () => submitOrder(current.id),
                          setIntent,
                        )
                      }
                    />
                    <PrimaryButton
                      title="Editar orden"
                      secondary
                      disabled={action.busy}
                      onPress={() => setIntent(null)}
                    />
                  </>
                )}
                {current.state === "warning" && (
                  <WarningActions
                    key={current.warningVersion}
                    intent={current}
                    receive={setIntent}
                  />
                )}
                {!["previewed", "warning"].includes(current.state) && (
                  <>
                    {current.messages?.map((message, index) => (
                      <Txt key={index}>{message}</Txt>
                    ))}
                    <KeyValue
                      label="Orden IBKR"
                      value={current.orderId ?? "—"}
                    />
                    <Txt>
                      {current.state === "unknown"
                        ? "El resultado necesita reconciliación. Conservamos esta intención y evitamos repetir el envío."
                        : "Consultá Actividad para ver el estado y las ejecuciones confirmadas por IBKR."}
                    </Txt>
                    <PrimaryButton
                      title="Ver actividad"
                      onPress={() => {
                        close();
                        router.push("/app/activity");
                      }}
                    />
                  </>
                )}
              </>
            )}
            {action.busy && <ActivityIndicator color={colors.primary} />}
            {action.error && <Txt color={colors.red}>{action.error}</Txt>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ActivityScreen({ connect }: { connect: () => void }) {
  const trading = useTrading();
  const { colors } = usePrototype();
  const action = useOrderAction();
  const [modifying, setModifying] = useState<BrokerOrder | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const activity = trading.activity;
  return (
    <View style={[ui.page, { gap: 12 }]}>
      <Header title="Actividad" />
      {trading.status !== "connected" ? (
        <PrimaryButton
          title={trading.signedIn ? "Reconectar IBKR" : "Conectar IBKR"}
          onPress={connect}
        />
      ) : (
        <>
          <PrimaryButton
            title={
              trading.activityBusy
                ? "Actualizando…"
                : "Actualizar y reconciliar"
            }
            disabled={trading.activityBusy || action.busy}
            secondary
            onPress={() => {
              void trading.refreshActivity();
              void trading.refreshPortfolio();
            }}
          />
          {trading.activityError && (
            <Txt color={colors.red}>
              Datos anteriores o no disponibles. {trading.activityError}
            </Txt>
          )}
          {action.error && <Txt color={colors.red}>{action.error}</Txt>}
          {activity?.intents
            .filter((intent) => intent.state !== "previewed")
            .map((intent) => (
              <Section key={intent.id} style={{ padding: 16, gap: 12 }}>
                <Txt weight={700}>
                  {intent.kind === "modify"
                    ? "Modificación de "
                    : intent.kind === "cancel"
                      ? "Cancelación de "
                      : "Orden de "}
                  {intent.symbol} · {states[intent.state]}
                </Txt>
                <KeyValue label="Orden IBKR" value={intent.orderId ?? "—"} />
                {intent.ticket && (
                  <KeyValue
                    label={
                      intent.ticket.side === "BUY"
                        ? "Compra revisada"
                        : "Venta revisada"
                    }
                    value={`${value(intent.ticket.quantity)} · ${intent.ticket.orderType}`}
                  />
                )}
                <KeyValue
                  label="Ejecutado / restante"
                  value={`${value(intent.filled)} / ${value(intent.remaining)}`}
                />
                <Txt size={10} color={colors.secondary}>
                  Actualizado ·{" "}
                  {new Date(intent.updatedAt).toLocaleString("es-CR")}
                </Txt>
                {intent.state === "warning" ? (
                  <WarningActions key={intent.warningVersion} intent={intent} />
                ) : (
                  intent.messages?.map((message, index) => (
                    <Txt key={index}>{message}</Txt>
                  ))
                )}
                {intent.state === "unknown" && (
                  <Txt color={colors.red}>
                    Resultado incierto. No vuelvas a enviar esta orden.
                    Actualizá para reconciliar con IBKR.
                  </Txt>
                )}
                {intent.state === "cancel_pending" && (
                  <Txt>
                    Solicitud recibida. Esperando confirmación de cancelación o
                    ejecución de IBKR.
                  </Txt>
                )}
              </Section>
            ))}
          <Label>ÓRDENES REPORTADAS POR IBKR</Label>
          {!activity?.orders ? (
            <Txt>
              Órdenes no disponibles o pausadas por una advertencia pendiente.
            </Txt>
          ) : !activity.orders.length ? (
            <Txt>IBKR no reportó órdenes en esta consulta.</Txt>
          ) : (
            activity.orders.map((order) => (
              <Section key={order.orderId} style={{ padding: 16, gap: 10 }}>
                <Txt weight={700}>
                  {order.symbol} · {order.status}
                </Txt>
                <KeyValue
                  label={`Orden ${order.orderId}`}
                  value={`${order.side} · ${order.orderType} · ${order.tif}`}
                />
                <KeyValue
                  label="Cantidad / ejecutado / restante"
                  value={`${value(order.quantity)} / ${value(order.filled)} / ${value(order.remaining)}`}
                />
                <KeyValue
                  label="Precio medio de ejecución"
                  value={value(order.averagePrice)}
                />
                {order.canManage && activity.writesEnabled && (
                  <>
                    <MenuRow
                      label={`Modificar orden ${order.orderId}`}
                      onPress={() => setModifying(order)}
                    />
                    {cancelId === order.orderId ? (
                      <>
                        <Txt>
                          Confirmá la solicitud de cancelación. La orden puede
                          ejecutarse antes de que IBKR confirme.
                        </Txt>
                        <PrimaryButton
                          title="Confirmar cancelación"
                          disabled={action.busy}
                          onPress={() =>
                            void action.run(
                              () => cancelOrder(order.orderId),
                              () => setCancelId(null),
                            )
                          }
                        />
                        <PrimaryButton
                          title="Mantener orden"
                          secondary
                          disabled={action.busy}
                          onPress={() => setCancelId(null)}
                        />
                      </>
                    ) : (
                      <PrimaryButton
                        title={`Cancelar orden ${order.orderId}`}
                        secondary
                        onPress={() => setCancelId(order.orderId)}
                      />
                    )}
                  </>
                )}
              </Section>
            ))
          )}
          <Label>EJECUCIONES RECIENTES</Label>
          <Txt size={12} color={colors.secondary}>
            IBKR devuelve el día actual y los seis días anteriores. Las
            ejecuciones se actualizan como máximo una vez por minuto.
          </Txt>
          {activity?.executionsReceivedAt && (
            <Txt size={10}>
              Consulta recibida ·{" "}
              {new Date(activity.executionsReceivedAt).toLocaleString("es-CR")}
            </Txt>
          )}
          {!activity?.executions ? (
            <Txt>Ejecuciones no disponibles.</Txt>
          ) : !activity.executions.length ? (
            <Txt>IBKR no reportó ejecuciones en este período.</Txt>
          ) : (
            activity.executions.map((fill, index) => (
              <Section
                key={fill.executionId || index}
                style={{ padding: 16, gap: 8 }}
              >
                <Txt weight={700}>
                  {fill.symbol} · {value(fill.quantity)} a {value(fill.price)}
                </Txt>
                <KeyValue
                  label="Ejecución IBKR"
                  value={fill.executionId || "—"}
                />
                <KeyValue
                  label="Comisión"
                  value={`${fill.commission ?? "—"} ${fill.commissionCurrency ?? ""}`}
                />
                <Txt size={12}>{fill.time ?? "Hora no disponible"}</Txt>
              </Section>
            ))
          )}
        </>
      )}
      {activity?.errors?.length ? (
        <Txt color={colors.red}>
          IBKR no devolvió el estado de algunas órdenes. Conservamos su último
          estado conocido.
        </Txt>
      ) : null}
      {modifying && modifying.conid != null && (
        <OrderSheet
          key={`${trading.sessionVersion}:${modifying.orderId}`}
          conid={modifying.conid}
          symbol={modifying.symbol}
          initialSide={modifying.side === "SELL" ? "SELL" : "BUY"}
          modifyOrder={modifying}
          close={() => setModifying(null)}
        />
      )}
    </View>
  );
}
