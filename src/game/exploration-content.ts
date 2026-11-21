export type ExplorationSiteKind = 0 | 1 | 2;
export const explorationSiteSize = (kind: ExplorationSiteKind): 1 | 2 => kind === 1 ? 1 : 2;
export const FOSSIL_DISCOVERY_OUTCOME = 9;

export const EXPLORATION_MESSAGES = [
    "In the ruins of a long-gone civilization, you've found ancient treasure!",
    'While exploring the ruins, your scholars make a great discovery about a long-lost technology!',
    '',
    'You have unwittingly violated the sacred ruins of a powerful nearby clan. Defend yourself immediately!',
    'Refugees from these ruins flee to your nation for safety!',
    'After sitting down with a hermit, you learn much about the surrounding countryside.',
    'A wizened ranger seeks greater glory and joins your army',
    'After consulting with the hermit for hours, you feel wiser and more prepared to rule.',
    "Something has happened to this hermit, and he's nowhere to be found. You take a few trinkets for your trouble.",
    'An astonishing discovery has bolstered our research!',
] as const;
export const RUINS_OFFER = 'In the labyrinth of this ruined city, you spy children racing through abandoned alleyways. These people have been trembling in the ruins for generations and are in need of a strong leader to protect them. Do you offer to accept them into our nation?';
