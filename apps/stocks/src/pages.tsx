import { useRef, useState } from 'react';
import { Cloud, Download, Upload } from 'lucide-react';
import { bundledToken, repository, type SyncDirection } from './backup.ts';
import { dateLabel } from './format.ts';
import type { LocalState } from './store.ts';

export type SyncConfig = { folder: string; credential: string; secret: string };
export function Settings({ local, busy, conflict, config, setConfig, feedback, sync, download, restore, clear }: {
  local: LocalState; busy: boolean; conflict: boolean; config: SyncConfig; setConfig: (config: SyncConfig) => void; feedback?: { text: string; error?: boolean };
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
        <p className="muted sync-path">私有仓库 {repository} / stocks/{folder || '<名字>'}/ledger.json</p>
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
  </>;
}
