import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readStored, saveStored, unlockTokenBox } from '@pwa-apps/shared';
import { ChevronLeft, Cloud, Database, NotebookPen, Plus, Search, Settings, Trash2, X } from 'lucide-react';
import { getRemote, getRemoteIndex, indexFingerprint, mergeNotes, putRemote, storageRepository, validateFolder, verifyRepository, type Note } from './sync';
import './style.css';

const key = 'pwa-apps:notes';
const credentialsKey = 'pwa-apps:notes:github-credentials';
const tokenPassphraseKey = 'pwa-apps:notes:cloud-passphrase';
const bundledTokenBox = import.meta.env.VITE_GITHUB_TOKEN_BOX || '';
const hasBundledToken = Boolean(bundledTokenBox.trim());
const bundledTokenMarker = 'encrypted-build';
type Credentials = { folder: string; token: string; secret?: string };
const baselineKey = (folder: string) => `pwa-apps:notes:sync:${storageRepository}:${folder}`;
const indexKey = (folder: string) => `pwa-apps:notes:index:${storageRepository}:${folder}`;
const lastSyncKey = (folder: string) => `pwa-apps:notes:last-sync:${storageRepository}:${folder}`;
const snapshot = (items: Note[]) => JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)));

function App() {
  const [page, setPage] = useState<'notes' | 'settings'>('notes');
  const [notes, setNotes] = useState<Note[]>(() => readStored(key, []));
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openSwipe, setOpenSwipe] = useState<string | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [folder, setFolder] = useState(() => readStored<Credentials>(credentialsKey, { folder: '', token: '' }).folder);
  const [token, setToken] = useState(() => hasBundledToken ? '' : readStored<Credentials>(credentialsKey, { folder: '', token: '' }).token);
  const [tokenPassphrase, setTokenPassphrase] = useState(() => localStorage.getItem(tokenPassphraseKey) || '');
  const [secret, setSecret] = useState(() => readStored<Credentials>(credentialsKey, { folder: '', token: '' }).secret ?? '');
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
  useEffect(() => {
    if (!showSync) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [showSync]);
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
  const hasLocalChanges = savedBaseline !== null ? savedBaseline !== snapshot(notes) : notes.length > 0;
  const syncConfigured = /^[\w-]{1,60}$/.test(folder.trim()) && Boolean(secret) && Boolean(hasBundledToken ? tokenPassphrase : token.trim());
  const syncTime = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '尚无同步记录';
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
  function remove(id: string, confirmFirst = false) {
    const target = notes.find(note => note.id === id);
    if (confirmFirst && !confirm(`删除「${target?.title.trim() || '无标题'}」？此操作无法撤销。`)) return;
    update(notes.filter(note => note.id !== id));
    setOpenSwipe(null);
    if (selected === id) setSelected(null);
  }
  function closeSync() { setShowSync(false); setRemote(null); }
  function openSync() { setShowSync(true); setRemote(null); setSyncError(''); setSyncMessage(''); }
  function syncNow() { if (syncConfigured) void startSync(); else openSync(); }
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
          setShowSync(true);
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
    localStorage.removeItem(tokenPassphraseKey);
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

  return <div className="notes-app">
    <header className="app-top"><div className="app-brand"><span><NotebookPen aria-hidden="true" strokeWidth={1.8} /></span><strong>随手记</strong>{folder.trim() && <small>{folder.trim()}</small>}</div></header>
    <main className="app-content">
    {current ? <section className="detail">
      <div className="detail-bar"><button className="back" onClick={() => setSelected(null)} aria-label="返回笔记列表"><ChevronLeft aria-hidden="true" />笔记</button><div className="detail-actions"><span className="saved">自动保存</span><button className="delete-note" onClick={() => remove(current.id, true)} aria-label="删除当前笔记" title="删除笔记"><Trash2 aria-hidden="true" /></button></div></div>
      <input className="title-input" aria-label="标题" value={current.title} onChange={event => edit({ title: event.target.value })} placeholder="标题" />
      <p className="edit-date">{new Date(current.updated).toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      <textarea aria-label="内容" value={current.body} onChange={event => edit({ body: event.target.value })} placeholder="开始记录…" />
    </section> : page === 'notes' ? <section className="list-page">
      <div className="topline"><h1>全部笔记{notes.length > 0 && <span>{notes.length}</span>}</h1><button className="new-note" onClick={add} aria-label="新建笔记" title="新建笔记"><Plus aria-hidden="true" strokeWidth={2} /></button></div>
      <label className="search"><Search aria-hidden="true" /><input type="search" value={query} onChange={event => { setQuery(event.target.value); setOpenSwipe(null); }} placeholder="搜索笔记" aria-label="搜索笔记" /></label>
      {visible.length ? <div className="note-list">{visible.map(note => <div className={`swipe-row ${openSwipe === note.id ? 'revealed' : ''}`} key={note.id} onTouchStart={event => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; swiped.current = false; }} onTouchEnd={event => endSwipe(event, note.id)}>
        <button className="delete-action" onClick={() => remove(note.id)} aria-label={`删除${note.title || '无标题'}笔记`}>删除</button>
        <button className="note-card" onClick={() => { if (swiped.current) { swiped.current = false; return; } if (openSwipe === note.id) { setOpenSwipe(null); return; } setSelected(note.id); }}>
          <span className="note-title">{note.title.trim() || '无标题'}</span>
          <span className="note-preview">{note.body.trim().replace(/\s+/g, ' ') || '暂无内容，点击开始记录'}</span>
          <span className="note-date">{new Date(note.updated).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span>
        </button>
      </div>)}</div> : <div className="empty"><div className="empty-icon"><NotebookPen aria-hidden="true" /></div><strong>{query ? '没有找到笔记' : '记录从这里开始'}</strong><p>{query ? '试试其他关键词' : '点击右上角的加号，写下第一条笔记'}</p></div>}
    </section> : <section className="settings-page">
      <div className="page-label">设置</div>
      <section className="settings-card"><h2><Cloud aria-hidden="true" />云端同步</h2><div className={`sync-summary ${hasLocalChanges ? 'pending' : lastSyncAt ? 'synced' : 'idle'}`}><span aria-hidden="true"/><div><strong>{hasLocalChanges ? '本地有更新待同步' : lastSyncAt ? '已与云端同步' : '尚未产生本地数据'}</strong><small>{lastSyncAt ? `上次同步 ${syncTime}` : syncTime}</small></div></div><p>同步时自动比较本地与云端笔记，并安全合并两边修改。</p><div className="settings-actions"><button className="sync-now" onClick={syncNow} disabled={syncBusy}>{syncBusy ? '同步中…' : '立即同步'}</button><button onClick={openSync}>同步配置</button></div>{syncError && <p className="sync-error" role="alert">{syncError}</p>}{syncMessage && !remote && <p className="sync-success" role="status">{syncMessage}</p>}</section>
      <section className="settings-card"><h2><Database aria-hidden="true" />数据概况</h2><p className="note-count"><strong>{notes.length}</strong> 条笔记</p><p>笔记保存在当前浏览器，同步成功后会加密保存到私有 GitHub 仓库。</p></section>
    </section>}
    </main>
    {!current && <nav className="bottom-nav"><button className={page === 'notes' ? 'active' : ''} onClick={() => setPage('notes')}><NotebookPen aria-hidden="true" strokeWidth={1.8}/>笔记</button><button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><Settings aria-hidden="true" strokeWidth={1.8}/>设置</button></nav>}
    {showSync && <div className="modal-backdrop" onClick={closeSync}><div className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-title" onClick={event => event.stopPropagation()}>
      <div className="dialog-heading"><h2 id="sync-title">同步配置</h2><button className="close-dialog" onClick={closeSync} aria-label="关闭"><X aria-hidden="true" /></button></div>
      <p className="repo-name">私有仓库：{storageRepository} / notes/{folder.trim() || '<名字>'}。不同名字使用不同云端文件夹。</p>
      <label className="field">云端名字<input value={folder} onChange={event => { setFolder(event.target.value); setRemote(null); }} placeholder="字母、数字、下划线或连字符" autoComplete="username" /></label>
      {hasBundledToken ? <label className="field">云端访问口令<input type="password" value={tokenPassphrase} onChange={event => { setTokenPassphrase(event.target.value); if (event.target.value) localStorage.setItem(tokenPassphraseKey, event.target.value); else localStorage.removeItem(tokenPassphraseKey); tokenCache.current = null; setRemote(null); }} placeholder="用于解锁 GitHub 访问凭证" autoComplete="off" /></label> :
        <label className="field">GitHub Token<input type="password" value={token} onChange={event => { setToken(event.target.value); setRemote(null); }} placeholder="Contents: Read and write" autoComplete="off" /></label>
      }
      <label className="field">数据加密口令<input type="password" value={secret} onChange={event => { setSecret(event.target.value); setRemote(null); }} placeholder="用于加密和解密笔记" autoComplete="off" /></label>
      {(folder || token || tokenPassphrase || secret) && <button className="clear-credentials" onClick={clearCredentials} type="button">清除已保存的配置</button>}
      <button className="read-cloud" onClick={startSync} disabled={syncBusy}>{syncBusy ? '同步中…' : '保存并同步'}</button>
      {syncError && <p className="sync-error" role="alert">{syncError}</p>}{syncMessage && <p className="sync-success" role="status">{syncMessage}</p>}
      {remote && <div className="sync-preview"><h3>同步预览</h3><div className="sync-counts"><span>本地 <strong>{notes.length}</strong> 条</span><span>云端 <strong>{remote.notes.length}</strong> 条</span></div><p>存在同一时间修改的笔记，或编辑与删除冲突。请选择要保留的一边，另一边将被覆盖。</p>{differences.length ? <ul className="diff-list">{differences.map((item, index) => <li key={`${item.kind}-${index}`}><span>{item.label}</span><em>{item.kind}</em></li>)}</ul> : <p className="same-notes">两边笔记内容相同。</p>}<div className="sync-choices"><button onClick={upload} disabled={syncBusy}>本地 → 云端</button><button onClick={download} disabled={syncBusy}>云端 → 本地</button></div></div>}
    </div></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
