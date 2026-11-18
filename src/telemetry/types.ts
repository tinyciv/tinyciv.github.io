/** Bounded first-party telemetry protocol; it contains no account credentials. */
export type TelemetryKind = 'session-start' | 'session-end' | 'world-attempt' | 'play-start' | 'play-end' | 'heartbeat' | 'performance' | 'error';
export type WorldType = 'menu' | 'continents' | 'pangaea' | 'fractal' | 'unknown';
export type WorldPreset = WorldType | 'archipelago';
export interface TelemetryContext {
  visitorId: string;
  sessionId: string;
  sessionNum: number;
  build: string;
  worldType: WorldType;
  worldPreset: WorldPreset;
  landform: import('../world/options').LandformFamily;
  scenario: string;
  mode: 'menu' | 'singleplayer' | 'multiplayer';
  width: number;
  height: number;
}
export interface TelemetryEvent extends TelemetryContext {
  id: string;
  kind: TelemetryKind;
  at: number;
  value: number;
  metrics?: Record<string, number>;
  source?: string;
  message?: string;
}
