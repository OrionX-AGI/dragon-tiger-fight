import { useState } from 'react';
import { createLogger } from './core/logger';
import BoardGameScreen from './ui/BoardGame/BoardGameScreen';
import CardGameScreen from './ui/CardGame/CardGameScreen';
import Lobby from './ui/Lobby';
import RulesScreen from './ui/RulesScreen';
import type { MatchConfig } from './ui/config';

const log = createLogger('ui');

type Screen =
  | { name: 'lobby' }
  | { name: 'rules' }
  | { name: 'card'; config: MatchConfig }
  | { name: 'board'; config: MatchConfig };

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
    case 'card':
      return <CardGameScreen key={Date.now()} config={screen.config} onExit={backToLobby} />;
    case 'board':
      return <BoardGameScreen key={Date.now()} config={screen.config} onExit={backToLobby} />;
    default:
      return (
        <Lobby
          onStartCard={(config) => go({ name: 'card', config })}
          onStartBoard={(config) => go({ name: 'board', config })}
          onRules={() => go({ name: 'rules' })}
        />
      );
  }
}
