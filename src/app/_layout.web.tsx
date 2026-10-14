import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { TradingProvider } from "@/features/trading/context";
import { PrototypeProvider } from "@/features/prototype/context";

export default function RootLayout() {
  return (
    <PrototypeProvider>
      <TradingProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "none",
          }}
        />
      </TradingProvider>
    </PrototypeProvider>
  );
}
