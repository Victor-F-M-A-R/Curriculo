import type { Dock } from "./model";
export function mountYard(
  container: HTMLElement,
  config: { docks: Dock[]; selectedId: string; onSelect: (id: string) => void },
): {
  update(docks: Dock[], selectedId: string): void;
  destroy(): void;
};
