export { default } from "@/features/trading/app";

export function generateStaticParams() {
  return ["home", "market", "instrument", "portfolio", "activity", "more"].map((page) => ({
    path: ["app", page],
  }));
}
