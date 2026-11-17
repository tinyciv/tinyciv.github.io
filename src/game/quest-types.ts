export type QuestKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface QuestView {
    actor: number;
    kind: QuestKind;
    state: number;
    giverKind: number;
    giver: number;
    village: number;
    giverFaction: number;
    gx: number;
    gy: number;
    discovered: boolean;
    x: number;
    y: number;
    radius: number;
    target: number;
    progress: number;
    needed: number;
    reason: number;
    land: number;
    gold: number;
    food: number;
    relations: number;
    benefits: number;
    area: number[];
}
