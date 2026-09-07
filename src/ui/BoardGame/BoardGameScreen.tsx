import { useEffect, useMemo, useRef, useState } from 'react';
import { requestBoardMove } from '../../ai/aiClient';
import type { BoardAction, BoardGameState, PlayerSlot } from '../../core/boardGame';
import {
  QUIET_MOVES_FOR_DRAW,
  adjacentIndices,
  applyAction,
  createBoardGame,
  currentFaction,
  getLegalActions,
  otherSlot,
  surrenderBoard,
} from '../../core/boardGame';
import { createLogger } from '../../core/logger';
import { canCapture } from '../../core/rules';
import type { Faction } from '../../core/types';
import { otherFaction } from '../../core/types';
import CardView from '../CardView';
import type { MatchConfig } from '../config';

const log = createLogger('ui');

/** 静步数达到这些阈值时弹窗提醒（满 QUIET_MOVES_FOR_DRAW 判和） */
export const QUIET_WARN_THRESHOLDS = [14, 18];

interface Props {
  config: MatchConfig;
  onExit: () => void;
}

function pickAiSlot(config: MatchConfig): PlayerSlot {
  if (config.firstMover === 'player') return 'second';
  if (config.firstMover === 'ai') return 'first';
  return Math.random() < 0.5 ? 'first' : 'second';
}

function factionName(f: Faction | null): string {
  if (f === null) return '';
  return f === 'dragon' ? '龙方' : '虎方';
}

export default function BoardGameScreen({ config, onExit }: Props) {
  const [aiSlot, setAiSlot] = useState<PlayerSlot>(() => pickAiSlot(config));
  const [game, setGame] = useState<BoardGameState>(() => createBoardGame());
  const [selected, setSelected] = useState<number | null>(null);
  const [lastAction, setLastAction] = useState<BoardAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** 战绩按玩家/电脑累计，而不是按龙虎——棋盘每局的阵营由首翻决定，局与局之间会变 */
  const [score, setScore] = useState({ player: 0, ai: 0, draw: 0 });
  const [surrenderAsk, setSurrenderAsk] = useState(false);
  const [exitAsk, setExitAsk] = useState(false);
  /** 静步预警弹窗当前展示的静步数（null 表示不显示） */
  const [quietNotice, setQuietNotice] = useState<number | null>(null);
  /** 本局已提醒过的阈值，换局时重置 */
  const warnedThresholds = useRef(new Set<number>());

  useEffect(() => {
    log.info('进入棋盘对局', { 难度: config.level, 电脑席位: aiSlot });
    // 仅在首次进入时记录，后续换局由 newGame 自行记录
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAiTurn = game.outcome === null && game.current === aiSlot;
  const legalActions = useMemo(() => getLegalActions(game), [game]);
  const myFaction = currentFaction(game);
  const gameOver = game.outcome !== null;

  /** 玩家执的阵营（阵营未定时为 null） */
  const playerFaction: Faction | null = game.factions[otherSlot(aiSlot)];

  const moveTargets = useMemo(() => {
    if (selected === null) return new Set<number>();
    return new Set(
      legalActions
        .filter((a) => a.type === 'move' && a.from === selected)
        .map((a) => (a.type === 'move' ? a.to : -1)),
    );
  }, [legalActions, selected]);

  // 静步预警：达到阈值时弹窗提示，双方（含电脑）触发都提醒
  useEffect(() => {
    if (game.outcome !== null) return;
    for (const threshold of QUIET_WARN_THRESHOLDS) {
      if (game.quietMoves >= threshold && !warnedThresholds.current.has(threshold)) {
        warnedThresholds.current.add(threshold);
        setQuietNotice(game.quietMoves);
        log.info('静步预警', { 已静步: game.quietMoves, 判和阈值: QUIET_MOVES_FOR_DRAW });
        break;
      }
    }
  }, [game.quietMoves, game.outcome]);

  function bumpScore(next: BoardGameState) {
    if (next.outcome === null) return;
    if (next.outcome === 'draw') {
      setScore((s) => ({ ...s, draw: s.draw + 1 }));
      return;
    }
    // 必须用 next 的阵营表判断胜方是谁：阵营是本局翻出来的，闭包里的 game 可能还没定阵营
    const key: 'player' | 'ai' = next.outcome === next.factions[otherSlot(aiSlot)] ? 'player' : 'ai';
    setScore((s) => ({ ...s, [key]: s[key] + 1 }));
  }

  function perform(action: BoardAction) {
    const next = applyAction(game, action);
    setGame(next);
    setSelected(null);
    setLastAction(action);
    setMessage(null);
    bumpScore(next);
  }

  // AI 行棋：小工具容器禁用 Worker，搜索在主线程跑（有墙钟预算封顶，
  // 且 requestBoardMove 会先让出一帧，保证"思考中"提示先画出来），
  // 另外保证至少停顿片刻更自然
  useEffect(() => {
    if (!isAiTurn) return;
    let cancelled = false;
    const started = Date.now();
    (async () => {
      const action = await requestBoardMove(game, config.level);
      const wait = Math.max(0, 650 - (Date.now() - started));
      await new Promise((r) => window.setTimeout(r, wait));
      if (cancelled) return;
      const next = applyAction(game, action);
      setGame(next);
      setSelected(null);
      setLastAction(action);
      bumpScore(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, isAiTurn]);

  function explainIllegal(from: number, to: number) {
    const piece = game.board[from];
    const target = game.board[to];
    let reason: string;
    if (!adjacentIndices(from).includes(to)) {
      reason = '只能移动到上下左右相邻的一格';
    } else if (target && !target.faceUp) {
      reason = '暗牌不可被吃，需先翻开';
    } else if (target && piece && !canCapture(piece.card.rank, target.card.rank)) {
      reason = '克制关系不允许：这张牌吃不动对方';
    } else if (target === null) {
      reason = '禁止循环：不得连续第 3 次在相同两格间往返，请改走其他着法';
    } else {
      reason = '该着法不合法';
    }
    setMessage(reason);
    log.warn('玩家着法被拦截', {
      从: from,
      到: to,
      棋子: piece?.faceUp ? `${piece.card.faction}${piece.card.rank}` : '无',
      原因: reason,
    });
  }

  function onCellClick(i: number) {
    if (gameOver || isAiTurn) return;
    const cell = game.board[i];

    if (cell && !cell.faceUp) {
      perform({ type: 'flip', index: i });
      return;
    }
    if (cell && cell.faceUp && myFaction !== null && cell.card.faction === myFaction) {
      setSelected(selected === i ? null : i);
      setMessage(null);
      return;
    }
    if (selected !== null) {
      const legal = legalActions.some((a) => a.type === 'move' && a.from === selected && a.to === i);
      if (legal) {
        perform({ type: 'move', from: selected, to: i });
      } else {
        explainIllegal(selected, i);
      }
    }
  }

  function doSurrender() {
    if (playerFaction === null) return;
    log.info('玩家认输', { 认输方: playerFaction });
    const next = surrenderBoard(game, playerFaction);
    setGame(next);
    setSelected(null);
    setSurrenderAsk(false);
    setMessage(null);
    bumpScore(next);
  }

  /** 返回大厅：对局进行中先确认，防止误点 */
  function requestExit() {
    if (gameOver) {
      onExit();
    } else {
      setExitAsk(true);
    }
  }

  function newGame() {
    const slot = pickAiSlot(config);
    log.info('棋盘换新局', { 电脑席位: slot });
    setAiSlot(slot);
    setGame(createBoardGame());
    setSelected(null);
    setLastAction(null);
    setMessage(null);
    setSurrenderAsk(false);
    setQuietNotice(null);
    warnedThresholds.current = new Set();
  }

  /** 座次由外层的"先手：/后手："前缀给出，这里只说阵营和执子的人，手机上才放得下一行 */
  function slotLabel(slot: PlayerSlot): string {
    const f = game.factions[slot];
    const who = slot === aiSlot ? '电脑' : '玩家';
    return `${f !== null ? factionName(f) : '阵营未定'} · ${who}`;
  }

  function endReasonText(): string {
    if (game.outcome === null) return '';
    const loser = game.outcome === 'draw' ? null : otherFaction(game.outcome);
    switch (game.endReason) {
      case 'wipeout':
        return `${factionName(loser)}子力全灭`;
      case 'mutualWipeout':
        return '双方最后一子同归于尽';
      case 'stalemate':
        return `${factionName(loser)}无着可走（困毙）`;
      case 'quietDraw':
        return `连续 ${QUIET_MOVES_FOR_DRAW} 步无翻牌无吃子`;
      case 'surrender':
        return `${factionName(loser)}认输`;
      default:
        return '';
    }
  }

  // 认输按钮：玩家阵营确定后才可用
  const canSurrender = !gameOver && playerFaction !== null;

  const tracker = game.repetition[game.current];
  const repetitionWarning = tracker !== null && tracker.count >= 4 && !isAiTurn && !gameOver;

  const capturedByFaction: Record<Faction, typeof game.captured> = {
    dragon: game.captured.filter((c) => c.faction === 'dragon'),
    tiger: game.captured.filter((c) => c.faction === 'tiger'),
  };

  const lastCells = new Set<number>(
    lastAction === null
      ? []
      : lastAction.type === 'flip'
        ? [lastAction.index]
        : [lastAction.from, lastAction.to],
  );

  return (
    <div className="game-screen">
      <header className="topbar topbar-centered">
        <button className="btn-plain" onClick={requestExit}>← 返回大厅</button>
        <h2>棋盘翻棋</h2>
        <div className="topbar-actions">
          {canSurrender && (
            <button className="btn-plain btn-danger" onClick={() => setSurrenderAsk(true)}>
              认输
            </button>
          )}
        </div>
      </header>

      <div className="board-status">
        {/* 先手/后手并作一行，战绩另起一行：手机上三块并排会折成三行 */}
        <div className="status-row">
          <span className={`faction-tag ${game.current === 'first' ? 'tag-seat-active' : ''} tag-seat`}>
            先手：{slotLabel('first')}
          </span>
          <span className={`faction-tag ${game.current === 'second' ? 'tag-seat-active' : ''} tag-seat`}>
            后手：{slotLabel('second')}
          </span>
        </div>
        <div className="score-row">
          <span className="score-tag">
            战绩：玩家 {score.player} 胜 · 电脑 {score.ai} 胜 · 和 {score.draw}
          </span>
        </div>
        {!gameOver && (
          <p className="turn-banner">
            {isAiTurn
              ? '电脑思考中……'
              : myFaction === null
                ? '请翻开一张暗牌，定你的阵营'
                : `轮到${factionName(myFaction)}：翻牌，移动 或 吃子`}
          </p>
        )}
        {repetitionWarning && (
          <p className="warn-banner">该子再往返一步构成第 3 次循环，需改走别处</p>
        )}
        {message && !gameOver && <p className="warn-banner">{message}</p>}
      </div>

      <div className="board-wrap">
        {/* 无损失时整块不渲染：开局就摆两个空面板纯占高度 */}
        {capturedByFaction.dragon.length > 0 && (
          <div className="captured-col">
            <span className="lost-label">龙方损失</span>
            {capturedByFaction.dragon.map((c) => (
              <CardView key={`${c.faction}-${c.rank}`} size="sm" card={c} dimmed />
            ))}
          </div>
        )}

        <div className="board-grid">
          {game.board.map((cell, i) => {
            const classes = ['board-cell'];
            if (selected === i) classes.push('cell-selected');
            if (moveTargets.has(i)) classes.push('cell-target');
            if (lastCells.has(i)) classes.push('cell-last');
            return (
              <div key={i} className={classes.join(' ')} onClick={() => onCellClick(i)}>
                {cell && (
                  <CardView
                    size="md"
                    card={cell.faceUp ? cell.card : undefined}
                    faceDown={!cell.faceUp}
                    selected={selected === i}
                  />
                )}
                {moveTargets.has(i) && <span className="target-dot" />}
              </div>
            );
          })}
        </div>

        {capturedByFaction.tiger.length > 0 && (
          <div className="captured-col">
            <span className="lost-label">虎方损失</span>
            {capturedByFaction.tiger.map((c) => (
              <CardView key={`${c.faction}-${c.rank}`} size="sm" card={c} dimmed />
            ))}
          </div>
        )}
      </div>

      {gameOver && (
        <div className="overlay">
          <div className="overlay-panel">
            <h3>{game.outcome === 'draw' ? '和局' : `${factionName(game.outcome as Faction)}获胜！`}</h3>
            {endReasonText() && <p className="result-reason">{endReasonText()}</p>}
            <div className="overlay-actions">
              <button className="btn-primary" onClick={newGame}>再来一局</button>
              <button className="btn-plain" onClick={onExit}>返回大厅</button>
            </div>
          </div>
        </div>
      )}

      {quietNotice !== null && (
        <div className="overlay">
          <div className="overlay-panel">
            <h3>和棋预警</h3>
            <p>
              双方已连续 {quietNotice} 步无翻牌、无吃子，达到 {QUIET_MOVES_FOR_DRAW} 步将自动判为和棋。
            </p>
            <div className="overlay-actions">
              <button className="btn-primary" onClick={() => setQuietNotice(null)}>知道了</button>
            </div>
          </div>
        </div>
      )}

      {surrenderAsk && !gameOver && (
        <div className="overlay">
          <div className="overlay-panel">
            <h3>确认认输？</h3>
            <p>认输后本局立即判负，计入战绩。</p>
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
            <p>对局尚未结束，返回大厅将强制退出本局，进度不会保留。</p>
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
