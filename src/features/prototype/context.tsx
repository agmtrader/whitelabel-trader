import {
  createContext,
  useContext,
  useEffect,
  useRef,
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
import AsyncStorage from "@react-native-async-storage/async-storage";

export const light = {
  bg: "#ffffff",
  card: "#ffffff",
  elevated: "#f3f4f6",
  text: "#111827",
  secondary: "#4b5563",
  muted: "#9ca3af",
  border: "#e5e7eb",
  divider: "#f3f4f6",
  primary: "#f26c0d",
  accent: "#f58a3d",
  primaryText: "#a34700",
  green: "#16a34a",
  red: "#dc2626",
  tint: "#fdf0e6",
};
const dark: typeof light = {
  bg: "#09090b",
  card: "#111113",
  elevated: "#1e1e21",
  text: "#fafafa",
  secondary: "#a1a1aa",
  muted: "#71717a",
  border: "#27272a",
  divider: "#1e1e21",
  primary: "#f58a3d",
  accent: "#f58a3d",
  primaryText: "#f8a868",
  green: "#4ade80",
  red: "#f87171",
  tint: "#2a1b11",
};

function usePrototypeState() {
  const [isDark, setDark] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const preferenceVersion = useRef(0);
  const pendingSave = useRef(Promise.resolve());
  useEffect(() => {
    let mounted = true;
    const version = preferenceVersion.current;
    AsyncStorage.getItem("trader.theme")
      .then((value) => {
        if (mounted && preferenceVersion.current === version)
          setDark(value === "dark");
      })
      .catch(() => {
        if (mounted)
          setThemeError(
            "No se pudo leer el tema guardado en este dispositivo.",
          );
      });
    return () => {
      mounted = false;
    };
  }, []);
  const saveTheme = (value: boolean) => {
    preferenceVersion.current++;
    setDark(value);
    setThemeError(null);
    pendingSave.current = pendingSave.current
      .then(() =>
        AsyncStorage.setItem("trader.theme", value ? "dark" : "light"),
      )
      .catch(() => {
        setThemeError(
          "El tema cambió, pero no se pudo guardar en este dispositivo.",
        );
      });
  };
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
    setDark: saveTheme,
    themeError,
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
