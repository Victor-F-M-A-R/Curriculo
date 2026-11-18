export type Status = "matched" | "disputed" | "reviewed" | "pending" | "orphan";
export type Entry = {
  reference: string;
  merchant: string;
  expected: number | null;
  received: number | null;
  day: string;
  reason: string | null;
  delta: number;
  status: Status;
};
export const names: Record<Status, string> = {
  matched: "Conciliado",
  disputed: "Divergente",
  reviewed: "Revisado",
  pending: "Pendente",
  orphan: "Sem título",
};
const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const money = (v: number | null) => (v === null ? "—" : fmt.format(v / 100));
