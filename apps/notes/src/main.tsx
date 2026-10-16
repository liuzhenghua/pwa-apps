import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readStored, saveStored, unlockTokenBox } from '@pwa-apps/shared';
import { getRemote, getRemoteIndex, indexFingerprint, mergeNotes, putRemote, storageRepository, validateFolder, verifyRepository, type Note } from './sync';
import './style.css';

const key = 'pwa-apps:notes';
const credentialsKey = 'pwa-apps:notes:github-credentials';
const bundledTokenBox = import.meta.env.VITE_GITHUB_TOKEN_BOX || '';
const hasBundledToken = Boolean(bundledTokenBox.trim());
const bundledTokenMarker = 'encrypted-build';
type Credentials = { folder: string; token: string; secret?: string };
const baselineKey = (folder: string) => `pwa-apps:notes:sync:${storageRepository}:${folder}`;
const indexKey = (folder: string) => `pwa-apps:notes:index:${storageRepository}:${folder}`;
const lastSyncKey = (folder: string) => `pwa-apps:notes:last-sync:${storageRepository}:${folder}`;
const snapshot = (items: Note[]) => JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)));

function App() {
  const [notes, setNotes] = useState<Note[]>(() => readStored(key, []));
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openSwipe, setOpenSwipe] = useState<string | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [folder, setFolder] = useState(() => readStored<Credentials>(credentialsKey, { folder: '', token: '' }).folder);
  const [token, setToken] = useState(() => hasBundledToken ? '' : readStored<Credentials>(credentialsKey, { folder: '', token: '' }).token);
  const [tokenPassphrase, setTokenPassphrase] = useState('');
  const [secret, setSecret] = useState(() => readStored<Credentials>(credentialsKey, { folder: '', token: '' }).secret ?? '');
  const [showTokenHelp, setShowTokenHelp] = useState(false);
  const [remote, setRemote] = useState<Awaited<ReturnType<typeof getRemote>> | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const tokenCache = useRef<{ passphrase: string; token: string } | null>(null);
  useEffect(() => {
    if (!hasBundledToken) return;
    const saved = readStored<Credentials>(credentialsKey, { folder: '', token: '' });
    if (saved.token && saved.token !== bundledTokenMarker) saveStored(credentialsKey, { ...saved, token: bundledTokenMarker });
  }, []);
  async function accessToken(): Promise<string> {
    if (!hasBundledToken) return token.trim();
    if (tokenCache.current?.passphrase === tokenPassphrase) return tokenCache.current.token;
    const unlocked = await unlockTokenBox(bundledTokenBox, tokenPassphrase);
    tokenCache.current = { passphrase: tokenPassphrase, token: unlocked };
    return unlocked;
  }
  const current = notes.find(note => note.id === selected);
  const savedBaseline = folder.trim() ? readStored<string | null>(baselineKey(folder.trim()), null) : null;
  const lastSyncAt = folder.trim() ? readStored<number | null>(lastSyncKey(folder.trim()), null) : null;
  const syncStatus = savedBaseline !== null && savedBaseline === snapshot(notes) && lastSyncAt
    ? `上次同步：${new Date(lastSyncAt).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : '未同步';
  const localById = new Map(notes.map(note => [note.id, note]));
  const remoteById = new Map((remote?.notes || []).map(note => [note.id, note]));
  const differences = remote ? [
    ...remote.notes.filter(note => !localById.has(note.id)).map(note => ({ label: note.title || '无标题', kind: '仅云端' })),
    ...notes.filter(note => !remoteById.has(note.id)).map(note => ({ label: note.title || '无标题', kind: '仅本地' })),
    ...remote.notes.filter(note => { const local = localById.get(note.id); return local && (local.title !== note.title || local.body !== note.body || local.updated !== note.updated); }).map(note => ({ label: note.title || '无标题', kind: '内容不同' })),
  ] : [];
  const visible = [...notes]
    .filter(note => `${note.title} ${note.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updated - a.updated);

  function update(next: Note[]) { setNotes(next); saveStored(key, next); }
  function add() {
    const note = { id: crypto.randomUUID(), title: '', body: '', updated: Date.now() };
    update([note, ...notes]); setOpenSwipe(null); setSelected(note.id);
  }
  function edit(patch: Partial<Note>) {
    update(notes.map(note => note.id === selected ? { ...note, ...patch, updated: Date.now() } : note));
  }
  function remove(id: string) {
    update(notes.filter(note => note.id !== id));
    setOpenSwipe(null);
    if (selected === id) setSelected(null);
  }
  function closeSync() { setShowSync(false); setRemote(null); }
  async function sendLocal(cloud: Awaited<ReturnType<typeof getRemote>>, items: Note[] = notes) {
    const auth = await accessToken();
    const latest = await getRemoteIndex(folder, auth);
    if (indexFingerprint(latest) !== cloud.fingerprint) throw new Error('云端笔记已变化，请重新同步。');
    await putRemote(folder, auth, secret, items, cloud);
    const updated = await getRemote(folder, auth, secret);
    update(updated.notes);
    saveStored(baselineKey(validateFolder(folder)), snapshot(updated.notes));
    saveStored(indexKey(validateFolder(folder)), updated.fingerprint);
    saveStored(lastSyncKey(validateFolder(folder)), Date.now());
    setRemote(null);
    setSyncMessage('本地笔记已同步到云端。');
  }
  function receiveCloud(cloud: Awaited<ReturnType<typeof getRemote>>) {
    update(cloud.notes); setSelected(null);
    saveStored(baselineKey(validateFolder(folder)), snapshot(cloud.notes));
    saveStored(indexKey(validateFolder(folder)), cloud.fingerprint);
    saveStored(lastSyncKey(validateFolder(folder)), Date.now());
    setRemote(null);
    setSyncMessage('云端笔记已同步到本地。');
  }
  async function startSync() {
    try {
      setSyncBusy(true); setSyncError(''); setSyncMessage(''); setRemote(null);
      const name = validateFolder(folder);
      const auth = await accessToken();
      if (!auth) throw new Error('请输入 GitHub Token。');
      if (!secret) throw new Error('请输入加密口令。');
      await verifyRepository(auth);
      const entries = await getRemoteIndex(name, auth);
      const localState = snapshot(notes);
      const previousConfig = readStored<Credentials>(credentialsKey, { folder: '', token: '' });
      const tokenMarker = hasBundledToken ? bundledTokenMarker : auth;
      const previousState = readStored<string | null>(baselineKey(name), null);
      const previousIndex = readStored<string | null>(indexKey(name), null);
      if (previousConfig.folder === name && previousConfig.token === tokenMarker && previousConfig.secret === secret && previousState === localState && previousIndex === indexFingerprint(entries)) {
        saveStored(lastSyncKey(name), Date.now());
        setSyncMessage('本地和云端都没有变化，无需同步。');
        return;
      }
      const cloud = await getRemote(name, auth, secret, entries);
      saveStored(credentialsKey, { folder: name, token: tokenMarker, secret });
      const cloudState = snapshot(cloud.notes);
      const baseline = readStored<string | null>(baselineKey(name), null);
      if (localState === cloudState) {
        saveStored(baselineKey(name), localState);
        saveStored(indexKey(name), cloud.fingerprint);
        saveStored(lastSyncKey(name), Date.now());
        setSyncMessage('本地和云端已一致，无需同步。');
      } else if (baseline !== null && localState === baseline && cloudState !== baseline) {
        receiveCloud(cloud);
      } else if (baseline !== null && cloudState === baseline && localState !== baseline) {
        await sendLocal(cloud);
      } else if (baseline === null && notes.length === 0) {
        receiveCloud(cloud);
      } else if (baseline === null && cloud.notes.length === 0) {
        await sendLocal(cloud);
      } else {
        const baseNotes = baseline === null ? null : JSON.parse(baseline) as Note[];
        const plan = mergeNotes(notes, cloud.notes, baseNotes);
        if (plan.conflicts.length) {
          setRemote(cloud);
          setSyncMessage(`${plan.conflicts.length} 条笔记无法安全判断版本，请预览并选择方向。`);
        } else {
          await sendLocal(cloud, plan.notes);
          setSyncMessage('已按更新时间合并并同步两边笔记。');
        }
      }
    } catch (error) { setSyncError(error instanceof Error ? error.message : '同步失败。'); }
    finally { setSyncBusy(false); }
  }
  async function upload() {
    if (!remote || !confirm(`用本地 ${notes.length} 条笔记覆盖云端 ${remote.notes.length} 条笔记？`)) return;
    try { setSyncBusy(true); setSyncError(''); setSyncMessage(''); await sendLocal(remote); }
    catch (error) { setSyncError(error instanceof Error ? error.message : '上传失败。'); }
    finally { setSyncBusy(false); }
  }
  function download() {
    if (!remote || !confirm(`用云端 ${remote.notes.length} 条笔记覆盖本地 ${notes.length} 条笔记？`)) return;
    receiveCloud(remote);
  }
  function clearCredentials() {
    localStorage.removeItem(credentialsKey);
    tokenCache.current = null;
    setFolder(''); setToken(''); setTokenPassphrase(''); setSecret(''); setRemote(null); setSyncMessage('已清除这台设备保存的同步配置。');
  }
  function endSwipe(event: React.TouchEvent, id: string) {
    if (!touchStart.current) return;
    const dx = event.changedTouches[0].clientX - touchStart.current.x;
    const dy = event.changedTouches[0].clientY - touchStart.current.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      setOpenSwipe(dx < 0 ? id : null);
      swiped.current = true;
    }
    touchStart.current = null;
  }

  return <main>
    {current ? <section className="detail">
      <div className="detail-bar"><button className="back" onClick={() => setSelected(null)} aria-label="返回笔记列表"><span aria-hidden="true">‹</span> 笔记</button><span className="saved">自动保存</span></div>
      <input className="title-input" aria-label="标题" value={current.title} onChange={event => edit({ title: event.target.value })} placeholder="标题" />
      <p className="edit-date">{new Date(current.updated).toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      <textarea aria-label="内容" value={current.body} onChange={event => edit({ body: event.target.value })} placeholder="开始记录…" />
    </section> : <section className="list-page">
      <div className="topline"><h1>{folder.trim() ? `${folder.trim()} 的笔记` : '笔记'}</h1><div className="top-actions"><button className="new-note" onClick={add} aria-label="新建笔记"><span aria-hidden="true">＋</span></button><button className="sync-button" onClick={() => { setShowSync(true); setRemote(null); setSyncError(''); setSyncMessage(''); }} aria-label="同步笔记" title="同步笔记"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17.5H6a4 4 0 0 1-.5-7.97A6.5 6.5 0 0 1 18 8.5a4.5 4.5 0 0 1 .5 9H17"/><path d="M10 12v8m0-8-2 2m2-2 2 2M15 20v-8m0 8-2-2m2 2 2-2"/></svg></button></div></div>
      <label className="search"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input type="search" value={query} onChange={event => { setQuery(event.target.value); setOpenSwipe(null); }} placeholder="搜索笔记" aria-label="搜索笔记" /></label>
      {visible.length ? <div className="note-list">{visible.map(note => <div className={`swipe-row ${openSwipe === note.id ? 'revealed' : ''}`} key={note.id} onTouchStart={event => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; swiped.current = false; }} onTouchEnd={event => endSwipe(event, note.id)}>
        <button className="delete-action" onClick={() => remove(note.id)} aria-label={`删除${note.title || '无标题'}笔记`}>删除</button>
        <button className="note-card" onClick={() => { if (swiped.current) { swiped.current = false; return; } if (openSwipe === note.id) { setOpenSwipe(null); return; } setSelected(note.id); }}>
          <span className="note-title">{note.title.trim() || '无标题'}</span>
          <span className="note-preview">{note.body.trim().replace(/\s+/g, ' ') || '暂无内容，点击开始记录'}</span>
          <span className="note-date">{new Date(note.updated).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span>
        </button>
      </div>)}</div> : <div className="empty"><div className="empty-icon">✎</div><strong>{query ? '没有找到笔记' : '记录从这里开始'}</strong><p>{query ? '试试其他关键词' : '点击右上角的加号，写下第一条笔记'}</p></div>}
      <p className="storage-note">{syncStatus}</p>
    </section>}
    {showSync && <div className="modal-backdrop" onClick={closeSync}><div className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-title" onClick={event => event.stopPropagation()}>
      <div className="dialog-heading"><div><span className="dialog-kicker">GITHUB 同步</span><h2 id="sync-title">同步笔记</h2></div><button className="close-dialog" onClick={closeSync} aria-label="关闭">×</button></div>
      <p className="repo-name">私有仓库：{storageRepository}</p>
      <label className="field">名字 <span>用作仓库中的文件夹</span><input value={folder} onChange={event => { setFolder(event.target.value); setRemote(null); }} placeholder="例如 liu" autoComplete="username" /></label>
      {hasBundledToken ? <label className="field">云端访问口令 <span>用于解锁 GitHub 访问凭证；仅在当前页面暂存。</span><input type="password" value={tokenPassphrase} onChange={event => { setTokenPassphrase(event.target.value); tokenCache.current = null; setRemote(null); }} placeholder="输入云端访问口令" autoComplete="off" /></label> : <>
        <div className="token-label"><strong>GitHub Token</strong><button className="help-button" type="button" onClick={() => setShowTokenHelp(value => !value)} aria-label="如何获取 GitHub Token" aria-expanded={showTokenHelp}>?</button></div>
        {showTokenHelp && <div className="token-help"><p>在 GitHub 创建 Fine-grained personal access token，仓库权限只选 <strong>{storageRepository}</strong>，将 <strong>Contents</strong> 设为 <strong>Read and write</strong>。创建后复制 Token 粘贴到下方。</p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">前往 GitHub 创建 Token ↗</a></div>}
        <label className="field token-field"><span>首次配置后会保存在这台设备上</span><input type="password" value={token} onChange={event => { setToken(event.target.value); setRemote(null); }} placeholder="Fine-grained personal access token" autoComplete="off" /></label>
      </>}
      <label className="field">数据加密口令 <span>用于加密和解密笔记；保存在这台设备，丢失后无法恢复云端笔记。</span><input type="password" value={secret} onChange={event => { setSecret(event.target.value); setRemote(null); }} placeholder="输入数据加密口令" autoComplete="off" /></label>
      {(folder || token || tokenPassphrase || secret) && <button className="clear-credentials" onClick={clearCredentials} type="button">清除已保存的配置</button>}
      <p className="credential-notice">{hasBundledToken ? 'Token 以密文打包；云端访问口令仅在当前页面暂存。' : 'Token 保存在当前浏览器。'}数据加密口令会保存在当前浏览器；请勿在共用设备上配置。</p>
      <button className="read-cloud" onClick={startSync} disabled={syncBusy}>{syncBusy ? '同步中…' : '开始同步'}</button>
      {syncError && <p className="sync-error" role="alert">{syncError}</p>}{syncMessage && <p className="sync-success" role="status">{syncMessage}</p>}
      {remote && <div className="sync-preview"><h3>同步预览</h3><div className="sync-counts"><span>本地 <strong>{notes.length}</strong> 条</span><span>云端 <strong>{remote.notes.length}</strong> 条</span></div><p>存在同一时间修改的笔记，或编辑与删除冲突。请选择要保留的一边，另一边将被覆盖。</p>{differences.length ? <ul className="diff-list">{differences.map((item, index) => <li key={`${item.kind}-${index}`}><span>{item.label}</span><em>{item.kind}</em></li>)}</ul> : <p className="same-notes">两边笔记内容相同。</p>}<div className="sync-choices"><button onClick={upload} disabled={syncBusy}>本地 → 云端</button><button onClick={download} disabled={syncBusy}>云端 → 本地</button></div></div>}
    </div></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
