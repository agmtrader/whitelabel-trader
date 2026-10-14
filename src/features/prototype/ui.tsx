import { useId, type PropsWithChildren } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
  type TextInputProps,
} from "react-native";
import {
  ArrowLeft,
  ChevronRight,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
  Line,
} from "react-native-svg";
import { usePrototype } from "./context";
import { logos } from "./logos";

const fonts = {
  400: "Inter_400Regular",
  500: "Inter_500Medium",
  600: "Inter_600SemiBold",
  700: "Inter_700Bold",
  800: "Inter_800ExtraBold",
};
export function Txt({
  children,
  size = 14,
  weight = 400,
  color,
  style,
  lines,
}: PropsWithChildren<{
  size?: number;
  weight?: keyof typeof fonts;
  color?: string;
  style?: StyleProp<TextStyle>;
  lines?: number;
}>) {
  const { colors, loaded } = usePrototype();
  return (
    <Text
      numberOfLines={lines}
      style={[
        {
          color: color || colors.text,
          fontSize: size,
          fontFamily: loaded ? fonts[weight] : undefined,
          fontWeight: loaded
            ? undefined
            : (String(weight) as TextStyle["fontWeight"]),
          fontVariant: ["tabular-nums"],
          lineHeight: size * 1.4,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Button({
  children,
  onPress,
  label,
  style,
  disabled = false,
  selected,
  checked,
  role = "button",
}: PropsWithChildren<{
  onPress?: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean;
  role?: "button" | "tab" | "switch";
}>) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected, checked }}
      aria-selected={role === "tab" ? selected : undefined}
      aria-checked={role === "switch" ? checked : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        style,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] },
      ]}
    >
      {children}
    </Pressable>
  );
}
export function PrimaryButton({
  title,
  onPress,
  disabled,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const { colors } = usePrototype();
  return (
    <Button
      label={title}
      onPress={onPress}
      disabled={disabled}
      style={[
        ui.primary,
        { backgroundColor: secondary ? colors.elevated : colors.accent },
      ]}
    >
      <Txt weight={700} color={secondary ? colors.text : "#fff"}>
        {title}
      </Txt>
    </Button>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  color,
  filled = false,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  color?: string;
  filled?: boolean;
}) {
  const { colors } = usePrototype();
  return (
    <Button
      label={label}
      onPress={onPress}
      style={[ui.iconButton, { backgroundColor: colors.elevated }]}
    >
      <Icon
        size={19}
        strokeWidth={1.7}
        color={color || colors.secondary}
        fill={filled ? color : "none"}
      />
    </Button>
  );
}
export function Brand({
  size = 32,
  wordmark = false,
}: {
  size?: number;
  wordmark?: boolean;
}) {
  return (
    <Image
      accessibilityLabel="AGM"
      source={
        wordmark
          ? require("../../../assets/images/trader/logo-agm-light.png")
          : require("../../../assets/images/trader/logo-agm-iso.png")
      }
      resizeMode="contain"
      style={{ width: wordmark ? size * 3 : size, height: size }}
    />
  );
}
export function StockLogo({
  symbol,
  size = 36,
}: {
  symbol: string;
  size?: number;
}) {
  const { colors } = usePrototype();
  return logos[symbol] ? (
    <Image
      source={logos[symbol]}
      accessibilityLabel={symbol}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  ) : (
    <View
      style={[
        ui.center,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.elevated,
        },
      ]}
    >
      <Txt weight={700} size={10}>
        {symbol.slice(0, 2)}
      </Txt>
    </View>
  );
}
export function Header({
  title,
  back,
  right,
}: {
  title: string;
  back?: () => void;
  right?: React.ReactNode;
}) {
  const { colors } = usePrototype();
  return (
    <View style={[ui.row, { marginBottom: 20, minHeight: 36 }]}>
      {back && (
        <Button
          label="Volver"
          onPress={back}
          style={{ width: 36, height: 40, justifyContent: "center" }}
        >
          <ArrowLeft size={20} color={colors.secondary} />
        </Button>
      )}
      <Txt size={18} weight={700} style={{ flex: 1 }}>
        {title}
      </Txt>
      {right}
    </View>
  );
}
export function Section({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { colors } = usePrototype();
  return (
    <View
      style={[
        ui.section,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Label({ children }: PropsWithChildren) {
  return (
    <Txt
      size={12}
      weight={700}
      color={usePrototype().colors.muted}
      style={{ letterSpacing: 0.6, marginBottom: 12 }}
    >
      {children}
    </Txt>
  );
}
export function Segments({
  values,
  value,
  onChange,
  small = false,
  boxed = false,
  scroll = false,
  compact = false,
  fontSize,
}: {
  values: string[];
  value: string;
  onChange: (value: string) => void;
  small?: boolean;
  boxed?: boolean;
  scroll?: boolean;
  compact?: boolean;
  fontSize?: number;
}) {
  const { colors } = usePrototype();
  const content = (
    <View
      style={[
        ui.row,
        { gap: small ? 3 : 6 },
        boxed && {
          backgroundColor: colors.elevated,
          padding: 4,
          borderRadius: 12,
        },
      ]}
    >
      {values.map((item) => (
        <Button
          role="tab"
          label={item}
          key={item}
          selected={item === value}
          onPress={() => onChange(item)}
          style={{
            flex: scroll || compact ? undefined : 1,
            minHeight: 40,
            paddingHorizontal: scroll ? 14 : 3,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              paddingVertical: small ? 4 : 6,
              paddingHorizontal: small ? 10 : 12,
              borderRadius: boxed ? 8 : 24,
              backgroundColor:
                item === value
                  ? boxed
                    ? colors.card
                    : colors.tint
                  : "transparent",
              borderWidth: item === value && !boxed ? 1 : 0,
              borderColor: colors.primary + "30",
            }}
          >
            <Txt
              size={fontSize || (small ? 10 : 12)}
              lines={1}
              weight={item === value ? 600 : 500}
              color={
                item === value
                  ? boxed
                    ? colors.text
                    : colors.primaryText
                  : colors.muted
              }
            >
              {item}
            </Txt>
          </View>
        </Button>
      ))}
    </View>
  );
  return scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {content}
    </ScrollView>
  ) : (
    content
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Buscar instrumento...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { colors, loaded } = usePrototype();
  return (
    <View
      style={[
        ui.row,
        {
          backgroundColor: colors.elevated,
          borderRadius: 12,
          paddingHorizontal: 12,
          gap: 10,
          marginVertical: 12,
        },
      ]}
    >
      <Search size={17} color={colors.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={
          {
            flex: 1,
            height: 42,
            fontSize: 14,
            fontFamily: loaded ? fonts[400] : undefined,
            color: colors.text,
            outlineWidth: 0,
          } as TextStyle
        }
      />
    </View>
  );
}
export function Input(props: TextInputProps) {
  const { colors, loaded } = usePrototype();
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.muted}
      style={[
        {
          color: colors.text,
          fontFamily: loaded ? fonts[400] : undefined,
          backgroundColor: colors.elevated,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 14,
          fontSize: 14,
          minHeight: 48,
        },
        props.style,
      ]}
    />
  );
}
export function MenuRow({
  label,
  icon: Icon,
  onPress,
  detail,
}: {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  detail?: string;
}) {
  const { colors } = usePrototype();
  return (
    <Button
      label={label}
      onPress={onPress}
      style={[
        ui.row,
        {
          padding: 16,
          gap: 12,
          borderBottomWidth: 1,
          borderColor: colors.divider,
          minHeight: 49,
        },
      ]}
    >
      {Icon && <Icon size={20} strokeWidth={1.5} color={colors.muted} />}
      <Txt weight={500} style={{ flex: 1 }}>
        {label}
      </Txt>
      {detail && (
        <Txt size={12} color={colors.muted}>
          {detail}
        </Txt>
      )}
      <ChevronRight size={16} color={colors.muted} />
    </Button>
  );
}
export function KeyValue({ label, value }: { label: string; value: string }) {
  const { colors } = usePrototype();
  return (
    <View
      style={[
        ui.row,
        {
          justifyContent: "space-between",
          paddingVertical: 12,
          gap: 12,
          borderBottomWidth: 1,
          borderColor: colors.divider,
        },
      ]}
    >
      <Txt color={colors.secondary} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt weight={600} style={{ textAlign: "right", flexShrink: 1 }}>
        {value}
      </Txt>
    </View>
  );
}
export function DemoNote({ financial = false }: { financial?: boolean }) {
  return (
    <Txt
      size={10}
      color={usePrototype().colors.muted}
      style={{ textAlign: "center", marginTop: 20, marginBottom: 12 }}
    >
      {financial
        ? "Demostración · No se envían órdenes ni se transfieren fondos."
        : "AGM Trader v1.0.0 · Prototipo con datos de demostración"}
    </Txt>
  );
}
export function Chart({
  values,
  color,
  height = 120,
  labels = [],
  fill = true,
  grid = false,
}: {
  values: number[];
  color?: string;
  height?: number;
  labels?: string[];
  fill?: boolean;
  grid?: boolean;
}) {
  const { colors } = usePrototype();
  const id = "chart" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const stroke = color || colors.primary;
  const width = 398,
    min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  const points = values.map((value, index) => [
    (index / (values.length - 1)) * width,
    height - 4 - ((value - min) / span) * (height - 12),
  ]);
  const path = points
    .map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`)
    .join(" ");
  return (
    <View
      accessibilityLabel="Gráfico de precios IBKR"
      style={{ marginVertical: 6 }}
    >
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.18} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {grid &&
          [0.05, 0.35, 0.65, 0.95].map((n) => (
            <Line
              key={n}
              x1={0}
              x2={width}
              y1={height * n}
              y2={height * n}
              stroke={colors.divider}
              strokeDasharray="3 5"
            />
          ))}
        {fill && (
          <Path
            d={`${path} L ${width} ${height} L 0 ${height} Z`}
            fill={`url(#${id})`}
          />
        )}
        <Path
          d={path}
          stroke={stroke}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {fill && (
          <Circle
            cx={width - 1}
            cy={points[points.length - 1][1]}
            r={3}
            fill={stroke}
          />
        )}
      </Svg>
      {labels.length > 0 && (
        <View
          style={[ui.row, { justifyContent: "space-between", marginTop: 8 }]}
        >
          {labels.map((label, index) => (
            <Txt
              size={labels.length > 5 ? 8 : 12}
              key={`${label}-${index}`}
              color={colors.muted}
            >
              {label}
            </Txt>
          ))}
        </View>
      )}
    </View>
  );
}
export const ui = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  section: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  primary: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    minHeight: 46,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  page: { padding: 16 },
  gap: { gap: 12 },
  grow: { flex: 1 },
});
