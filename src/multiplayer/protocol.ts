import type { BuildSelection, GameState, InputState, Point, ResearchBranchId, RetinueStance, Tile } from '../game/types';
import type { LeaderSkillId } from '../game/leader-progression';
import type { LandformFamily, WorldGenerationStyle } from '../world/options';

export const PROTOCOL_VERSION = 1;
export const FACTION_COLORS = ['#4f9ee8', '#df6262', '#e5b94e', '#8abb69', '#b08ae3', '#ef9d62'] as const;
export interface MatchOptions { seed: string; style: WorldGenerationStyle; landformFamily: LandformFamily; advancedStart?: boolean; }
export interface LobbyPlayer { id: string; name: string; color: string; faction: number; ready: boolean; connected: boolean; }
export interface LobbyRoom {
  id: string; name: string; location: string; players: LobbyPlayer[];
  phase: 'waiting' | 'loading' | 'playing' | 'finished'; hostId: string; options: MatchOptions;
}
export type GameCommand =
  | { type: 'move' | 'attack' | 'interact'; x: number; y: number }
  | { type: 'garrison' | 'levy' | 'dismiss-levy' | 'recall' | 'movement' | 'respawn' | 'infantry-formation' }
  | { type: 'stance'; stance: RetinueStance }
  | { type: 'auto-rebuild-defenses'; enabled: boolean }
  | { type: 'learnLeaderSkill'; skill: LeaderSkillId }
  | { type: 'build'; kind: BuildSelection; points: Point[] }
  | { type: 'clear'; start: Point; end: Point }
  | { type: 'forbid'; start: Point; end: Point; enabled: boolean }
  | { type: 'diplomacy'; faction: number; action: 'war' | 'confederate' | 'trade' | 'ally'; buildingId?: number }
  | { type: 'capture'; buildingId: number; capture: boolean }
  | { type: 'research-priority' | 'research-remove-priority'; buildingId: number; branch: ResearchBranchId }
  | { type: 'research-allocation'; buildingId: number; allocation: number }
  | { type: 'guard-walls'; buildingId: number; enabled: boolean }
  | { type: 'fort-brigade' | 'fort-rebuild' | 'immigrant' | 'retinue-slot' | 'guard-upgrade' | 'keep' | 'keep-housing'; buildingId: number }
  | { type: 'orchard'; buildingId: number; count: 1 | 10 }
  | { type: 'blacksmith'; buildingId: number; track: 'armor' | 'weapon' }
  | { type: 'archers' | 'spearmen' | 'horsemen'; buildingId: number; fraction: number }
  | { type: 'governor'; buildingId: number; permission: 'farms' | 'housing'; enabled: boolean }
  | { type: 'village'; buildingId: number; action: 'trade' | 'ally' | 'war' };
export interface CommandResult { ok: boolean; message?: string; }
export type ClientMessage =
  | { type: 'hello'; version: number; token?: string }
  | { type: 'list' | 'leave' | 'start' | 'sync' }
  | { type: 'create'; name: string; playerName: string; color: string; options: MatchOptions }
  | { type: 'join'; roomId: string; name: string; color: string }
  | { type: 'profile'; name: string; color: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'input'; input: InputState }
  | { type: 'command'; seq: number; command: GameCommand }
  | { type: 'ping'; nonce: number };
export type DynamicState = Omit<GameState, 'world'>;
export type ServerMessage =
  | { type: 'welcome'; version: number; token: string; playerId: string; commandSequence: number }
  | { type: 'rooms'; rooms: LobbyRoom[] }
  | { type: 'room'; room: LobbyRoom | null; faction: number | null }
  | { type: 'loading'; message: string; progress: number }
  | { type: 'snapshot'; sequence: number; state: GameState }
  | { type: 'frame'; sequence: number; state: DynamicState; tiles?: [number, Tile][]; worldRevision?: number }
  | { type: 'result'; seq: number; result: CommandResult }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'pong'; nonce: number };
