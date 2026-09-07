import { useEffect, useRef, useState } from 'react';
import { prepareCardAi, requestCardMove } from '../../ai/aiClient';
import { AI_LEVEL_LABELS } from '../../ai/cardAI';
import { playSfx } from '../../audio/sound';
import type { CardGameState, RoundRecord } from '../../core/cardGame';
import { createCardGame, playRound, surrender } from '../../core/cardGame';
import { createLogger } from '../../core/logger';
import type { Faction, Rank } from '../../core/types';
import { otherFaction } from '../../core/types';
import { cardInfo, longhuTheme } from '../../themes/longhu';
import CardView from '../CardView';
import type { MatchConfig } from '../config';

const log = createLogger('ui');

type Phase = 'preview' | 'pick' | 'waiting' | 'reveal';

/** 开局明牌亮相时长 */
const PREVIEW_MS = 2600;
/** 依次扣暗的波浪间隔 */
const HIDE_STAGGER_MS = 110;
const DISCARD_KEY = 'longhu:showDiscard';
/** 三局两胜：先胜此局数者赢下整轮 */
const SERIES_TARGET = 2;
/** 局间自动开始下一局的等待秒数 */
const NEXT_GAME_DELAY_S = 5;
/** 回合揭示后自动进入下一回合的等待秒数 */
const REVEAL_AUTO_S = 3;

interface Props {
  config: MatchConfig;
  onExit: () => void;
}

function roundSummary(r: RoundRecord): string {
  const d = cardInfo(longhuTheme, { faction: 'dragon', rank: r.dragon }).name;
  const t = cardInfo(longhuTheme, { faction: 'tiger', rank: r.tiger }).name;
  if (r.winner === 'both') return `${d} 与 ${t} 同归于尽`;
  if (r.winner === 'dragon') return `${d} 吃掉 ${t}`;
  return `${t} 吃掉 ${d}`;
}

function factionName(f: Faction): string {
  return f === 'dragon' ? '龙方' : '虎方';
}

function readShowDiscard(): boolean {
  try {
    return localStorage.getItem(DISCARD_KEY) === '1';
  } catch {
    return false;
  }
}

export default function CardGameScreen({ config, onExit }: Props) {
  /** 玩家阵营：随机只在进局时抽一次，整轮系列生效 */
  const [playerFaction] = useState<Faction>(() =>
    config.playerFaction === 'random'
      ? Math.random() < 0.5
        ? 'dragon'
        : 'tiger'
      : config.playerFaction,
  );
  const aiFaction = otherFaction(playerFaction);

  const [game, setGame] = useState<CardGameState>(() => createCardGame());
  const [gameIndex, setGameIndex] = useState(0);
  const [score, setScore] = useState({ player: 0, ai: 0, draw: 0 });
  const [phase, setPhase] = useState<Phase>('preview');
  const [selected, setSelected] = useState<Rank | null>(null);
  const [hideWave, setHideWave] = useState(false);
  const [showDiscard, setShowDiscard] = useState(readShowDiscard);
  const [surrenderAsk, setSurrenderAsk] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [exitAsk, setExitAsk] = useState(false);
  /** 局间倒计时剩余秒数（null 表示不在局间） */
  const [nextGameLeft, setNextGameLeft] = useState<number | null>(null);
  /** 回合揭示后自动进入下一回合的剩余秒数 */
  const [revealLeft, setRevealLeft] = useState<number | null>(null);

  /** 递增序号：换局 / 认输时使进行中的异步回合作废 */
  const roundSeq = useRef(0);
  /** 已计入战绩的局号，防止重复累计 */
  const scoredGame = useRef(-1);

  const gameOver = game.outcome !== null;
  const seriesOver = score.player >= SERIES_TARGET || score.ai >= SERIES_TARGET;
  /** 已结束的局数（本轮系列内） */
  const finishedGames = score.player + score.ai + score.draw;

  useEffect(() => {
    log.info('进入纸牌对局', { 难度: config.level, 玩家阵营: playerFaction, 赛制: '三局两胜' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 预热 AI 求解器（值表在 Worker 里预计算）
  useEffect(() => {
    let cancelled = false;
    prepareCardAi().then(() => {
      if (!cancelled) setAiReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 每局开始：先明牌亮相几秒，再依次扣暗进入选牌
  useEffect(() => {
    const t1 = window.setTimeout(() => {
      setHideWave(true);
      setPhase('pick');
    }, PREVIEW_MS);
    const t2 = window.setTimeout(() => setHideWave(false), PREVIEW_MS + 8 * HIDE_STAGGER_MS + 700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [gameIndex]);

  // 对局结束时累计战绩（无论因打空还是认输结束）
  useEffect(() => {
    if (game.outcome === null || scoredGame.current === gameIndex) return;
    scoredGame.current = gameIndex;
    const key = game.outcome === 'draw' ? 'draw' : game.outcome === playerFaction ? 'player' : 'ai';
    setScore((s) => ({ ...s, [key]: s[key as keyof typeof s] + 1 }));
  }, [game.outcome, gameIndex, playerFaction]);

  // 局间倒计时：单局结束且系列未定时，5 秒后自动开始下一局
  useEffect(() => {
    if (!gameOver || seriesOver || scoredGame.current !== gameIndex) {
      setNextGameLeft(null);
      return;
    }
    setNextGameLeft(NEXT_GAME_DELAY_S);
    const deadline = Date.now() + NEXT_GAME_DELAY_S * 1000;
    const timer = window.setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) {
        window.clearInterval(timer);
        newGame();
      } else {
        setNextGameLeft(left);
      }
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver, seriesOver, gameIndex, score]);

  // 回合揭示后倒计时自动进入下一回合，保证局内连贯（也可点按钮立即继续）
  useEffect(() => {
    if (phase !== 'reveal' || gameOver) {
      setRevealLeft(null);
      return;
    }
    setRevealLeft(REVEAL_AUTO_S);
    const deadline = Date.now() + REVEAL_AUTO_S * 1000;
    const timer = window.setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) {
        window.clearInterval(timer);
        setPhase('pick');
      } else {
        setRevealLeft(left);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, gameOver]);

  const lastRound = game.history.length > 0 ? game.history[game.history.length - 1] : null;
  const picking = phase === 'pick' && !gameOver;

  function resolveRound(dragonCard: Rank, tigerCard: Rank) {
    // waiting 阶段没有别的状态更新入口（认输经 roundSeq 使本回合作废），
    // 闭包里的 game 就是当前局面，直接算出 next 以便根据结果配音效
    const next = playRound(game, dragonCard, tigerCard);
    setGame(next);
    setSelected(null);
    setPhase('reveal');

    // 音效延迟到翻牌动画（约 0.55s）转到正面的时刻
    const round = next.history[next.history.length - 1];
    const sfx =
      next.outcome === 'draw'
        ? 'draw'
        : next.outcome !== null
          ? next.outcome
          : round.winner === 'both'
            ? 'mutual'
            : round.winner;
    window.setTimeout(() => playSfx(sfx), 500);
  }

  async function confirmPick() {
    if (selected === null || !picking) return;
    log.info('玩家确认出牌', { 牌: selected });
    const picked = selected;
    const seq = ++roundSeq.current;
    setPhase('waiting');
    const [aiCard] = await Promise.all([
      requestCardMove([...game.hands[aiFaction]], [...game.hands[playerFaction]], config.level),
      new Promise((r) => window.setTimeout(r, 700)),
    ]);
    if (roundSeq.current !== seq) return; // 已换局或认输，本回合作废
    const dragonCard = playerFaction === 'dragon' ? picked : aiCard;
    const tigerCard = playerFaction === 'tiger' ? picked : aiCard;
    resolveRound(dragonCard, tigerCard);
  }

  function doSurrender() {
    roundSeq.current++;
    log.info('玩家认输', { 认输方: playerFaction });
    if (game.outcome === null) {
      setGame(surrender(game, playerFaction));
      playSfx(aiFaction); // 认输即对方获胜，播对方阵营的啸声
    }
    setSurrenderAsk(false);
    setSelected(null);
    setPhase('reveal');
  }

  function newGame() {
    roundSeq.current++;
    log.info('纸牌换新局', { 本轮第几局: finishedGames + 1 });
    setGame(createCardGame());
    setGameIndex((i) => i + 1);
    setSelected(null);
    setSurrenderAsk(false);
    setNextGameLeft(null);
    setPhase('preview');
  }

  function newSeries() {
    log.info('纸牌开始新一轮系列', {});
    setScore({ player: 0, ai: 0, draw: 0 });
    newGame();
  }

  /** 返回大厅：整轮系列未结束时先确认，防止误点 */
  function requestExit() {
    if (seriesOver) {
      onExit();
    } else {
      setExitAsk(true);
    }
  }

  function toggleDiscard() {
    const next = !showDiscard;
    setShowDiscard(next);
    try {
      localStorage.setItem(DISCARD_KEY, next ? '1' : '0');
    } catch {
      // 隐私模式下仅本次会话生效
    }
  }

  function factionLabel(f: Faction): string {
    const base = factionName(f);
    return f === aiFaction ? `${base}（电脑 · ${AI_LEVEL_LABELS[config.level]}）` : `${base}（你）`;
  }

  /** 该方手牌当前是否明牌 */
  function handFaceUp(f: Faction): boolean {
    if (phase === 'preview' || gameOver) return true;
    return f === playerFaction;
  }

  function endReasonText(): string {
    if (game.outcome === null) return '';
    if (game.endReason === 'surrender') {
      return game.outcome === 'draw' ? '' : `${factionName(otherFaction(game.outcome))}认输`;
    }
    if (game.endReason === 'bothEmpty') return '双方最后一轮同归于尽，握手言和';
    if (game.outcome !== 'draw') return `${factionName(otherFaction(game.outcome))}手牌已打空`;
    return '';
  }

  /** 中央出牌区某一方的展示 */
  function playSlot(f: Faction) {
    if (phase === 'reveal') {
      if (lastRound) {
        return <CardView size="lg" card={{ faction: f, rank: lastRound[f] }} />;
      }
      return <CardView size="lg" />;
    }
    if (phase === 'waiting') {
      return <CardView size="lg" faceDown pulse />;
    }
    if (f === playerFaction && selected !== null) return <CardView size="lg" faceDown />;
    return <CardView size="lg" />;
  }

  function handZone(f: Faction, position: 'top' | 'bottom') {
    const active = picking && f === playerFaction;
    const faceUp = handFaceUp(f);
    const hand = [...game.hands[f]].sort((a, b) => a - b);
    const lost = [...game.lost[f]].sort((a, b) => a - b);
    return (
      <div className={`hand-zone zone-${position} ${active ? 'zone-active' : ''}`}>
        <div className="zone-header">
          <span className={`faction-tag tag-${f}`}>{factionLabel(f)}</span>
          {phase === 'preview' && <span className="turn-hint">记牌时间：牌面即将扣暗</span>}
          {active && <span className="turn-hint">请选一张牌，然后点击"确定出牌"</span>}
        </div>
        <div className="hand-cards">
          {hand.map((rank, idx) => (
            <CardView
              key={rank}
              size="md"
              card={{ faction: f, rank }}
              faceDown={!faceUp}
              flipDelayMs={hideWave ? idx * HIDE_STAGGER_MS : undefined}
              selected={active && selected === rank}
              onClick={active ? () => setSelected(rank) : undefined}
            />
          ))}
        </div>
        {lost.length > 0 && (
          <div className="lost-row">
            <span className="lost-label">已被吃掉：</span>
            {showDiscard ? (
              lost.map((rank) => <CardView key={rank} size="sm" card={{ faction: f, rank }} dimmed />)
            ) : (
              <span className="lost-count">{lost.length} 张（点右上"查看弃牌"回看）</span>
            )}
          </div>
        )}
      </div>
    );
  }

  /** 结果面板（单局结束或整轮结束） */
  function resultPanel() {
    const playerWonGame = game.outcome === playerFaction;
    if (seriesOver) {
      const playerWonSeries = score.player >= SERIES_TARGET;
      return (
        <div className="result-panel">
          <h3 className="result-title">
            {playerWonSeries ? '你赢得本轮最终胜利！' : '电脑赢得本轮最终胜利'}
          </h3>
          <p className="result-reason">
            三局两胜 · 你 {score.player} : {score.ai} 电脑{score.draw > 0 ? ` · 和 ${score.draw}` : ''}
          </p>
          <div className="overlay-actions">
            <button className="btn-primary" onClick={newSeries}>再来一轮</button>
            <button className="btn-plain" onClick={onExit}>返回大厅</button>
          </div>
        </div>
      );
    }
    return (
      <div className="result-panel">
        {lastRound && game.endReason !== 'surrender' && (
          <p className="round-summary">{roundSummary(lastRound)}</p>
        )}
        <h3 className="result-title">
          {game.outcome === 'draw' ? `第 ${finishedGames} 局和局` : playerWonGame ? `第 ${finishedGames} 局你获胜！` : `第 ${finishedGames} 局电脑获胜`}
        </h3>
        {endReasonText() && <p className="result-reason">{endReasonText()}</p>}
        <p className="result-reason">
          比分 你 {score.player} : {score.ai} 电脑{score.draw > 0 ? ` · 和 ${score.draw}（和局不计胜场，加赛）` : ''}
          {nextGameLeft !== null && ` · ${nextGameLeft} 秒后自动开始下一局`}
        </p>
        <div className="overlay-actions">
          <button className="btn-primary" onClick={newGame}>开始下一局</button>
          <button className="btn-plain" onClick={requestExit}>返回大厅</button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-screen">
      <header className="topbar topbar-centered">
        <button className="btn-plain" onClick={requestExit}>← 返回大厅</button>
        <h2>纸牌对拼</h2>
        <div className="topbar-actions">
          <button className="btn-plain" onClick={toggleDiscard}>
            {showDiscard ? '隐藏弃牌' : '查看弃牌'}
          </button>
          {!gameOver && phase !== 'preview' && (
            <button className="btn-plain btn-danger" onClick={() => setSurrenderAsk(true)}>
              认输
            </button>
          )}
        </div>
      </header>

      <div className="score-row">
        <div className="score-tag">
          三局两胜　第 {gameOver ? finishedGames : finishedGames + 1} 局 · 你 {score.player} : {score.ai} 电脑 · 和 {score.draw}
        </div>
      </div>

      {handZone(aiFaction, 'top')}

      <div className="play-area">
        <div className="play-slot">
          <span className={`faction-tag tag-${aiFaction}`}>{aiFaction === 'dragon' ? '龙' : '虎'}</span>
          {playSlot(aiFaction)}
        </div>
        <div className="vs-block">
          {gameOver ? (
            resultPanel()
          ) : phase === 'reveal' ? (
            <>
              {lastRound && <p className="round-summary">{roundSummary(lastRound)}</p>}
              <button className="btn-primary" onClick={() => setPhase('pick')}>
                下一回合{revealLeft !== null ? `（${revealLeft} 秒后自动继续）` : ''}
              </button>
            </>
          ) : phase === 'waiting' ? (
            <p className="round-summary">双方亮牌……</p>
          ) : phase === 'preview' ? (
            <p className="round-summary">双方明牌亮相，请抓紧记牌……</p>
          ) : (
            <span className="vs-mark">对</span>
          )}
        </div>
        <div className="play-slot">
          <span className={`faction-tag tag-${playerFaction}`}>{playerFaction === 'dragon' ? '龙' : '虎'}</span>
          {playSlot(playerFaction)}
        </div>
      </div>

      {handZone(playerFaction, 'bottom')}

      {picking && (
        <div className="action-bar">
          <button
            className="btn-primary"
            disabled={selected === null || !aiReady}
            onClick={confirmPick}
          >
            {!aiReady ? 'AI 准备中……' : '确定出牌'}
          </button>
        </div>
      )}

      {surrenderAsk && !gameOver && (
        <div className="overlay">
          <div className="overlay-panel">
            <h3>确认认输？</h3>
            <p>认输后本局立即判负，计入比分。</p>
            <div className="overlay-actions">
              <button className="btn-primary" onClick={doSurrender}>确认认输</button>
              <button className="btn-plain" onClick={() => setSurrenderAsk(false)}>再想想</button>
            </div>
          </div>
        </div>
      )}

      {exitAsk && (
        <div className="overlay">
          <div className="overlay-panel">
            <h3>返回大厅？</h3>
            <p>本轮三局两胜尚未结束，返回大厅将强制退出，比分不会保留。</p>
            <div className="overlay-actions">
              <button className="btn-primary" onClick={onExit}>强制退出</button>
              <button className="btn-plain" onClick={() => setExitAsk(false)}>继续游戏</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
