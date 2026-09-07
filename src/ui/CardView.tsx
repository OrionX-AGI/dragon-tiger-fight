import type { Card } from '../core/types';
import { cardInfo, longhuTheme } from '../themes/longhu';

export type CardSize = 'sm' | 'md' | 'lg';

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: CardSize;
  selected?: boolean;
  dimmed?: boolean;
  pulse?: boolean;
  /** 翻转动画的延迟（毫秒），用于整手牌依次扣暗的波浪效果 */
  flipDelayMs?: number;
  onClick?: () => void;
}

export default function CardView({
  card,
  faceDown,
  size = 'md',
  selected,
  dimmed,
  pulse,
  flipDelayMs,
  onClick,
}: Props) {
  const classes = ['card-view', `card-${size}`];
  if (selected) classes.push('card-selected');
  if (dimmed) classes.push('card-dimmed');
  if (pulse) classes.push('card-pulse');
  if (onClick) classes.push('card-clickable');

  if (!card && !faceDown) {
    classes.push('card-empty');
    return (
      <div className={classes.join(' ')} onClick={onClick}>
        {/* 用半角问号：全角"？"的字形在字符框内靠左、右侧留白，居中后看着是偏的 */}
        <span className="card-empty-mark">?</span>
      </div>
    );
  }

  // 无具体牌面的牌背占位（如对方扣牌等待区、棋盘暗牌）
  if (!card) {
    return (
      <div className={classes.join(' ')} onClick={onClick}>
        <img className="card-img" src={longhuTheme.cardBack} alt="牌背" draggable={false} />
      </div>
    );
  }

  // 有具体牌面：双面结构，faceDown 变化时带 3D 翻转动画
  const info = cardInfo(longhuTheme, card);
  classes.push('card-flip');
  return (
    <div className={classes.join(' ')} onClick={onClick}>
      <div
        className="card-flip-inner"
        style={{
          transform: faceDown ? 'rotateY(180deg)' : 'rotateY(0deg)',
          transitionDelay: flipDelayMs ? `${flipDelayMs}ms` : undefined,
        }}
      >
        <div className="card-face card-front">
          <img className="card-img" src={info.image} alt={info.name} draggable={false} />
          <span className={`card-rank rank-${card.faction}`}>{card.rank}</span>
          <span className="card-name">{info.name}</span>
        </div>
        <div className="card-face card-back-face">
          <img className="card-img" src={longhuTheme.cardBack} alt="牌背" draggable={false} />
        </div>
      </div>
    </div>
  );
}
