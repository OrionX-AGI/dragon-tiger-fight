import { useEffect, useRef, useState } from 'react';
import { createLogger } from '../core/logger';
import type { ConnStatus } from './connection';
import { getConnection } from './connection';
import OnlineBoardScreen from './OnlineBoardScreen';
import OnlineCardScreen from './OnlineCardScreen';
import OnlineLobby from './OnlineLobby';
import OnlineRoom from './OnlineRoom';
import type { BoardGameView, CardGameView, RoomSummary, RoomView } from './protocol';

const log = createLogger('ui');

interface Props {
  onExit: () => void;
}

/**
 * 在线对战容器：持有连接与服务器推送的全部状态，
 * 根据"是否在房间 / 是否有对局视图"决定渲染大厅、房间还是对局界面。
 */
export default function OnlineScreen({ onExit }: Props) {
  const conn = useRef(getConnection()).current;
  const [status, setStatus] = useState<ConnStatus>(conn.status);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [cardView, setCardView] = useState<CardGameView | null>(null);
  const [boardView, setBoardView] = useState<BoardGameView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 对方掉线提示：null 表示在线 */
  const [oppGraceMs, setOppGraceMs] = useState<number | null>(null);

  useEffect(() => {
    log.info('进入在线对战');
    const offStatus = conn.onStatus(setStatus);
    const offMsg = conn.onMessage((msg) => {
      switch (msg.type) {
        case 'helloOk':
          if (msg.resumed === null) {
            setRoom(null);
            setCardView(null);
            setBoardView(null);
          }
          break;
        case 'roomList':
          setRooms(msg.rooms);
          break;
        case 'roomUpdate':
          setRoom(msg.room);
          break;
        case 'cardState':
          setCardView(msg.view);
          setBoardView(null);
          setNotice(null);
          break;
        case 'boardState':
          setBoardView(msg.view);
          setCardView(null);
          setNotice(null);
          break;
        case 'leftRoom':
          setRoom(null);
          setCardView(null);
          setBoardView(null);
          setOppGraceMs(null);
          break;
        case 'kicked':
          setRoom(null);
          setCardView(null);
          setBoardView(null);
          setOppGraceMs(null);
          setNotice(msg.reason);
          break;
        case 'opponentConnection':
          setOppGraceMs(msg.connected ? null : msg.graceRemainingMs);
          break;
        case 'errorMsg':
          setNotice(msg.message);
          break;
      }
    });
    conn.start();
    return () => {
      offStatus();
      offMsg();
      conn.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function leaveRoom() {
    conn.send({ type: 'leaveRoom' });
    setRoom(null);
    setCardView(null);
    setBoardView(null);
    setOppGraceMs(null);
  }

  function exitOnline() {
    if (room !== null) conn.send({ type: 'leaveRoom' });
    onExit();
  }

  const connBanner =
    status === 'open' ? null : status === 'connecting' ? '正在连接联机服务器……' : '连接已断开，正在自动重连……';

  if (room !== null && cardView !== null) {
    return (
      <OnlineCardScreen
        conn={conn}
        room={room}
        view={cardView}
        connBanner={connBanner}
        oppGraceMs={oppGraceMs}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onLeave={leaveRoom}
      />
    );
  }
  if (room !== null && boardView !== null) {
    return (
      <OnlineBoardScreen
        conn={conn}
        room={room}
        view={boardView}
        connBanner={connBanner}
        oppGraceMs={oppGraceMs}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onLeave={leaveRoom}
      />
    );
  }
  if (room !== null) {
    return (
      <OnlineRoom
        conn={conn}
        room={room}
        connBanner={connBanner}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onLeave={leaveRoom}
      />
    );
  }
  return (
    <OnlineLobby
      conn={conn}
      rooms={rooms}
      connBanner={connBanner}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      onExit={exitOnline}
    />
  );
}
