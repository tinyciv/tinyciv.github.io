import TinyQueue from 'tinyqueue';

interface ScheduledEvent<K, V> { key: K; at: number; value: V; sequence: number }

/** A simulation-time queue: callers supply the clock and own the authoritative
 * deadlines. Replacement/cancellation leave harmless stale heap entries, which
 * are periodically compacted so frequently postponed events cannot grow forever.
 * No queue state is serialized; each owning system reconstructs it after load. */
export class SimulationEvents<K, V = K> {
  private sequence = 0;
  private current = new Map<K, ScheduledEvent<K, V>>();
  private heap = new TinyQueue<ScheduledEvent<K, V>>([], (a, b) => a.at - b.at || a.sequence - b.sequence);

  get size(): number { return this.current.size; }
  get queuedCount(): number { return this.heap.length; }
  has(key: K): boolean { return this.current.has(key); }

  schedule(key: K, at: number, value: V): void {
    if (!Number.isFinite(at)) { this.cancel(key); return; }
    const previous = this.current.get(key);
    if (previous?.at === at && previous.value === value) return;
    const event = { key, at, value, sequence: this.sequence++ };
    this.current.set(key, event);
    this.heap.push(event);
    this.compact();
  }

  cancel(key: K): void {
    this.current.delete(key);
    this.compact();
  }

  takeDue(now: number): V[] {
    const result: V[] = [];
    if (!Number.isFinite(now)) return result;
    while (this.heap.length && this.heap.peek()!.at <= now) {
      const event = this.heap.pop()!;
      if (this.current.get(event.key) !== event) continue;
      this.current.delete(event.key);
      result.push(event.value);
    }
    this.compact();
    return result;
  }

  clear(): void {
    this.current.clear();
    this.heap = new TinyQueue<ScheduledEvent<K, V>>([], (a, b) => a.at - b.at || a.sequence - b.sequence);
    this.sequence = 0;
  }

  private compact(): void {
    if (this.heap.length > 64 && this.heap.length > this.current.size * 2)
      this.heap = new TinyQueue([...this.current.values()], (a, b) => a.at - b.at || a.sequence - b.sequence);
  }
}
