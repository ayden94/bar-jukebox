export type BusEvent = "mutate" | "progress";

type Listener = (event: BusEvent) => void;

const listeners = new Set<Listener>();

export function onChange(listener: Listener): void {
  listeners.add(listener);
}

export function emit(event: BusEvent): void {
  for (const listener of listeners) listener(event);
}
