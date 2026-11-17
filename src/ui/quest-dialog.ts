import { QUEST_TITLES } from '../game/quests';
import type { QuestView } from '../game/quest-types';
import type { GameState } from '../game/types';
import { playerFaction } from '../game/player-context';
import { questFailureReason } from '../game/quest-presentation';
export const QUEST_BENEFITS = [
    'Watchkeepers: watchtower upkeep permanently reduced by 25%.',
    'Roadwrights: construction and repairs permanently 20% faster.',
    'Raider Slayers: your troops permanently gain 10% attack.',
    'Seafarers: trade income permanently increased by 20%.',
    'Timber Wardens: walls, towers and forts permanently gain 25% health.',
    'Good Neighbors: every house permanently gains one housing place.',
    'River Growers: farm harvests permanently increased by 20%.',
    'Overseas Scholars: Science per gold permanently increased by 25%.',
] as const;
const directions = ['east', 'south', 'west', 'north'];
function bearing(q: QuestView): string {
    const index = (Math.round(Math.atan2(q.y - q.gy, q.x - q.gx) / (Math.PI / 2)) + 4) % 4;
    return `${directions[index]}, roughly ${Math.round(Math.hypot(q.x - q.gx, q.y - q.gy) / 10) * 10} tiles away`;
}
export function questDialogue(q: QuestView): string {
    switch (q.kind) {
        case 0: return 'We need eyes on the frontier. Establish an observation post in the yellow area and keep that same post standing for three uninterrupted minutes. Supply the scout and its upkeep yourself; after I accept it, the village takes responsibility.';
        case 1: return 'Solitude need not mean isolation. Connect your original capital’s road network to my doorstep. Complete the road and any bridges it needs. If your capital falls, our agreement ends.';
        case 2: return `A barbarian camp lies ${bearing(q)}. Search the marked area. Destroy its houses and watchtowers; you may leave the walls standing. I will reward the realm that ends their threat.`;
        case 3: return 'Beyond these waters lies a continent your Leader has never visited. Sail there and land on its shores, then return to me. I have greater plans for those who make the crossing.';
        case 4: return 'Give our village a palisade enclosure, protecting the main tent and our homes. Use the same enclosure rules as your own settlements. The finished defenses will belong to us.';
        case 5: return 'Found a new settlement within eight tiles of our village. Finish its construction; no population minimum is required. The new settlement remains yours.';
        case 6: return 'Establish at least 10 new farmland tiles in the yellow riverside area. The patch can spread beside the river; every tile need not touch the water. We will take ownership of the completed farms.';
        case 7: return 'You have found a new shore. Now found a settlement on that continent and grow that one settlement to at least 40 residents. Return to me when its hearths are full.';
    }
}
export function questProgress(q: QuestView): string {
    if (q.state === 0)
        return 'Request available';
    if (q.state === 3)
        return 'Completed';
    if (q.state === 4)
        return questFailureReason(q);
    if (q.state === 2)
        return 'Ready to turn in';
    if (q.kind === 0)
        return `Post survival: ${Math.floor(q.progress)} / 180 seconds`;
    if (q.kind === 2)
        return `Camp targets destroyed: ${q.progress} / ${q.needed}`;
    if (q.kind === 6)
        return `New farmland: ${q.progress} / 10 tiles`;
    if (q.kind === 7)
        return `Settlement population: ${q.progress} / 40`;
    return 'In progress';
}
export function questMarkup(q: QuestView): string {
    const relation = q.relations ? ` · +${q.relations} village affiliation` : '';
    return `<div class="quest-dialog" data-quest-kind="${q.kind}">
    <h2 id="dialog-title">${QUEST_TITLES[q.kind]}</h2>
    <p class="quest-dialogue">“${questDialogue(q)}”</p>
    <p class="quest-progress" data-quest-progress>${questProgress(q)}</p>
    <p class="quest-reward">${q.gold.toLocaleString('en-US')} gold${q.food ? ` · ${q.food.toLocaleString('en-US')} food` : ''}${relation}</p>
    <p class="quest-benefit">${QUEST_BENEFITS[q.kind]}</p>
    <div class="dialog-actions"><button data-quest-action="${q.state === 0 ? 'accept' : 'complete'}" ${q.state === 0 || q.state === 2 ? '' : 'disabled'}>${q.state === 0 ? 'Accept quest' : 'Claim reward'}</button>
      ${q.state === 1 || q.state === 2 ? '<button id="quest-target">Show target</button>' : ''}
      ${q.village >= 0 ? '<button id="quest-diplomacy">Diplomacy</button>' : '<button id="quest-information">Ask for information</button>'}
      <button id="quest-close">Close</button></div><p data-quest-error role="status"></p></div>`;
}
export function refreshQuestDialog(root: HTMLElement, state: GameState): void {
    const dialog = root.querySelector<HTMLElement>('[data-quest-kind]');
    if (!dialog)
        return;
    const q = state.quests?.find(q => q.actor === playerFaction(state) && q.kind === Number(dialog.dataset.questKind));
    if (!q)
        return;
    const progress = dialog.querySelector<HTMLElement>('[data-quest-progress]');
    if (progress)
        progress.textContent = questProgress(q);
    const button = dialog.querySelector<HTMLButtonElement>('[data-quest-action]');
    if (button && !button.dataset.pending)
        button.disabled = q.state !== 0 && q.state !== 2;
}
