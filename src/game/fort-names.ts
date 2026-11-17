import { civilizationFor } from './civilizations';
import type { Building, GameState } from './types';

// Cultural display identities only; naming never consumes simulation RNG.
const NAMES: Record<string, readonly string[]> = {
    Roma: ['Aquila', 'Invicta', 'Valeria', 'Martis', 'Concordia', 'Vigilantia'],
    Egyptians: ['Horus', 'Sekhmet', 'Anubis', 'Wadjet', 'Khepri', 'Apis'],
    Greeks: ['Aegis', 'Athena', 'Leonidas', 'Ajax', 'Olympus', 'Ares'],
    Persians: ['Mithra', 'Arash', 'Simurgh', 'Cyrus', 'Atar', 'Anahita'],
    Babylonians: ['Marduk', 'Ishtar', 'Nabu', 'Shamash', 'Tiamat', 'Adad'],
    Assyrians: ['Ashur', 'Ninurta', 'Sharru', 'Arbela', 'Harran', 'Nimrud'],
    Phoenicians: ['Melqart', 'Astarte', 'Resheph', 'Eshmun', 'Dagon', 'Shapash'],
    Carthaginians: ['Tanit', 'Hannibal', 'Hamilcar', 'Baal Hammon', 'Hasdrubal', 'Byrsa'],
    Hittites: ['Tarhunna', 'Arinna', 'Telipinu', 'Shaushka', 'Lelwani', 'Inara'],
    Sumerians: ['Ninurta', 'Enlil', 'Inanna', 'Nanna', 'Utu', 'Ningal'],
    Nubians: ['Apedemak', 'Amani', 'Dedun', 'Mandulis', 'Amesemi', 'Arensnuphis'],
};

/** The saved identity survives destruction and rebuilding, like city names. */
export function fortName(fort: Pick<Building, 'id' | 'faction' | 'fortName'>): string {
    const pool = NAMES[civilizationFor(fort.faction).name];
    return fort.fortName ?? `Fort ${pool[fort.id % pool.length]}`;
}

/** Called only when placing a fort, never during frame rendering. Reserve names
 * of destroyed foundations too, and add a suffix after the cultural pool fills. */
export function nextFortName(state: GameState, faction: number): string {
    const used = new Set(state.buildings.filter(building => building.kind === 'fort').map(fortName));
    const pool = NAMES[civilizationFor(faction).name];
    for (let cycle = 1; ; cycle++) for (const name of pool) {
        const candidate = `Fort ${name}${cycle === 1 ? '' : ` ${cycle}`}`;
        if (!used.has(candidate)) return candidate;
    }
}
