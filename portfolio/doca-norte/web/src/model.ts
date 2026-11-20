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
  authenticated: boolean;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = Number(match[7] ?? 0), offsetMinute = Number(match[8] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60 && offsetHour < 24 && offsetMinute < 60
    && Number.isFinite(Date.parse(value));
}

export function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const board = value as Snapshot;
  if (!Array.isArray(board.docks) || board.docks.length !== 6 || !Array.isArray(board.moves) || board.moves.length > 40
    || !validTimestamp(board.sampledAt)) return false;
  const age = Date.now() - Date.parse(board.sampledAt);
  if (age < -5000 || age > 20_000) return false;
  const ids = new Set<string>();
  for (const dock of board.docks) {
    if (!dock || typeof dock.id !== "string" || !/^D[1-6]$/.test(dock.id) || ids.has(dock.id)
      || typeof dock.name !== "string" || !dock.name.trim() || dock.name.length > 55
      || typeof dock.cargo !== "string" || !dock.cargo.trim() || dock.cargo.length > 40
      || typeof dock.carrier !== "string" || dock.carrier.length > 50
      || (dock.status === "free") !== (dock.carrier.trim() === "")
      || !["free", "booked", "servicing"].includes(dock.status) || !Number.isSafeInteger(dock.version) || dock.version < 0) return false;
    ids.add(dock.id);
  }
  const versions = new Set<string>();
  return board.moves.every(move => {
    if (!move || typeof move.dockId !== "string" || !/^D[1-6]$/.test(move.dockId)
      || (move.dockVersion !== undefined && (!Number.isSafeInteger(move.dockVersion) || move.dockVersion < 1))) return false;
    if (move.dockVersion !== undefined) {
      const key = move.dockId + "/" + move.dockVersion;
      if (versions.has(key)) return false;
      versions.add(key);
    }
    return ["book", "start", "release", "cancel"].includes(move.action)
      && typeof move.carrier === "string" && move.carrier.length <= 50
      && typeof move.actor === "string" && move.actor.length <= 255
      && validTimestamp(move.at) && Date.parse(move.at) <= Date.now() + 5000;
  });
}

export function validSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Session;
  return typeof session.actor === "string" && typeof session.canWrite === "boolean" && typeof session.federated === "boolean"
    && typeof session.authenticated === "boolean" && !(session.federated && session.canWrite && !session.authenticated)
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
