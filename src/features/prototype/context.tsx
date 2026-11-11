import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from "@expo-google-fonts/inter";

export const improsa = {
  navy: "#08264B",
  deepNavy: "#06182F",
  blue: "#173E69",
  gold: "#D9A437",
  lightGold: "#F2CA72",
  applicationUrl:
    "https://agmtechnology.com/en/apply?provider_id=8c0f8a6f-4c4c-4a1f-9e7c-6de9d7d3f3a1" as const,
};

export const light = {
  bg: "#f6f8fb",
  card: "#ffffff",
  elevated: "#eaf0f7",
  text: improsa.deepNavy,
  secondary: "#40536b",
  muted: "#576a82",
  border: "#dce4ee",
  divider: "#e5ebf3",
  primary: improsa.blue,
  accent: improsa.navy,
  primaryText: improsa.blue,
  green: "#16a34a",
  red: "#dc2626",
  tint: "#f9efd9",
};
const dark: typeof light = {
  bg: "#0a1525",
  card: "#111f32",
  elevated: "#1b2d45",
  text: "#f4f7fb",
  secondary: "#c2cede",
  muted: "#a0b1c8",
  border: "#2b3e55",
  divider: "#24354b",
  primary: improsa.gold,
  accent: "#285481",
  primaryText: improsa.lightGold,
  green: "#4ade80",
  red: "#f87171",
  tint: "#34291a",
};

function usePrototypeState() {
  const [isDark, setDark] = useState(false);
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  return {
    colors: isDark ? dark : light,
    isDark,
    setDark,
    loaded,
  };
}
const PrototypeContext = createContext<ReturnType<
  typeof usePrototypeState
> | null>(null);
export function PrototypeProvider({ children }: PropsWithChildren) {
  const state = usePrototypeState();
  return (
    <PrototypeContext.Provider value={state}>
      {children}
    </PrototypeContext.Provider>
  );
}
export function usePrototype() {
  const value = useContext(PrototypeContext);
  if (!value) throw new Error("PrototypeProvider is required");
  return value;
}
