export type DockStatus = "free" | "booked" | "servicing";
export type Action = "book" | "start" | "release" | "cancel";
export interface Dock {
  id: string;
  name: string;
  cargo: string;
  status: DockStatus;
  carrier: string;
  version: number;
}
export interface Movement {
  dockId: string;
  action: Action;
  carrier: string;
  actor: string;
  at: string;
}
export interface Snapshot {
  docks: Dock[];
  moves: Movement[];
}
export interface Session {
  actor: string;
  canWrite: boolean;
  federated: boolean;
  csrfHeader: string;
  csrf: string;
}
export const statusNames = { free: "Livre", booked: "Reservada", servicing: "Em operação" } as const;
export const actionNames = {
  book: "Reserva registrada",
  start: "Descarga iniciada",
  release: "Doca liberada",
  cancel: "Reserva cancelada",
} as const;
