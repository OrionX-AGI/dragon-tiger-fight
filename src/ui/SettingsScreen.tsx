import { useState } from 'react';
import { isMusicOn, isSfxOn, setMusicOn, setSfxOn } from '../audio/sound';

interface Props {
  onBack: () => void;
}

/** 开/关 两枚按钮的一行设置项 */
function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="panel-row">
      <span className="row-label">{label}</span>
      <div className="opt-group">
        <button className={`opt-btn ${value ? 'opt-active' : ''}`} onClick={() => onChange(true)}>
          开
        </button>
        <button className={`opt-btn ${!value ? 'opt-active' : ''}`} onClick={() => onChange(false)}>
          关
        </button>
      </div>
    </div>
  );
}

export default function SettingsScreen({ onBack }: Props) {
  // 偏好持久化在声音引擎里（localStorage），这里只是展示态
  const [music, setMusic] = useState(isMusicOn);
  const [sfx, setSfx] = useState(isSfxOn);

  return (
    <div className="game-screen settings-screen">
      <header className="topbar">
        <button className="btn-plain" onClick={onBack}>← 返回大厅</button>
      </header>
      <section className="game-panel settings-panel">
        <h3>设置</h3>
        <ToggleRow
          label="背景音乐"
          value={music}
          onChange={(v) => {
            setMusicOn(v);
            setMusic(v);
          }}
        />
        <ToggleRow
          label="音效"
          value={sfx}
          onChange={(v) => {
            setSfxOn(v);
            setSfx(v);
          }}
        />
      </section>
    </div>
  );
}
