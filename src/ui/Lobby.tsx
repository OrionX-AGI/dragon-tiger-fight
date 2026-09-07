import { useState } from 'react';
import type { AiLevel } from '../ai/cardAI';
import { AI_LEVEL_LABELS } from '../ai/cardAI';
import { isMusicOn, isSfxOn, setMusicOn, setSfxOn } from '../audio/sound';
import type { MatchConfig } from './config';
import { defaultConfig } from './config';

interface Props {
  onStartCard: (config: MatchConfig) => void;
  onStartBoard: (config: MatchConfig) => void;
  onRules: () => void;
}

const LEVELS: AiLevel[] = ['easy', 'normal', 'hard'];

function OptionGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="opt-group">
      {options.map((o) => (
        <button
          key={o.id}
          className={`opt-btn ${value === o.id ? 'opt-active' : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GamePanel({
  title,
  description,
  showFaction,
  showFirstMover,
  onStart,
}: {
  title: string;
  description: string;
  showFaction?: boolean;
  showFirstMover?: boolean;
  onStart: (config: MatchConfig) => void;
}) {
  const [level, setLevel] = useState<AiLevel>('normal');
  const [faction, setFaction] = useState<MatchConfig['playerFaction']>('dragon');
  const [firstMover, setFirstMover] = useState<MatchConfig['firstMover']>('random');

  return (
    <section className="game-panel">
      <h3>{title}</h3>
      <p className="panel-desc">{description}</p>
      <div className="panel-row">
        <span className="row-label">难度</span>
        <OptionGroup
          options={LEVELS.map((l) => ({ id: l, label: AI_LEVEL_LABELS[l] }))}
          value={level}
          onChange={setLevel}
        />
      </div>
      {showFaction && (
        <div className="panel-row">
          <span className="row-label">阵营</span>
          <OptionGroup
            options={[
              { id: 'dragon' as const, label: '执龙' },
              { id: 'tiger' as const, label: '执虎' },
              { id: 'random' as const, label: '随机' },
            ]}
            value={faction}
            onChange={setFaction}
          />
        </div>
      )}
      {showFirstMover && (
        <div className="panel-row">
          <span className="row-label">先手</span>
          <OptionGroup
            options={[
              { id: 'player' as const, label: '我先手' },
              { id: 'ai' as const, label: '电脑先手' },
              { id: 'random' as const, label: '随机' },
            ]}
            value={firstMover}
            onChange={setFirstMover}
          />
        </div>
      )}
      <button
        className="btn-primary panel-start"
        onClick={() => onStart({ ...defaultConfig, level, playerFaction: faction, firstMover })}
      >
        开始游戏
      </button>
    </section>
  );
}

/** 音乐 / 音效开关：偏好持久化在声音引擎里，这里只做展示态 */
function SoundToggles() {
  const [music, setMusic] = useState(isMusicOn);
  const [sfx, setSfx] = useState(isSfxOn);
  return (
    <div className="sound-toggles">
      <button
        className={`opt-btn ${music ? 'opt-active' : ''}`}
        onClick={() => {
          setMusicOn(!music);
          setMusic(!music);
        }}
      >
        音乐{music ? '开' : '关'}
      </button>
      <button
        className={`opt-btn ${sfx ? 'opt-active' : ''}`}
        onClick={() => {
          setSfxOn(!sfx);
          setSfx(!sfx);
        }}
      >
        音效{sfx ? '开' : '关'}
      </button>
    </div>
  );
}

export default function Lobby({ onStartCard, onStartBoard, onRules }: Props) {
  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>龙虎斗</h1>
        <p className="lobby-subtitle">源自传统洋牌的龙虎对决纸牌游戏</p>
      </header>
      <div className="lobby-panels">
        <GamePanel
          title="纸牌对拼"
          description="双方同时暗出一张牌，按克制关系定胜负，三局两胜。"
          showFaction
          onStart={onStartCard}
        />
        <GamePanel
          title="棋盘翻棋"
          description="16 张牌暗置于 4×4 棋盘，翻牌、行棋、吃子。"
          showFirstMover
          onStart={onStartBoard}
        />
      </div>
      <footer className="lobby-footer">
        <button className="btn-plain" onClick={onRules}>1分钟掌握游戏规则</button>
        <SoundToggles />
      </footer>
    </div>
  );
}
