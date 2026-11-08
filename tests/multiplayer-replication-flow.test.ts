import { describe, expect, it, vi } from 'vitest';
import { ReplicationFlow } from '../server/replication-flow';

class Socket {
  bufferedAmount = 0;
  sent: string[] = [];
  callbacks: (() => void)[] = [];
  send(payload: string, callback?: () => void): void {
    this.sent.push(payload); this.bufferedAmount += Buffer.byteLength(payload);
    if (callback) this.callbacks.push(callback);
  }
  flushSnapshot(): void { this.bufferedAmount = 0; this.callbacks.shift()?.(); }
}

describe('bounded multiplayer snapshot backpressure', () => {
  it('keeps deltas following a large snapshot in exact sequence without a resync loop', () => {
    const flow = new ReplicationFlow(100, 25), socket = new Socket(), sync = vi.fn();
    const snapshot = 'S'.repeat(1000);
    expect(flow.send(socket, 'snapshot', snapshot, sync)).toBe('sent');
    expect(flow.send(socket, 'frame', 'frame1', sync)).toBe('sent');
    expect(flow.send(socket, 'frame', 'frame2', sync)).toBe('sent');
    expect(socket.sent).toEqual([snapshot, 'frame1', 'frame2']);
    socket.flushSnapshot();
    expect(flow.send(socket, 'frame', 'frame3', sync)).toBe('sent');
    expect(sync).not.toHaveBeenCalled();
  });
  it('bounds queued bytes to one snapshot plus the frame budget and requests a fresh baseline after overflow', () => {
    const flow = new ReplicationFlow(100, 25), socket = new Socket(), sync = vi.fn();
    flow.send(socket, 'snapshot', 'S'.repeat(1000), sync);
    expect(flow.send(socket, 'frame', 'A'.repeat(100), sync)).toBe('sent');
    expect(socket.bufferedAmount).toBe(1100);
    expect(flow.send(socket, 'frame', 'B', sync)).toBe('skipped');
    expect(flow.send(socket, 'snapshot', 'T'.repeat(1000), sync)).toBe('skipped');
    expect(socket.bufferedAmount).toBe(1100);
    socket.flushSnapshot(); flow.drain(socket, sync); expect(sync).toHaveBeenCalledTimes(1);
    expect(flow.send(socket, 'frame', 'still-missing-predecessor', sync)).toBe('skipped');
    flow.drain(socket, sync); expect(sync).toHaveBeenCalledTimes(1);
    expect(flow.send(socket, 'snapshot', 'U'.repeat(1000), sync)).toBe('sent');
    expect(flow.send(socket, 'frame', 'C', sync)).toBe('sent');
  });
  it('restores the ordinary budget after snapshot completion and clears pending recovery on close', () => {
    const flow = new ReplicationFlow(100, 25), socket = new Socket(), sync = vi.fn();
    flow.send(socket, 'snapshot', 'S'.repeat(1000), sync); socket.flushSnapshot();
    socket.bufferedAmount = 95;
    expect(flow.send(socket, 'frame', 'over-budget', sync)).toBe('skipped');
    socket.bufferedAmount = 0;
    expect(flow.send(socket, 'frame', 'missing-predecessor', sync)).toBe('sync');
    expect(sync).toHaveBeenCalledTimes(1);
    socket.bufferedAmount = 200; flow.send(socket, 'frame', 'skip', sync);
    flow.close(socket); socket.bufferedAmount = 0; flow.drain(socket, sync);
    expect(sync).toHaveBeenCalledTimes(1);
  });
  it('retries a requested snapshot if a different outbound message congested the socket before its reply', () => {
    const flow = new ReplicationFlow(100, 25), socket = new Socket(), sync = vi.fn();
    socket.bufferedAmount = 100; flow.send(socket, 'frame', 'lost', sync);
    socket.bufferedAmount = 0; flow.drain(socket, sync); expect(sync).toHaveBeenCalledTimes(1);
    socket.bufferedAmount = 101;
    expect(flow.send(socket, 'snapshot', 'S'.repeat(1000), sync)).toBe('skipped');
    socket.bufferedAmount = 0; flow.drain(socket, sync); expect(sync).toHaveBeenCalledTimes(2);
    expect(flow.send(socket, 'snapshot', 'S'.repeat(1000), sync)).toBe('sent');
    expect(flow.send(socket, 'frame', 'next', sync)).toBe('sent');
  });
});
