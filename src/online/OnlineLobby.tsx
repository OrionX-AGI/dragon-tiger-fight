import { useState } from 'react';
import type { OnlineConnection } from './connection';
import { getPlayerName, savePlayerName } from './connection';
import type { GameType, RoomSummary } from './protocol';

interface Props {
  conn: OnlineConnection;
  rooms: RoomSummary[];
  connBanner: string | null;
  notice: string | null;
  onDismissNotice: () => void;
  onExit: () => void;
}

const GAME_LABELS: Record<GameType, string> = { card: '纸牌对拼', board: '棋盘翻棋' };

export default function OnlineLobby({ conn, rooms, connBanner, notice, onDismissNotice, onExit }: Props) {
  const [name, setName] = useState(getPlayerName);
  const [gameType, setGameType] = useState<GameType>('card');
  const [code, setCode] = useState('');

  const connected = connBanner === null;

  function commitName() {
    const trimmed = name.trim().slice(0, 12);
    const finalName = trimmed.length > 0 ? trimmed : getPlayerName();
    setName(finalName);
    savePlayerName(finalName);
    conn.send({ type: 'setName', name: finalName });
  }

  function joinByCode() {
    const trimmed = code.trim();
    if (trimmed.length === 0) return;
    conn.send({ type: 'joinByCode', code: trimmed });
  }

  return (
    <div className="game-screen online-lobby">
      <header className="topbar">
        <button className="btn-plain" onClick={onExit}>← 返回大厅</button>
        <h2>在线对战</h2>
        <div className="online-name-box">
          <span className="row-label">昵称</span>
          <input
            className="online-input"
            value={name}
            maxLength={12}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
      </header>

      {connBanner && <p className="warn-banner">{connBanner}</p>}
      {notice && (
        <p className="warn-banner online-notice" onClick={onDismissNotice}>
          {notice}（点击关闭）
        </p>
      )}

      <div className="online-panels">
        <section className="game-panel">
          <h3>开始对战</h3>
          <div className="panel-row">
            <span className="row-label">玩法</span>
            <div className="opt-group">
              {(['card', 'board'] as const).map((g) => (
                <button
                  key={g}
                  className={`opt-btn ${gameType === g ? 'opt-active' : ''}`}
                  onClick={() => setGameType(g)}
                >
                  {GAME_LABELS[g]}
                </button>
              ))}
            </div>
          </div>
          <div className="online-actions">
            <button
              className="btn-primary"
              disabled={!connected}
              onClick={() => conn.send({ type: 'autoMatch', gameType })}
            >
              自动匹配
            </button>
            <button
              className="btn-plain"
              disabled={!connected}
              onClick={() => conn.send({ type: 'createRoom', gameType })}
            >
              创建房间
            </button>
          </div>
          <div className="panel-row online-code-row">
            <span className="row-label">房间码</span>
            <input
              className="online-input online-code-input"
              value={code}
              placeholder="4 位数字"
              maxLength={4}
              inputMode="numeric"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && joinByCode()}
            />
            <button className="btn-plain" disabled={!connected || code.length !== 4} onClick={joinByCode}>
              加入
            </button>
          </div>
        </section>

        <section className="game-panel">
          <h3>牌桌列表</h3>
          {rooms.length === 0 ? (
            <p className="panel-desc">当前没有等待中的牌桌，创建一个或让朋友先建房。</p>
          ) : (
            <ul className="online-room-list">
              {rooms.map((r) => (
                <li key={r.id} className="online-room-row">
                  <span className={`faction-tag ${r.gameType === 'card' ? 'tag-dragon' : 'tag-tiger'}`}>
                    {GAME_LABELS[r.gameType]}
                  </span>
                  <span className="online-room-players">
                    {r.playerNames.join('、') || '空桌'}
                    {r.hasReady && <em className="online-ready-mark">已有人准备</em>}
                  </span>
                  <span className="online-room-code">码 {r.code}</span>
                  <button
                    className="btn-plain"
                    disabled={!connected || r.playerNames.length >= 2}
                    onClick={() => conn.send({ type: 'joinRoom', roomId: r.id })}
                  >
                    {r.playerNames.length >= 2 ? '已满' : '加入'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="lobby-footer">
        <p className="panel-desc online-tip">
          局域网对战：请对手用浏览器访问启动窗口中显示的地址，即可在此大厅相互匹配。
        </p>
      </footer>
    </div>
  );
}
