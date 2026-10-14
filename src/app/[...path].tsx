export { default } from "@/features/trading/app";

export function generateStaticParams() {
  return ["home", "market", "instrument", "more"].map((page) => ({
    path: ["app", page],
  }));
}
