import { useRef, useState } from 'react';
import { useActiveRecords, useTypes } from '../../db/hooks';
import { seedDefaultTypes } from '../../db/actions';
import { importAtl2 } from '../../io/atl2';
import { readJsonFile } from '../../io/download';
import { TypeGrid } from './TypeGrid';
import { TodayStrip } from './TodayStrip';
import { RecordDialog } from './RecordDialog';
import { TodayGoals } from '../goals/TodayGoals';

export function TimerPage() {
  const types = useTypes();
  const actives = useActiveRecords();
  const [optionsFor, setOptionsFor] = useState<string | null>(null);

  if (!types || !actives) return null;
  if (types.length === 0) return <Onboarding />;

  return (
    <div className="page">
      <header className="page-head">
        <h1>计时</h1>
        <a className="btn is-quiet" href="#/catalog">管理类型与标签</a>
      </header>
      <TypeGrid types={types} actives={actives} onOptions={setOptionsFor} />
      <TodayGoals />
      <TodayStrip />
      {optionsFor && <RecordDialog mode="start" typeId={optionsFor} onClose={() => setOptionsFor(null)} />}
    </div>
  );
}

function Onboarding() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const r = await importAtl2(await readJsonFile(file));
      setMsg(`已导入 ${r.added.types} 个类型、${r.added.records} 条记录。`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="page onboarding">
      <h1>先准备好活动类型</h1>
      <p className="lead">类型就是计时页上的格子，比如睡眠、工作、学习。之后随时可以增删改。</p>
      <div className="onboarding-actions">
        <button type="button" className="choice" onClick={() => void seedDefaultTypes()}>
          <span className="choice-emoji">🗂️</span>
          <span className="choice-title">用一套常用类型</span>
          <span className="choice-desc">睡眠、工作、吃饭、学习等 14 个</span>
        </button>
        <button type="button" className="choice" onClick={() => fileRef.current?.click()}>
          <span className="choice-emoji">📥</span>
          <span className="choice-title">从 A Time Logger 2 导入</span>
          <span className="choice-desc">选择 .ttbkp 备份文件，类型和记录一起导入</span>
        </button>
        <a className="choice" href="#/settings">
          <span className="choice-emoji">🔄</span>
          <span className="choice-title">从 GitHub 数据仓库恢复</span>
          <span className="choice-desc">已在其他设备上用过：连接同一个仓库后同步</span>
        </a>
        <a className="choice" href="#/catalog">
          <span className="choice-emoji">✏️</span>
          <span className="choice-title">自己从头建</span>
          <span className="choice-desc">逐个添加类型</span>
        </a>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".ttbkp,.json,application/json"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {msg && <p className="hint" role="status">{msg}</p>}
    </div>
  );
}
