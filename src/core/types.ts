export type Faction = 'dragon' | 'tiger';

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8];

export const FACTIONS: readonly Faction[] = ['dragon', 'tiger'];

export interface Card {
  faction: Faction;
  rank: Rank;
}

/** 对战结果，从"我方"视角：win=我吃对方，lose=我被吃，both=同归于尽 */
export type DuelResult = 'win' | 'lose' | 'both';

export function otherFaction(f: Faction): Faction {
  return f === 'dragon' ? 'tiger' : 'dragon';
}

export function cardKey(c: Card): string {
  return `${c.faction}-${c.rank}`;
}

/** 全套 16 张牌 */
export function allCards(): Card[] {
  const cards: Card[] = [];
  for (const faction of FACTIONS) {
    for (const rank of RANKS) {
      cards.push({ faction, rank });
    }
  }
  return cards;
}
