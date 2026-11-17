/** Mutation notifications for the few scalars that feed derived indexes.
 * Entity identity and ordinary JSON/structuredClone semantics are preserved.
 * Slots hold observers weakly so replacing a cache cannot retain old indexes. */
export interface ScalarObserver {
  changed(target: object, key: string, previous: unknown, value: unknown): void;
}
interface Slot {
  get: () => unknown;
  listeners: WeakRef<ScalarObserver>[];
}
const slots = new WeakMap<object, Map<string, Slot>>();

export function observeScalars(target: object, keys: readonly string[], observer: ScalarObserver): void {
  let properties = slots.get(target);
  if (!properties) { properties = new Map(); slots.set(target, properties); }
  const record = target as Record<string, unknown>;
  for (const key of keys) {
    let slot = properties.get(key);
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!slot || descriptor?.get !== slot.get) {
      // Re-arm after a public/editor deletion. Runtime lifecycle publications
      // invalidate their dependent indexes before the next read.
      if (descriptor && (!descriptor.configurable || descriptor.get || descriptor.set)) continue;
      let value = record[key];
      const listeners = slot?.listeners ?? [];
      let enumerable = descriptor?.enumerable ?? false;
      const get = () => value;
      slot = { get, listeners };
      properties.set(key, slot);
      Object.defineProperty(target, key, { configurable: true, enumerable,
        get, set(next: unknown) {
          if (Object.is(value, next)) return;
          const previous = value; value = next;
          // Optional properties become serializable when first assigned.
          if (!enumerable) { enumerable = true; Object.defineProperty(target, key, { enumerable: true }); }
          for (let i = 0; i < listeners.length; i++) {
            const listener = listeners[i].deref();
            if (listener) listener.changed(target, key, previous, next); else listeners.splice(i--, 1);
          }
        } });
    }
    if (!slot.listeners.some(reference => reference.deref() === observer)) slot.listeners.push(new WeakRef(observer));
  }
}
