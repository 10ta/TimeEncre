import { useRef, useState } from 'react';
import { useActiveRecords, useDuplicateGroups, useTypes } from '../../db/hooks';
import { seedDefaultTypes } from '../../db/actions';
import { importAtl2 } from '../../io/atl2';
import { readJsonFile } from '../../io/download';
import { TypeGrid } from './TypeGrid';
import { TodayStrip } from './TodayStrip';
import { RecordDialog } from './RecordDialog';
import { TodayGoals } from '../goals/TodayGoals';
import { TodayKeep } from '../keep/TodayKeep';
import { tr } from '../../i18n';

export function TimerPage() {
  const types = useTypes();
  const actives = useActiveRecords();
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const dupTypes = useDuplicateGroups('types');

  if (!types || !actives) return null;
  if (types.length === 0) return <Onboarding />;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{tr("计时")}</h1>
      </header>
      {dupTypes && dupTypes.length > 0 && (
        <p className="notice is-warn">
          {tr("有 {0} 组同名的活动。", dupTypes.length)} <a href="#/catalog">{tr("去合并 ›")}</a>
        </p>
      )}
      <TypeGrid types={types} actives={actives} onOptions={setOptionsFor} />
      <div className="home-pair">
        <TodayGoals />
        <TodayKeep />
      </div>
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
      setMsg(tr("已导入 {0} 个活动、{1} 条记录。", r.added.types, r.added.records));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="page onboarding">
      <h1>{tr("先准备好活动")}</h1>
      <p className="lead">{tr("活动就是计时页上的格子，比如睡眠、工作、学习。之后随时可以增删改。")}</p>
      <div className="onboarding-actions">
        <button type="button" className="choice" onClick={() => void seedDefaultTypes()}>
          <span className="choice-emoji">🗂️</span>
          <span className="choice-title">{tr("用一套常用活动")}</span>
          <span className="choice-desc">{tr("睡眠、工作、吃饭、学习等 14 个")}</span>
        </button>
        <button type="button" className="choice" onClick={() => fileRef.current?.click()}>
          <span className="choice-emoji">📥</span>
          <span className="choice-title">{tr("从 A Time Logger 2 导入")}</span>
          <span className="choice-desc">{tr("选择 .ttbkp 备份文件，活动和记录一起导入")}</span>
        </button>
        <a className="choice" href="#/settings">
          <span className="choice-emoji">🔄</span>
          <span className="choice-title">{tr("从 GitHub 数据仓库恢复")}</span>
          <span className="choice-desc">{tr("已在其他设备上用过：连接同一个仓库后同步")}</span>
        </a>
        <a className="choice" href="#/catalog">
          <span className="choice-emoji">✏️</span>
          <span className="choice-title">{tr("自己从头建")}</span>
          <span className="choice-desc">{tr("逐个添加活动")}</span>
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
