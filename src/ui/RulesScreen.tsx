import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import quickRulesText from '../../龙虎斗极简规则.md?raw';
import fullRulesText from '../../龙虎斗游戏规则说明书.md?raw';

type Tab = 'quick' | 'full';

export default function RulesScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('quick');
  return (
    <div className="rules-screen">
      <header className="topbar">
        <button className="btn-plain" onClick={onBack}>← 返回大厅</button>
        <h2>游戏规则</h2>
        <div className="opt-group">
          <button className={`opt-btn ${tab === 'quick' ? 'opt-active' : ''}`} onClick={() => setTab('quick')}>
            极简规则
          </button>
          <button className={`opt-btn ${tab === 'full' ? 'opt-active' : ''}`} onClick={() => setTab('full')}>
            完整规则
          </button>
        </div>
      </header>
      <article className="rules-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {tab === 'quick' ? quickRulesText : fullRulesText}
        </ReactMarkdown>
      </article>
    </div>
  );
}
