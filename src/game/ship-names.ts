import { civilizationFor } from './civilizations';
import type { GameState } from './types';

// Romanized cultural names. Reuse a name when the pool is exhausted rather
// than adding numeric suffixes to ships.
const NAMES: Record<string, readonly string[]> = {
 Roma: ['Aquila', 'Fortuna', 'Minerva', 'Victoria', 'Aurora', 'Invicta', 'Libertas', 'Neptunus'],
 Egyptians: ['Ra', 'Aset', 'Heru', 'Hathor', 'Bastet', 'Sekhmet', 'Khepri', 'Ma’at'],
 Greeks: ['Athena', 'Nike', 'Artemis', 'Poseidon', 'Argo', 'Thalassa', 'Delphin', 'Aetos'],
 Persians: ['Anahita', 'Mithra', 'Atar', 'Tishtrya', 'Verethragna', 'Hvar', 'Simurgh', 'Arash'],
 Babylonians: ['Marduk', 'Ishtar', 'Nabu', 'Shamash', 'Sin', 'Adad', 'Tiamat', 'Ea'],
 Assyrians: ['Ashur', 'Ishtar', 'Ninurta', 'Shamash', 'Adad', 'Nabu', 'Sin', 'Sharru'],
 Phoenicians: ['Melqart', 'Astarte', 'Eshmun', 'Baal', 'Resheph', 'Yam', 'Dagon', 'Shapash'],
 Carthaginians: ['Tanit', 'Baal Hammon', 'Melqart', 'Eshmun', 'Astarte', 'Resheph', 'Baal Saphon', 'Shadrapa'],
 Hittites: ['Tarhunna', 'Arinna', 'Telipinu', 'Shaushka', 'Lelwani', 'Kamrusepa', 'Hannahanna', 'Inara'],
 Sumerians: ['Enki', 'Inanna', 'Nanna', 'Utu', 'Ninurta', 'Enlil', 'Nanshe', 'Ningal'],
 Nubians: ['Apedemak', 'Amani', 'Sebiumeker', 'Arensnuphis', 'Dedun', 'Mandulis', 'Amesemi', 'Miket'],
};
export function shipName(state: GameState, faction: number, identity: number): string {
 const pool = NAMES[civilizationFor(faction).name];
 const used = new Set(state.units.filter(unit => unit.faction === faction && unit.warship).map(unit => unit.warship!.name));
 for (let offset = 0; offset < pool.length; offset++) {
  const name = pool[(identity + offset) % pool.length];
  if (!used.has(name)) return name;
 }
 return pool[identity % pool.length];
}
