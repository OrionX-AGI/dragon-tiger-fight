import { useState } from 'react';
import type { OnlineConnection } from './connection';
import type { RoomView } from './protocol';
import { useCountdown } from './useCountdown';

interface Props {
  conn: OnlineConnection;
  room: RoomView;
  connBanner: string | null;
  notice: string | null;
  onDismissNotice: () => void;
  onLeave: () => void;
}

const GAME_LABELS = { card: '纸牌对拼', board: '棋盘翻棋' } as const;

export default function OnlineRoom({ conn, room, connBanner, notice, onDismissNotice, onLeave }: Props) {
  const [leaving, setLeaving] = useState(false);
  const countdown = useCountdown(room.countdownRemainingMs);
  const mySeat = room.yourSeat;
  const me = room.seats[mySeat];
  const totalGames = room.wins[0] + room.wins[1] + room.draws;

  return (
    <div className="game-screen online-room">
      <header className="topbar">
        <button className="btn-plain" onClick={() => setLeaving(true)}>← 离开房间</button>
        <h2>{GAME_LABELS[room.gameType]} · 牌桌</h2>
        <div className="score-tag">房间码 {room.code}</div>
      </header>

      {connBanner && <p className="warn-banner">{connBanner}</p>}
      {notice && (
        <p className="warn-banner online-notice" onClick={onDismissNotice}>
          {notice}（点击关闭）
        </p>
      )}

      <div className="online-seats">
        {([0, 1] as const).map((seatIdx) => {
          const seat = room.seats[seatIdx];
          const isMe = seatIdx === mySeat;
          return (
            <div key={seatIdx} className={`online-seat ${isMe ? 'online-seat-me' : ''}`}>
              <h3>{seat ? seat.name : '等待玩家……'}</h3>
              {seat && (
                <p className="online-seat-status">
                  {!seat.connected ? '掉线重连中' : seat.ready ? '已准备' : '未准备'}
                  {isMe && ' · 你'}
                </p>
              )}
              {totalGames > 0 && seat && <p className="online-seat-score">胜 {room.wins[seatIdx]} 局</p>}
            </div>
          );
        })}
      </div>

      {countdown !== null && (
        <p className="warn-banner online-countdown">
          倒计时 {countdown} 秒：双方都点击"准备"即开局，超时未准备的一方将被移出房间
        </p>
      )}
      {totalGames > 0 && (
        <p className="panel-desc online-tip">
          本桌战绩：{room.seats[0]?.name ?? '?'} {room.wins[0]} 胜 · {room.seats[1]?.name ?? '?'} {room.wins[1]} 胜 · 和{' '}
          {room.draws}
        </p>
      )}

      <div className="online-actions online-room-actions">
        <button
          className="btn-primary"
          disabled={connBanner !== null}
          onClick={() => conn.send({ type: 'setReady', ready: !(me?.ready ?? false) })}
        >
          {me?.ready ? '取消准备' : '准备'}
        </button>
      </div>

      <p className="panel-desc online-tip">
        把房间码 <strong>{room.code}</strong> 告诉朋友，或等其他玩家从牌桌列表 / 自动匹配加入。
      </p>

      {leaving && (
        <div className="overlay">
          <div className="overlay-panel">
            <h3>离开房间？</h3>
            <p>离开后席位将被释放。</p>
            <div className="overlay-actions">
              <button className="btn-primary" onClick={onLeave}>确认离开</button>
              <button className="btn-plain" onClick={() => setLeaving(false)}>留下</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
