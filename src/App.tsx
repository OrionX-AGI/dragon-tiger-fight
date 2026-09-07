import { useState } from 'react';
import { createLogger } from './core/logger';
import OnlineScreen from './online/OnlineScreen';
import BoardGameScreen from './ui/BoardGame/BoardGameScreen';
import CardGameScreen from './ui/CardGame/CardGameScreen';
import Lobby from './ui/Lobby';
import RulesScreen from './ui/RulesScreen';
import SettingsScreen from './ui/SettingsScreen';
import type { MatchConfig } from './ui/config';

const log = createLogger('ui');

type Screen =
  | { name: 'lobby' }
  | { name: 'rules' }
  | { name: 'settings' }
  | { name: 'card'; config: MatchConfig }
  | { name: 'board'; config: MatchConfig }
  | { name: 'online' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'lobby' });

  const go = (next: Screen) => {
    log.info('切换界面', next.name === 'card' || next.name === 'board' ? { 目标: next.name, 配置: next.config } : { 目标: next.name });
    setScreen(next);
  };
  const backToLobby = () => go({ name: 'lobby' });

  switch (screen.name) {
    case 'rules':
      return <RulesScreen onBack={backToLobby} />;
    case 'settings':
      return <SettingsScreen onBack={backToLobby} />;
    case 'card':
      return <CardGameScreen key={Date.now()} config={screen.config} onExit={backToLobby} />;
    case 'board':
      return <BoardGameScreen key={Date.now()} config={screen.config} onExit={backToLobby} />;
    case 'online':
      return <OnlineScreen onExit={backToLobby} />;
    default:
      return (
        <Lobby
          onStartCard={(config) => go({ name: 'card', config })}
          onStartBoard={(config) => go({ name: 'board', config })}
          onOnline={() => go({ name: 'online' })}
          onRules={() => go({ name: 'rules' })}
          onSettings={() => go({ name: 'settings' })}
        />
      );
  }
}
