import { useRef, useState, type FormEvent } from 'react';
import { Cloud, Download, Upload } from 'lucide-react';
import { bundledToken, repository, type SyncDirection } from './backup.ts';
import { defaultObservationRules, validateObservationRules, type ObservationRules, type RuleMatch } from './domain.ts';
import { dateLabel } from './format.ts';
import type { LocalState } from './store.ts';

function RuleThreshold({ name, label, value, optional = false }: {
  name: string; label: string; value: number | undefined; optional?: boolean;
}) {
  return <label className="rule-row">
    <span>{label}{optional && <small>留空即停用</small>}</span>
    <span className="rule-percent">
      <input type="number" inputMode="decimal" min="0.01" max="100" step="0.01" name={name}
        required={!optional} defaultValue={value} placeholder={optional ? '—' : undefined} />
      <span aria-hidden="true">%</span>
    </span>
  </label>;
}

function RuleMode({ name, label, value }: { name: string; label: string; value: RuleMatch }) {
  return <div className="rule-row" role="group" aria-label={label}>
    <span>{label}</span>
    <div className="rule-segment">
      <label><input type="radio" name={name} value="any" defaultChecked={value === 'any'} /><span>任一满足</span></label>
      <label><input type="radio" name={name} value="all" defaultChecked={value === 'all'} /><span>全部满足</span></label>
    </div>
  </div>;
}

function ObservationSettings({ rules, busy, save }: {
  rules: ObservationRules; busy: boolean; save: (rules: ObservationRules) => void;
}) {
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const average = String(data.get('buyBelowAverage') ?? '');
    try {
      save(validateObservationRules({
        activeBuyDrop: Number(data.get('activeBuyDrop')),
        idleBuyDrop: Number(data.get('idleBuyDrop')),
        buyBelowAverage: average === '' ? undefined : Number(average),
        buyMatch: data.get('buyMatch') as RuleMatch,
        sellAboveAverage: Number(data.get('sellAboveAverage')),
        sellAboveLastBuy: Number(data.get('sellAboveLastBuy')),
        sellMatch: data.get('sellMatch') as RuleMatch,
      }));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '规则无效');
    }
  }

  return <form className="panel observation-settings" onSubmit={submit}>
    <h2>买卖观察规则</h2>
    <fieldset disabled={busy}>
      <legend>买入观察</legend>
      <RuleThreshold name="activeBuyDrop" label="周期内较最近成交回落" value={rules.activeBuyDrop} />
      <RuleThreshold name="idleBuyDrop" label="无周期时较最近成交回落" value={rules.idleBuyDrop} />
      <RuleThreshold name="buyBelowAverage" label="低于剩余均价" value={rules.buyBelowAverage} optional />
      <RuleMode name="buyMatch" label="周期内触发条件" value={rules.buyMatch} />
    </fieldset>
    <fieldset disabled={busy}>
      <legend>卖出观察</legend>
      <RuleThreshold name="sellAboveAverage" label="全卖 · 高于剩余均价" value={rules.sellAboveAverage} />
      <RuleThreshold name="sellAboveLastBuy" label="高于最近剩余批次买价" value={rules.sellAboveLastBuy} />
      <RuleMode name="sellMatch" label="卖出触发条件" value={rules.sellMatch} />
      <p className="muted">满足全卖门槛时提示全部剩余股数，否则提示最近一笔仍有剩余的买入批次。</p>
    </fieldset>
    {error && <p className="form-message" role="alert">{error}</p>}
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => { setError(''); save(defaultObservationRules); }}>恢复默认</button>
      <button className="primary" disabled={busy}>保存规则</button>
    </div>
  </form>;
}

export type SyncConfig = { folder: string; credential: string; secret: string };
export function Settings({ local, busy, conflict, config, setConfig, feedback, saveRules, sync, download, restore, clear }: {
  local: LocalState; busy: boolean; conflict: boolean; config: SyncConfig; setConfig: (config: SyncConfig) => void; feedback?: { text: string; error?: boolean };
  saveRules: (rules: ObservationRules) => void;
  sync: (direction: SyncDirection) => void; download: () => void;
  restore: (file: File) => void; clear: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cleared, setCleared] = useState(false);
  const folder = config.folder.trim();
  const point = local.sync?.[folder];
  const ready = Boolean(folder && config.credential.trim() && config.secret);

  function openConfig() {
    setCleared(false);
    dialog.current?.showModal();
  }

  function editConfig(next: SyncConfig) {
    setCleared(false);
    setConfig(next);
  }

  const conflictActions = conflict && <>
    <button type="button" disabled={busy} onClick={() => sync('download')}>保留云端</button>
    <button type="button" disabled={busy} onClick={() => sync('upload')}>保留本机</button>
  </>;
  return <>
    <section className="panel">
      <div className="section-title"><h2><Cloud size={19} /> 数据同步与备份</h2><span className="muted">{point?.revision === local.ledger.revision ? '已与云端同步' : point ? '本地有更新待同步' : '未同步'}</span></div>
      {point && <p className="muted">上次同步 {dateLabel(point.time)}</p>}
      <div className="actions">
        {conflictActions}
        <button type="button" className="primary" disabled={busy} onClick={() => ready ? sync('auto') : openConfig()}>立即同步</button>
        <button type="button" disabled={busy} onClick={openConfig}>同步配置</button>
      </div>
    </section>
    <dialog ref={dialog} className="sync-dialog" aria-labelledby="sync-config-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={event => { event.preventDefault(); setCleared(false); sync('auto'); }}>
        <div className="section-title">
          <h2 id="sync-config-title">同步配置</h2>
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button>
        </div>
        <p className="muted sync-path">私有仓库 {repository} / stocks/{folder || '<名字>'}/open.json</p>
        <fieldset disabled={busy}>
          <label>云端名字
            <input value={config.folder} onChange={event => editConfig({ ...config, folder: event.target.value })}
              placeholder="例如 liuzhenghua" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
          </label>
          <label>{bundledToken ? '云端访问口令' : 'GitHub Token'}
            <input type="password" autoComplete="off" required value={config.credential}
              placeholder={bundledToken ? '用于解锁 GitHub 访问凭证' : 'Contents: Read and write'}
              onChange={event => editConfig({ ...config, credential: event.target.value })} />
          </label>
          <label>数据加密口令
            <input type="password" autoComplete="off" required value={config.secret}
              placeholder="用于加密和解密备份数据"
              onChange={event => editConfig({ ...config, secret: event.target.value })} />
          </label>
        </fieldset>
        <button className="link-button" type="button" disabled={busy} onClick={() => {
          setConfig({ ...config, credential: '', secret: '' });
          setCleared(true);
        }}>清除已保存的口令</button>
        {conflict && <div className="actions">{conflictActions}</div>}
        <button className="primary wide" disabled={busy}>{busy ? '同步中…' : '保存并同步'}</button>
        {cleared ? <p className="muted sync-message" role="status">已清除此浏览器保存的口令</p> :
          busy ? <p className="muted sync-message" role="status">正在同步…</p> :
          feedback && <p className={feedback.error ? 'form-message sync-message' : 'muted sync-message'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
      </form>
    </dialog>
    <section className="panel">
      <h2>本机备份</h2>
      <p className="muted">清除浏览器数据可能导致记录丢失。导出的 JSON 包含股票和价格记录，请妥善保管。</p>
      <p className="muted">上次导出 {local.backupAt ? dateLabel(local.backupAt) : '暂无'}</p>
      <div className="actions spread">
        <button className="danger" disabled={busy} onClick={clear}>清空本机数据</button>
        <div className="actions">
          <label className={'button upload ' + (busy ? 'disabled' : '')}><Upload size={16} />导入<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) restore(file);
          }} /></label>
          <button disabled={busy} onClick={download}><Download size={16} />导出</button>
        </div>
      </div>
    </section>
    <ObservationSettings key={local.ledger.revision} rules={local.ledger.observationRules ?? defaultObservationRules}
      busy={busy} save={saveRules} />
  </>;
}
