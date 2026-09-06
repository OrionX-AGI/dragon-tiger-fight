import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerSlot } from '../core/boardGame';
import { QUIET_MOVES_FOR_DRAW, adjacentIndices, getLegalActions } from '../core/boardGame';
import { QUIET_WARN_THRESHOLDS } from '../ui/BoardGame/BoardGameScreen';
import { canCapture } from '../core/rules';
import type { Faction } from '../core/types';
import { otherFaction } from '../core/types';
import CardView from '../ui/CardView';
import { pseudoBoardState } from './boardView';
import type { OnlineConnection } from './connection';
import type { BoardGameView, RoomView } from './protocol';
import { useCountdown } from './useCountdown';

interface Props {
  conn: OnlineConnection;
  room: RoomView;
  view: BoardGameView;
  connBanner: string | null;
  oppGraceMs: number | null;
  notice: string | null;
  onDismissNotice: () => void;
  onLeave: () => void;
}

function factionName(f: Faction | null): string {
  if (f === null) return '';
  return f === 'dragon' ? '龙方' : '虎方';
}

export default function OnlineBoardScreen({
  conn,
  room,
  view,
  connBanner,
  oppGraceMs,
  notice,
  onDismissNotice,
  onLeave,
}: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [surrenderAsk, setSurrenderAsk] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  /** 静步预警弹窗当前展示的静步数（null 表示不显示） */
  const [quietNotice, setQuietNotice] = useState<number | null>(null);
  /** 本局已提醒过的阈值，换局时重置 */
  const warnedThresholds = useRef(new Set<number>());
  const warnedGameIndex = useRef(view.gameIndex);
  const countdown = useCountdown(room.countdownRemainingMs);
  const oppGraceSec = useCountdown(oppGraceMs);

  // 静步预警：达到阈值时弹窗提示（双方各自在本端弹出）
  useEffect(() => {
    if (warnedGameIndex.current !== view.gameIndex) {
      warnedGameIndex.current = view.gameIndex;
      warnedThresholds.current = new Set();
      setQuietNotice(null);
    }
    if (view.outcome !== null) return;
    for (const threshold of QUIET_WARN_THRESHOLDS) {
      if (view.quietMoves >= threshold && !warnedThresholds.current.has(threshold)) {
        warnedThresholds.current.add(threshold);
        setQuietNotice(view.quietMoves);
        break;
      }
    }
  }, [view.quietMoves, view.outcome, view.gameIndex]);

  const gameOver = view.outcome !== null;
  const isMyTurn = !gameOver && view.current === view.yourSlot;
  const myFaction = view.factions[view.yourSlot];
  const mySeat = room.yourSeat;
  const oppSeat = mySeat === 0 ? 1 : 0;
  const myName = room.seats[mySeat]?.name ?? '你';
  const oppName = room.seats[oppSeat]?.name ?? '对方';

  const pseudo = useMemo(() => pseudoBoardState(view), [view]);
  const legalActions = useMemo(() => (isMyTurn ? getLegalActions(pseudo) : []), [pseudo, isMyTurn]);

  const moveTargets = useMemo(() => {
    if (selected === null) return new Set<number>();
    return new Set(
      legalActions
        .filter((a) => a.type === 'move' && a.from === selected)
        .map((a) => (a.type === 'move' ? a.to : -1)),
    );
  }, [legalActions, selected]);

  function explainIllegal(from: number, to: number) {
    const piece = view.board[from];
    const target = view.board[to];
    let reason: string;
    if (!adjacentIndices(from).includes(to)) {
      reason = '只能移动到上下左右相邻的一格';
    } else if (target && !target.faceUp) {
      reason = '暗牌不可被吃，需先翻开';
    } else if (target?.card && piece?.card && !canCapture(piece.card.rank, target.card.rank)) {
      reason = '克制关系不允许：这张牌吃不动对方';
    } else if (target === null) {
      reason = '禁止循环：不得连续第 3 次在相同两格间往返，请改走其他着法';
    } else {
      reason = '该着法不合法';
    }
    setMessage(reason);
  }

  function onCellClick(i: number) {
    if (!isMyTurn || connBanner !== null) return;
    const cell = view.board[i];

    if (cell && !cell.faceUp) {
      conn.send({ type: 'boardAction', action: { type: 'flip', index: i } });
      setSelected(null);
      setMessage(null);
      return;
    }
    if (cell && cell.faceUp && cell.card && myFaction !== null && cell.card.faction === myFaction) {
      setSelected(selected === i ? null : i);
      setMessage(null);
      return;
    }
    if (selected !== null) {
      const legal = legalActions.some((a) => a.type === 'move' && a.from === selected && a.to === i);
      if (legal) {
        conn.send({ type: 'boardAction', action: { type: 'move', from: selected, to: i } });
        setSelected(null);
        setMessage(null);
      } else {
        explainIllegal(selected, i);
      }
    }
  }

  function slotLabel(slot: PlayerSlot): string {
    const f = view.factions[slot];
    const seat = slot === 'first' ? '先手' : '后手';
    const who = slot === view.yourSlot ? `${myName} · 你` : oppName;
    const parts = [f !== null ? factionName(f) : '阵营未定', seat, who];
    return parts.join(' · ');
  }

  function endReasonText(): string {
    if (view.outcome === null) return '';
    const loser = view.outcome === 'draw' ? null : otherFaction(view.outcome);
    switch (view.endReason) {
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
      case 'abandon':
        return myFaction !== null && view.outcome === myFaction ? '对方离场或掉线，判你获胜' : '离场判负';
      default:
        return '';
    }
  }

  const tracker = view.repetition[view.current];
  const repetitionWarning = tracker !== null && tracker.count >= 4 && isMyTurn;

  const capturedByFaction: Record<Faction, typeof view.captured> = {
    dragon: view.captured.filter((c) => c.faction === 'dragon'),
    tiger: view.captured.filter((c) => c.faction === 'tiger'),
  };

  const lastCells = new Set<number>(
    view.lastAction === null
      ? []
      : view.lastAction.type === 'flip'
        ? [view.lastAction.index]
        : [view.lastAction.from, view.lastAction.to],
  );

  const myReady = room.seats[mySeat]?.ready ?? false;
  const oppReady = room.seats[oppSeat]?.ready ?? false;
  const oppPresent = room.seats[oppSeat] !== null;
  const canSurrender = !gameOver && myFaction !== null;

  const iWon = view.outcome !== null && view.outcome !== 'draw' && myFaction !== null && view.outcome === myFaction;

  return (
    <div className="game-screen">
      <header className="topbar topbar-centered">
        <button className="btn-plain" onClick={() => setLeaveAsk(true)}>← 离开牌桌</button>
        <h2>棋盘翻棋 · 在线</h2>
        <div className="topbar-actions">
          {canSurrender && (
            <button className="btn-plain btn-danger" onClick={() => setSurrenderAsk(true)}>
              认输
            </button>
          )}
        </div>
      </header>

      {connBanner && <p className="warn-banner">{connBanner}</p>}
      {oppGraceMs !== null && (
        <p className="warn-banner">对方掉线，等待重连{oppGraceSec !== null ? `（${oppGraceSec} 秒后判胜）` : ''}……</p>
      )}
      {notice && (
        <p className="warn-banner online-notice" onClick={onDismissNotice}>
          {notice}（点击关闭）
        </p>
      )}

      <div className="board-status">
        <div className="status-row">
          <span className={`faction-tag ${view.current === 'first' ? 'tag-seat-active' : ''} tag-seat`}>
            先手：{slotLabel('first')}
          </span>
          <span className="score-tag">
            战绩　你 {room.wins[mySeat]} : {room.wins[oppSeat]} {oppName} · 和 {room.draws}
          </span>
          <span className={`faction-tag ${view.current === 'second' ? 'tag-seat-active' : ''} tag-seat`}>
            后手：{slotLabel('second')}
          </span>
        </div>
        {!gameOver && (
          <p className="turn-banner">
            {isMyTurn
              ? myFaction === null
                ? '轮到你：请翻开一张暗牌（翻出的阵营就是你本局的阵营）'
                : `轮到你（${factionName(myFaction)}）：点暗牌翻开，或点己方明牌选中后移动 / 吃子`
              : `等待 ${oppName} 行棋……`}
          </p>
        )}
        {repetitionWarning && (
          <p className="warn-banner">警告：该棋子再往返一步将构成第 3 次循环，届时必须改走其他着法</p>
        )}
        {message && !gameOver && <p className="warn-banner">{message}</p>}
        {gameOver && (
          <div className="result-panel board-result">
            <h3 className="result-title">
              {view.outcome === 'draw' ? '和局' : iWon ? '你获胜了！' : `${oppName} 获胜`}
            </h3>
            {endReasonText() && <p className="result-reason">{endReasonText()}</p>}
            {countdown !== null && <p className="result-reason">倒计时 {countdown} 秒，超时未准备将被移出房间</p>}
            {oppPresent && oppReady && !myReady && <p className="result-reason">{oppName} 已准备再来一局</p>}
            <div className="overlay-actions">
              <button
                className="btn-primary"
                disabled={!oppPresent || connBanner !== null}
                onClick={() => conn.send({ type: 'setReady', ready: !myReady })}
              >
                {myReady ? '取消准备' : oppPresent ? '再来一局（准备）' : '等待新对手……'}
              </button>
              <button className="btn-plain" onClick={() => setLeaveAsk(true)}>离开牌桌</button>
            </div>
          </div>
        )}
      </div>

      <div className="board-wrap">
        <div className="captured-col">
          <span className="lost-label">龙方损失</span>
          {capturedByFaction.dragon.map((c) => (
            <CardView key={`${c.faction}-${c.rank}`} size="sm" card={c} dimmed />
          ))}
        </div>

        <div className="board-grid">
          {view.board.map((cell, i) => {
            const classes = ['board-cell'];
            if (selected === i) classes.push('cell-selected');
            if (moveTargets.has(i)) classes.push('cell-target');
            if (lastCells.has(i)) classes.push('cell-last');
            return (
              <div key={i} className={classes.join(' ')} onClick={() => onCellClick(i)}>
                {cell && (
                  <CardView
                    size="md"
                    card={cell.faceUp && cell.card ? cell.card : undefined}
                    faceDown={!cell.faceUp}
                    selected={selected === i}
                  />
                )}
                {moveTargets.has(i) && <span className="target-dot" />}
              </div>
            );
          })}
        </div>

        <div className="captured-col">
          <span className="lost-label">虎方损失</span>
          {capturedByFaction.tiger.map((c) => (
            <CardView key={`${c.faction}-${c.rank}`} size="sm" card={c} dimmed />
          ))}
        </div>
      </div>

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
              <button
                className="btn-primary"
                onClick={() => {
                  conn.send({ type: 'surrender' });
                  setSurrenderAsk(false);
                }}
              >
                确认认输
              </button>
              <button className="btn-plain" onClick={() => setSurrenderAsk(false)}>再想想</button>
            </div>
          </div>
        </div>
      )}

      {leaveAsk && (
        <div className="overlay">
          <div className="overlay-panel">
            <h3>离开牌桌？</h3>
            <p>{gameOver ? '离开后席位将被释放。' : '对局尚未结束，离开将直接判负。'}</p>
            <div className="overlay-actions">
              <button className="btn-primary" onClick={onLeave}>确认离开</button>
              <button className="btn-plain" onClick={() => setLeaveAsk(false)}>留下</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
