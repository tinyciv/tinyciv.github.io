/** Fixed identities keep map seeds reproducible and city names culturally coherent. */
export const CIVILIZATIONS = [
  { name: 'Roma', color: '#f34f59', cities: ['Roma', 'Ostia', 'Antium', 'Capua', 'Neapolis', 'Tibur', 'Ravenna', 'Aquileia', 'Ariminum', 'Mediolanum', 'Verona', 'Bononia', 'Pisae', 'Luca', 'Florentia', 'Brundisium', 'Tarentum', 'Syracusae', 'Arretium', 'Pompeii', 'Beneventum', 'Cumae', 'Salernum', 'Cremona'] },
  { name: 'Egyptians', color: '#ffcf38', cities: ['Thebes', 'Memphis', 'Heliopolis', 'Abydos', 'Elephantine', 'Alexandria'] },
  { name: 'Greeks', color: '#3988ff', cities: ['Athens', 'Sparta', 'Corinth', 'Argos', 'Delphi', 'Olympia'] },
  { name: 'Persians', color: '#b66bff', cities: ['Persepolis', 'Pasargadae', 'Susa', 'Ecbatana', 'Sardis', 'Istakhr'] },
  { name: 'Babylonians', color: '#28dfb0', cities: ['Babylon', 'Borsippa', 'Sippar', 'Nippur', 'Dilbat', 'Kish'] },
  { name: 'Assyrians', color: '#ff8b35', cities: ['Nineveh', 'Assur', 'Nimrud', 'Dur-Sharrukin', 'Arbela', 'Harran'] },
  { name: 'Phoenicians', color: '#e970ce', cities: ['Tyre', 'Sidon', 'Byblos', 'Arwad', 'Berytus', 'Tripolis'] },
  { name: 'Carthaginians', color: '#87b831', cities: ['Carthage', 'Utica', 'Hadrumetum', 'Hippo Regius', 'Leptis Magna', 'Thapsus'] },
  { name: 'Hittites', color: '#d48c66', cities: ['Hattusa', 'Kanesh', 'Sapinuwa', 'Samuha', 'Ankuwa', 'Tarhuntassa'] },
  { name: 'Sumerians', color: '#53d5ec', cities: ['Ur', 'Uruk', 'Lagash', 'Eridu', 'Larsa', 'Umma'] },
  { name: 'Nubians', color: '#b7a7f0', cities: ['Napata', 'Kerma', 'Meroe', 'Kawa', 'Faras', 'Musawwarat'] },
] as const;

export const STARTING_FACTION_COUNT = 6;
export const OPPOSING_FACTION_COUNT = STARTING_FACTION_COUNT - 1;
export const RIVAL_STARTING_GOLD = 1600;

export function civilizationFor(faction: number) {
  return CIVILIZATIONS[faction] ?? CIVILIZATIONS[0];
}
