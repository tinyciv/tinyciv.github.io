interface ReplicationSocket {
  readonly bufferedAmount: number;
  send(payload: string, callback?: (error?: Error) => void): void;
}

/** A large initial world may itself exceed the ordinary frame budget. Keep
 * subsequent deltas in sequence behind that one snapshot, within a bounded
 * extra allowance, instead of repeatedly dropping them and resending worlds. */
export class ReplicationFlow {
  private pending = new WeakSet<ReplicationSocket>();
  private requested = new WeakSet<ReplicationSocket>();
  private snapshots = new WeakMap<ReplicationSocket, { limit: number }>();
  constructor(private readonly frameBudget = 2 * 1024 * 1024, private readonly drainedAt = 512 * 1024) {}

  send(socket: ReplicationSocket, type: 'frame' | 'snapshot', payload: string, requestSync: () => void): 'sent' | 'skipped' | 'sync' {
    const snapshot = this.snapshots.get(socket), bytes = Buffer.byteLength(payload);
    // At most one world transfer is queued per socket. A later snapshot will
    // supersede skipped messages once the current transfer has drained.
    if (type === 'snapshot' && snapshot || socket.bufferedAmount > (snapshot?.limit ?? this.frameBudget)
      || type === 'frame' && socket.bufferedAmount + bytes > (snapshot?.limit ?? this.frameBudget)) {
      if (type === 'snapshot') this.requested.delete(socket);
      this.pending.add(socket); return 'skipped';
    }
    if (type === 'snapshot') {
      this.pending.delete(socket); this.requested.delete(socket);
      const transfer = { limit: bytes + this.frameBudget };
      this.snapshots.set(socket, transfer);
      socket.send(payload, () => { if (this.snapshots.get(socket) === transfer) this.snapshots.delete(socket); });
      return 'sent';
    }
    if (this.pending.has(socket)) {
      if (snapshot || this.requested.has(socket)) return 'skipped';
      this.requested.add(socket); requestSync(); return 'sync';
    }
    socket.send(payload); return 'sent';
  }

  /** Finished matches may have no later frame to trigger recovery. */
  drain(socket: ReplicationSocket, requestSync: () => void): void {
    if (this.pending.has(socket) && !this.requested.has(socket) && !this.snapshots.has(socket) && socket.bufferedAmount < this.drainedAt) {
      this.requested.add(socket); requestSync();
    }
  }
  close(socket: ReplicationSocket): void { this.pending.delete(socket); this.requested.delete(socket); this.snapshots.delete(socket); }
}
