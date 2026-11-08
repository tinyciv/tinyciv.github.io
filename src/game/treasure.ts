import { playerFaction, withPlayerFaction } from './player-context';
import { grantIncome } from './resource-income';
import { buildingSize, buildingWidth, buildingHeight, tileAt, type GameState, type TreasureChest, type World, WATER } from './types';
import { updateFog } from './fog';
import { travelTimeMap } from './pathfinding';
import { ridgeFootprintAllowed, ridgeStairAccess } from './ridges';
import { loadPunyWorld } from './puny-world';

export const TREASURE_GOLD = 200;
/** Original Puny World closed chest, column 2, row 29. Its open companion
 * is the next cell. The previous Dungeon tile was a gate and is not used. */
export const TREASURE_SPRITE = { x: 32, y: 464, width: 16, height: 16 };
export const loadTreasureArt = loadPunyWorld;

type Discovery = NonNullable<TreasureChest['discovery']>;
export const GEOGRAPHIC_DISCOVERIES: Record<Discovery, { title: string; gold: number }> = {
    'ancient-grove': { title: 'Ancient Grove', gold: 250 },
    'mountain-pass': { title: 'High Pass', gold: 300 },
    'lake-shore': { title: 'Hidden Mere', gold: 250 },
    'river-confluence': { title: 'Meeting Waters', gold: 325 },
    'coastal-headland': { title: 'Windward Headland', gold: 275 },
};

/** Identify an existing landmark without painting scenery or claiming that
 * arbitrary open ground is a natural wonder. Chests stay in readable clearings. */
export function geographicDiscoveryAt(world: World, x: number, y: number): Discovery | undefined {
    const tile = tileAt(world, x, y);
    if (!tile || WATER.has(tile.terrain) || tile.overlay !== 'none') return;
    let trees = 0, land = 0, lake = 0, pass = false;
    const seaSides = new Set<number>();
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const neighbor = tileAt(world, x + dx, y + dy);
        if (!neighbor) continue;
        if (!WATER.has(neighbor.terrain)) land++;
        if (neighbor.overlay === 'forest' || neighbor.overlay === 'jungle') trees++;
        if (neighbor.terrain === 'lake') lake++;
        if (neighbor.mountainPass && Math.abs(dx) + Math.abs(dy) <= 2) pass = true;
        if (neighbor.terrain === 'coast' || neighbor.terrain === 'ocean')
            seaSides.add(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 0 : 2 : dy > 0 ? 1 : 3);
    }
    if (pass) return 'mountain-pass';
    // Three separated river arms crossing a local ring indicate a junction.
    // Counting contiguous arms avoids mistaking a wide straight river for one.
    const ring: boolean[] = [];
    const river = (dx: number, dy: number) => tileAt(world, x + dx, y + dy)?.terrain === 'river';
    for (let dx = -4; dx < 4; dx++) ring.push(river(dx, -4));
    for (let dy = -4; dy < 4; dy++) ring.push(river(4, dy));
    for (let dx = 4; dx > -4; dx--) ring.push(river(dx, 4));
    for (let dy = 4; dy > -4; dy--) ring.push(river(-4, dy));
    const arms = ring.filter((wet, i) => wet && !ring[(i + ring.length - 1) % ring.length]).length;
    if (arms >= 3) return 'river-confluence';
    if (lake >= 6 && lake <= 32) return 'lake-shore';
    if (seaSides.size >= 3 && (tile.ridge || tile.relief || tile.elevation > .62)) return 'coastal-headland';
    if (trees >= 22 && land >= 32) return 'ancient-grove';
}

function chestRandom(seed: string): () => number {
    let value = 2166136261;
    for (const character of `treasure:${seed}`) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
    return () => {
        value = (value + 0x6d2b79f5) | 0;
        let result = Math.imul(value ^ value >>> 15, value | 1);
        result ^= result + Math.imul(result ^ result >>> 7, result | 61);
        return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
}

/** Seeded independently of game RNG. A saved empty/collected list is final. */
export function initializeTreasureChests(state: GameState): void {
    if (state.treasures !== undefined) return;
    state.treasures = [];
    const leader = state.units.find(unit => unit.faction === playerFaction(state) && unit.kind === 'leader' && unit.hp > 0 && !unit.inside);
    if (!leader) return;
    const fog = updateFog(state), { width, height } = state.world;
    const reachable = travelTimeMap(state, leader, 0, 1, Infinity);
    const occupied = new Set((state.fields ?? []).map(field => field.y * width + field.x));
    const settlements = state.buildings.filter(building => building.hp > 0).map(building => {
        const size = buildingSize(building);
        return { x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2,
            radius: building.kind === 'palace' ? 18 : building.kind === 'house' ? 12 : building.kind === 'camp' ? 10 : size + 3 };
    });
    for (const camp of state.raiderCamps ?? []) settlements.push({ x: camp.x + camp.width / 2, y: camp.y + camp.height / 2, radius: 12 });
    const candidates: number[] = [];
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const cell = y * width + x, tile = state.world.tiles[cell];
        if (!tile || WATER.has(tile.terrain) || fog.explored[cell] || occupied.has(cell) || !Number.isFinite(reachable[cell])) continue;
        // A chest needs readable open ground; forest treasure remains visible
        // in small clearings instead of being buried under opaque tree art.
        if (tile.overlay !== 'none' || ridgeStairAccess(state.world, x, y) || !ridgeFootprintAllowed(state.world, x, y)) continue;
        if (settlements.some(source => (x + .5 - source.x) ** 2 + (y + .5 - source.y) ** 2 < source.radius ** 2)) continue;
        candidates.push(cell);
    }
    const random = chestRandom(state.world.seed);
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = Math.min(24, Math.max(1, Math.round(width * height / 650)));
    const discoveryLimit = Math.min(4, Math.floor(count / 3)), found = new Set<Discovery>();
    for (const cell of candidates) {
        if (state.treasures.length >= discoveryLimit) break;
        const x = cell % width, y = Math.floor(cell / width), discovery = geographicDiscoveryAt(state.world, x, y);
        if (!discovery || found.has(discovery)
            || state.treasures.some(chest => (x - chest.x) ** 2 + (y - chest.y) ** 2 < 18 ** 2)) continue;
        const feature = GEOGRAPHIC_DISCOVERIES[discovery];
        const names = ['Alder', 'Raven', 'Silver', 'Amber', 'Elder', 'Willow', 'Grey', 'Dawn'];
        state.treasures.push({ id: state.treasures.length + 1, x, y, discovery,
            name: `${names[Math.floor(random() * names.length)]} ${feature.title}`, rewardGold: feature.gold });
        found.add(discovery);
    }
    for (const cell of candidates) {
        const x = cell % width, y = Math.floor(cell / width);
        if (state.treasures.some(chest => (x - chest.x) ** 2 + (y - chest.y) ** 2 < 8 ** 2)) continue;
        state.treasures.push({ id: state.treasures.length + 1, x, y });
        if (state.treasures.length === count) break;
    }
}

/** Chests never obstruct navigation. Only a living player Leader collects. */
export function updateTreasureChests(state: GameState): void {
    if (state.multiplayer) {
        for (const faction of state.multiplayer.humanFactionIds) withPlayerFaction(state, faction, () => collectTreasure(state));
    } else collectTreasure(state);
}
function collectTreasure(state: GameState): void {
    const leader = state.units.find(unit => unit.faction === playerFaction(state) && unit.kind === 'leader' && unit.hp > 0 && !unit.inside);
    const player = state.factions.find(faction => faction.id === playerFaction(state) && !faction.defeated);
    if (!leader || !player) return;
    for (const chest of state.treasures ?? []) {
        if (chest.collected || Math.floor(leader.x) !== chest.x || Math.floor(leader.y) !== chest.y) continue;
        chest.collected = true;
        const gold = chest.rewardGold ?? TREASURE_GOLD;
        grantIncome(player, { gold }, state, 'treasure');
        state.particles.push({ x: chest.x + .5, y: chest.y + .5, text: `+${Math.round(gold)} gold`, color: '#ffe33d', life: 1.6, duration: 1.6 });
        if (chest.discovery) {
            state.events.unshift({ id: (state.events[0]?.id ?? 0) + 1, time: state.time, kind: 'good',
                text: `Discovered ${chest.name ?? GEOGRAPHIC_DISCOVERIES[chest.discovery].title}: a wilderness cache worth ${gold} gold.` });
            state.events.length = Math.min(30, state.events.length);
        }
    }
}
