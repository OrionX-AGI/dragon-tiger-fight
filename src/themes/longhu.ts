import type { Card, Faction, Rank } from '../core/types';
import { RANKS } from '../core/types';

export interface ThemeCardInfo {
  name: string;
  /** 牌面插画路径（public 下），加载失败时界面回退为文字牌面 */
  image: string;
}

export interface Theme {
  id: string;
  label: string;
  factionNames: Record<Faction, string>;
  cards: Record<Faction, Record<Rank, ThemeCardInfo>>;
  cardBack: string;
  boardTexture: string;
}

const dragonNames: Record<Rank, string> = {
  1: '龙王',
  2: '神龙',
  3: '金龙',
  4: '青龙',
  5: '赤龙',
  6: '白龙',
  7: '风雨龙',
  8: '变形龙',
};

const tigerNames: Record<Rank, string> = {
  1: '虎王',
  2: '东北虎',
  3: '大头虎',
  4: '下山虎',
  5: '绿虎',
  6: '妖虎',
  7: '白虎',
  8: '小王虎',
};

function buildCards(faction: Faction, names: Record<Rank, string>): Record<Rank, ThemeCardInfo> {
  const result = {} as Record<Rank, ThemeCardInfo>;
  for (const rank of RANKS) {
    result[rank] = {
      name: names[rank],
      image: `/assets/cards/${faction}-${rank}.webp`,
    };
  }
  return result;
}

export const longhuTheme: Theme = {
  id: 'longhu',
  label: '龙虎斗',
  factionNames: { dragon: '龙', tiger: '虎' },
  cards: {
    dragon: buildCards('dragon', dragonNames),
    tiger: buildCards('tiger', tigerNames),
  },
  cardBack: '/assets/cards/back.webp',
  boardTexture: '/assets/board-texture.webp',
};

export function cardInfo(theme: Theme, card: Card): ThemeCardInfo {
  return theme.cards[card.faction][card.rank];
}
