import { useState } from 'react';
import quickRulesHtml from '../../龙虎斗极简规则.md?html';
import fullRulesHtml from '../../龙虎斗游戏规则说明书.md?html';

type Tab = 'quick' | 'full';

export default function RulesScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('quick');
  return (
    <div className="rules-screen">
      {/* 顶栏只放返回按钮，标签页独占一行居中：三块并排在窄屏挤不下，标题也压不住中线 */}
      <header className="topbar">
        <button className="btn-plain" onClick={onBack}>← 返回大厅</button>
      </header>
      <div className="rules-tabs">
        <div className="opt-group">
          <button className={`opt-btn ${tab === 'quick' ? 'opt-active' : ''}`} onClick={() => setTab('quick')}>
            极简规则
          </button>
          <button className={`opt-btn ${tab === 'full' ? 'opt-active' : ''}`} onClick={() => setTab('full')}>
            完整规则
          </button>
        </div>
      </div>
      {/* 规则文档是随包固定的静态内容，构建期已渲染成 HTML，不含任何外部输入 */}
      <article
        className="rules-content"
        dangerouslySetInnerHTML={{ __html: tab === 'quick' ? quickRulesHtml : fullRulesHtml }}
      />
    </div>
  );
}
