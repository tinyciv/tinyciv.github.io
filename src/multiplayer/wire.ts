import { Packr, Unpackr } from 'msgpackr';
import type { ClientMessage, ServerMessage } from './protocol';

// Records are embedded in each message. A dropped frame or reconnect never
// depends on a dictionary delivered by an earlier WebSocket message.
const encoder = new Packr({ useRecords: true, sequential: false, structuredClone: false });
const decoder = new Unpackr({ mapsAsObjects: true });

export function encodeMessage(message: ClientMessage | ServerMessage): Uint8Array {
  return encoder.pack(message);
}

export function decodeMessage<T extends ClientMessage | ServerMessage>(bytes: Uint8Array): T {
  const message: unknown = decoder.unpack(bytes);
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || typeof (message as { type?: unknown }).type !== 'string') throw new Error('Invalid multiplayer message.');
  return message as T;
}
