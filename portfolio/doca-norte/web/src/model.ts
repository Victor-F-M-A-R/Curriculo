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
  dockVersion?: number;
  dockId: string;
  action: Action;
  carrier: string;
  actor: string;
  at: string;
}
export interface Snapshot {
  docks: Dock[];
  moves: Movement[];
  sampledAt?: string;
}
export interface Session {
  actor: string;
  canWrite: boolean;
  federated: boolean;
  csrfHeader: string;
  csrf: string;
  authenticated?: boolean;
}

export function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const board = value as Snapshot;
  if (!Array.isArray(board.docks) || board.docks.length !== 6 || !Array.isArray(board.moves) || board.moves.length > 40
    || typeof board.sampledAt !== "string" || !Number.isFinite(Date.parse(board.sampledAt))) return false;
  const age = Date.now() - Date.parse(board.sampledAt);
  if (age < -5000 || age > 20_000) return false;
  const ids = new Set<string>();
  for (const dock of board.docks) {
    if (!dock || !/^D[1-6]$/.test(dock.id) || ids.has(dock.id) || typeof dock.name !== "string"
      || typeof dock.cargo !== "string" || typeof dock.carrier !== "string" || dock.carrier.length > 50
      || !["free", "booked", "servicing"].includes(dock.status) || !Number.isSafeInteger(dock.version) || dock.version < 0) return false;
    ids.add(dock.id);
  }
  return board.moves.every(move => move && /^D[1-6]$/.test(move.dockId)
    && ["book", "start", "release", "cancel"].includes(move.action)
    && typeof move.carrier === "string" && typeof move.actor === "string" && Number.isFinite(Date.parse(move.at)));
}

export function validSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Session;
  return typeof session.actor === "string" && typeof session.canWrite === "boolean" && typeof session.federated === "boolean"
    && typeof session.csrfHeader === "string" && /^X-[A-Za-z0-9-]{1,60}$/.test(session.csrfHeader)
    && typeof session.csrf === "string" && session.csrf.length > 0 && session.csrf.length < 2048;
}
export const statusNames = { free: "Livre", booked: "Reservada", servicing: "Em operação" } as const;
export const actionNames = {
  book: "Reserva registrada",
  start: "Descarga iniciada",
  release: "Doca liberada",
  cancel: "Reserva cancelada",
} as const;
