/** Scenario identities and browser metadata; prepared states are built offline. */
export const SCENARIOS = [
  { id: 'age-of-exploration', name: 'Age of Exploration', description: 'Build a maritime empire across a sprawling archipelago.', size: '320 × 280', factions: 4, mapPreview: 'scenarios/age-of-exploration-map.png' },
  { id: 'no-mans-land', name: 'No Man’s Land', description: 'Lead three cities against a rival across a fortified frontier.', size: '160 × 130', factions: 2, mapPreview: 'scenarios/no-mans-land-map.png' },
  { id: 'tutorial', name: 'Tutorial', description: 'A small, revealed world with a gentle start and faster gold and research.', size: '80 × 30', factions: 2, mapPreview: 'scenarios/tutorial-map.png' },
  { id: 'island-deathmatch', name: 'Island Deathmatch', description: 'Two island rivals face off with armed galleys and ready harbors.', size: '110 × 50', factions: 2, mapPreview: 'scenarios/island-deathmatch-map.png' },
  { id: 'sandbox', name: 'Sandbox', description: 'Reach 2,000 people as fast as possible.', size: '80 × 60', factions: 1, mapPreview: 'scenarios/sandbox-map.png' },
  { id: 'musketry-deathmatch', name: 'Musketry Deathmatch', description: 'Two cities each, matched resources, and armies of musketmen and cannons.', size: '160 × 39', factions: 2, mapPreview: 'scenarios/musketry-deathmatch-map.png' },
] as const;
export type ScenarioId = typeof SCENARIOS[number]['id'];
