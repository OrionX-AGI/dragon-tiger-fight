import { useState } from 'react';
import type { RoundRecord } from '../core/cardGame';
import type { Faction, Rank } from '../core/types';
import { otherFaction } from '../core/types';
import { cardInfo, longhuTheme } from '../themes/longhu';
import CardView from '../ui/CardView';
import type { OnlineConnection } from './connection';
import type { CardGameView, RoomView } from './protocol';
import { useCountdown } from './useCountdown';

interface Props {
  conn: OnlineConnection;
  room: RoomView;
  view: CardGameView;
  connBanner: string | null;
  oppGraceMs: number | null;
  notice: string | null;
  onDismissNotice: () => void;
  onLeave: () => void;
}

const DISCARD_KEY = 'longhu:showDiscard';

function factionName(f: Faction): string {
  return f === 'dragon' ? '龙方' : '虎方';
}

function roundSummary(r: RoundRecord): string {
  const d = cardInfo(longhuTheme, { faction: 'dragon', rank: r.dragon }).name;
  const t = cardInfo(longhuTheme, { faction: 'tiger', rank: r.tiger }).name;
  if (r.winner === 'both') return `${d} 与 ${t} 同归于尽`;
  if (r.winner === 'dragon') return `${d} 吃掉 ${t}`;
  return `${t} 吃掉 ${d}`;
}

function readShowDiscard(): boolean {
  try {
    return localStorage.getItem(DISCARD_KEY) === '1';
  } catch {
    return false;
  }
}

export default function OnlineCardScreen({
  conn,
  room,
  view,
  connBanner,
  oppGraceMs,
  notice,
  onDismissNotice,
  onLeave,
}: Props) {
  const [selected, setSelected] = useState<Rank | null>(null);
  const [surrenderAsk, setSurrenderAsk] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [showDiscard, setShowDiscard] = useState(readShowDiscard);
  const countdown = useCountdown(room.countdownRemainingMs);
  const nextGameSec = useCountdown(room.nextGameRemainingMs);
  const oppGraceSec = useCountdown(oppGraceMs);

  const myFaction = view.yourFaction;
  const oppFaction = otherFaction(myFaction);
  const gameOver = view.outcome !== null;
  const youCommitted = view.yourPick !== null;
  const mySeat = room.yourSeat;
  const oppSeat = mySeat === 0 ? 1 : 0;
  const myName = room.seats[mySeat]?.name ?? '你';
  const oppName = room.seats[oppSeat]?.name ?? '对方';
  const lastRound = view.history.length > 0 ? view.history[view.history.length - 1] : null;
  /** 本轮系列已结束的局数 */
  const finishedGames = room.wins[0] + room.wins[1] + room.draws;

  function pick(rank: Rank) {
    if (gameOver || youCommitted || connBanner !== null) return;
    setSelected(rank);
  }

  function confirmPick() {
    if (selected === null || youCommitted) return;
    conn.send({ type: 'cardPick', rank: selected });
    setSelected(null);
  }

  function toggleDiscard() {
    const next = !showDiscard;
    setShowDiscard(next);
    try {
      localStorage.setItem(DISCARD_KEY, next ? '1' : '0');
    } catch {
      // 忽略
    }
  }

  function endReasonText(): string {
    if (view.outcome === null) return '';
    if (view.endReason === 'abandon') {
      return view.outcome === myFaction ? '对方离场或掉线，判你获胜' : '你离场判负';
    }
    if (view.endReason === 'surrender') {
      return view.outcome === 'draw' ? '' : `${factionName(otherFaction(view.outcome))}认输`;
    }
    if (view.endReason === 'bothEmpty') return '双方最后一轮同归于尽，握手言和';
    if (view.outcome !== 'draw') return `${factionName(otherFaction(view.outcome))}手牌已打空`;
    return '';
  }

  function playSlot(f: Faction) {
    const committed = f === myFaction ? youCommitted : view.opponentCommitted;
    if (committed) return <CardView size="lg" faceDown pulse={f === oppFaction} />;
    if (f === myFaction && selected !== null) return <CardView size="lg" faceDown />;
    if (lastRound) return <CardView size="lg" card={{ faction: f, rank: lastRound[f] }} />;
    return <CardView size="lg" />;
  }

  function handZone(f: Faction, position: 'top' | 'bottom') {
    const mine = f === myFaction;
    const faceUp = mine || gameOver;
    const active = mine && !gameOver && !youCommitted;
    const hand = [...view.hands[f]].sort((a, b) => a - b);
    const lost = [...view.lost[f]].sort((a, b) => a - b);
    return (
      <div className={`hand-zone zone-${position} ${active ? 'zone-active' : ''}`}>
        <div className="zone-header">
          <span className={`faction-tag tag-${f}`}>
            {factionName(f)}（{mine ? `${myName} · 你` : oppName}）
          </span>
          {active && <span className="turn-hint">请选一张牌，然后点击"确定出牌"</span>}
          {mine && youCommitted && !gameOver && <span className="turn-hint">已出牌，等待对方……</span>}
        </div>
        <div className="hand-cards">
          {hand.map((rank) => (
            <CardView
              key={rank}
              size="md"
              card={{ faction: f, rank }}
              faceDown={!faceUp}
              selected={active && selected === rank}
              onClick={active ? () => pick(rank) : undefined}
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

  const myReady = room.seats[mySeat]?.ready ?? false;
  const oppReady = room.seats[oppSeat]?.ready ?? false;
  const oppPresent = room.seats[oppSeat] !== null;

  return (
    <div className="game-screen">
      <header className="topbar topbar-centered">
        <button className="btn-plain" onClick={() => setLeaveAsk(true)}>← 离开牌桌</button>
        <h2>纸牌对拼 · 在线</h2>
        <div className="topbar-actions">
          <button className="btn-plain" onClick={toggleDiscard}>
            {showDiscard ? '隐藏弃牌' : '查看弃牌'}
          </button>
          {!gameOver && (
            <button className="btn-plain btn-danger" onClick={() => setSurrenderAsk(true)}>
              认输
            </button>
          )}
        </div>
      </header>

      <div className="score-row">
        <div className="score-tag">
          三局两胜　第 {gameOver ? finishedGames : finishedGames + 1} 局 · 你 {room.wins[mySeat]} :{' '}
          {room.wins[oppSeat]} {oppName} · 和 {room.draws}
        </div>
      </div>

      {connBanner && <p className="warn-banner">{connBanner}</p>}
      {oppGraceMs !== null && (
        <p className="warn-banner">对方掉线，等待重连{oppGraceSec !== null ? `（${oppGraceSec} 秒后判胜）` : ''}……</p>
      )}
      {notice && (
        <p className="warn-banner online-notice" onClick={onDismissNotice}>
          {notice}（点击关闭）
        </p>
      )}

      {handZone(oppFaction, 'top')}

      <div className="play-area">
        <div className="play-slot">
          <span className={`faction-tag tag-${oppFaction}`}>{oppFaction === 'dragon' ? '龙' : '虎'}</span>
          {playSlot(oppFaction)}
        </div>
        <div className="vs-block">
          {gameOver ? (
            <div className="result-panel">
              {lastRound && view.endReason !== 'surrender' && view.endReason !== 'abandon' && (
                <p className="round-summary">{roundSummary(lastRound)}</p>
              )}
              <h3 className="result-title">
                {room.seriesOver
                  ? room.wins[mySeat] > room.wins[oppSeat]
                    ? '你赢得本轮最终胜利！'
                    : `${oppName} 赢得本轮最终胜利`
                  : view.outcome === 'draw'
                    ? `第 ${finishedGames} 局和局（不计胜场，加赛）`
                    : view.outcome === myFaction
                      ? `第 ${finishedGames} 局你获胜！`
                      : `第 ${finishedGames} 局 ${oppName} 获胜`}
              </h3>
              {endReasonText() && <p className="result-reason">{endReasonText()}</p>}
              <p className="result-reason">
                三局两胜 · 你 {room.wins[mySeat]} : {room.wins[oppSeat]} {oppName}
                {room.draws > 0 ? ` · 和 ${room.draws}` : ''}
              </p>
              {room.seriesOver ? (
                <>
                  {countdown !== null && (
                    <p className="result-reason">倒计时 {countdown} 秒，超时未准备将被移出房间</p>
                  )}
                  {oppPresent && oppReady && !myReady && <p className="result-reason">{oppName} 已准备再来一轮</p>}
                  <div className="overlay-actions">
                    <button
                      className="btn-primary"
                      disabled={!oppPresent || connBanner !== null}
                      onClick={() => conn.send({ type: 'setReady', ready: !myReady })}
                    >
                      {myReady ? '取消准备' : oppPresent ? '再来一轮（准备）' : '等待新对手……'}
                    </button>
                    <button className="btn-plain" onClick={() => setLeaveAsk(true)}>离开牌桌</button>
                  </div>
                </>
              ) : (
                <>
                  {nextGameSec !== null && (
                    <p className="result-reason">{nextGameSec} 秒后自动开始下一局</p>
                  )}
                  <div className="overlay-actions">
                    <button
                      className="btn-primary"
                      disabled={!oppPresent || connBanner !== null || room.nextGameRemainingMs === null}
                      onClick={() => conn.send({ type: 'nextGame' })}
                    >
                      开始下一局
                    </button>
                    <button className="btn-plain" onClick={() => setLeaveAsk(true)}>离开牌桌</button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {lastRound && <p className="round-summary">{roundSummary(lastRound)}</p>}
              {youCommitted ? (
                <p className="round-summary">等待{oppName}出牌……</p>
              ) : lastRound === null ? (
                <span className="vs-mark">对</span>
              ) : (
                <p className="turn-hint">请出下一张牌</p>
              )}
            </>
          )}
        </div>
        <div className="play-slot">
          <span className={`faction-tag tag-${myFaction}`}>{myFaction === 'dragon' ? '龙' : '虎'}</span>
          {playSlot(myFaction)}
        </div>
      </div>

      {handZone(myFaction, 'bottom')}

      {!gameOver && !youCommitted && (
        <div className="action-bar">
          <button className="btn-primary" disabled={selected === null || connBanner !== null} onClick={confirmPick}>
            确定出牌
          </button>
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
