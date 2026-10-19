import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readStored, saveStored, unlockTokenBox } from '@pwa-apps/shared';
import { ChevronLeft, Cloud, Database, NotebookPen, Plus, Search, Settings, X } from 'lucide-react';
import { getRemote, getRemoteIndex, indexFingerprint, mergeNotes, putRemote, storageRepository, validateFolder, verifyRepository, type Note } from './sync';
import { defaults, readLibrary, writeLibrary, type Category } from './storage';
import { createEncryption, encryptNote, decryptNote, unlockEncryption } from './crypto';
import './style.css';
const MarkdownEditor = React.lazy(() => import('./markdown').then(module => ({ default: module.MarkdownEditor })));
const MarkdownPreview = React.lazy(() => import('./markdown').then(module => ({ default: module.MarkdownPreview })));

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
  
  const [showSync, setShowSync] = useState(false);
  const [folder, setFolder] = useState(() => readStored<Credentials>(credentialsKey, { folder: '', token: '' }).folder);
  const [token, setToken] = useState(() => hasBundledToken ? '' : readStored<Credentials>(credentialsKey, { folder: '', token: '' }).token);
  const [tokenPassphrase, setTokenPassphrase] = useState(() => localStorage.getItem(tokenPassphraseKey) || '');
  const [secret, setSecret] = useState(() => readStored<Credentials>(credentialsKey, { folder: '', token: '' }).secret ?? '');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [categories, setCategories] = useState<Category[]>(() => readStored('notes:categories', defaults));
  const [subpage, setSubpage] = useState<'' | 'categories' | 'trash' | 'backup' | 'editor'>('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('updated');
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState('正在加载');
  const [categoryName, setCategoryName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [preferences, setPreferences] = useState(() => readStored('notes:preferences', { theme: 'system', fontSize: 17, preview: false }));
  const [preview, setPreview] = useState(false);
  const history = useRef<{ past: Note[]; future: Note[] }>({ past: [], future: [] });
  const notesRef = useRef(notes);
  const categoriesRef = useRef(categories);
  const saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    readLibrary().then(async value => {
      if (value) { notesRef.current = value.notes; categoriesRef.current = value.categories; setNotes(value.notes); setCategories(value.categories); }
      else await writeLibrary({ notes: notesRef.current, categories: categoriesRef.current });
      setReady(true); setSaveState('已保存');
    }).catch(() => { setSaveState('本地数据库不可用，请备份数据'); });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    saveStored('notes:preferences', preferences);
  }, [preferences]);
  function persist(items: Note[], groups = categoriesRef.current) {
    setSaveState('保存中…');
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => writeLibrary({ notes: items, categories: groups }));
    const pending = saveQueue.current;
    pending.then(() => { if (saveQueue.current === pending) setSaveState('已保存'); }).catch(() => setSaveState('保存失败，请立即导出备份'));
  }
  function changeCategories(groups: Category[]) { categoriesRef.current = groups; setCategories(groups); persist(notesRef.current, groups); }
  function openNote(id: string) { history.current = { past: [], future: [] }; setPreview(preferences.preview); setSelected(id); }
  function patchNote(id: string, patch: Partial<Note>) { update(notesRef.current.map(n => n.id === id ? { ...n, ...patch, updated: Date.now() } : n)); }
  function undo(redo = false) {
    if (!current) return;
    const source = redo ? history.current.future : history.current.past;
    const target = redo ? history.current.past : history.current.future;
    const value = source.pop();
    if (value) { target.push(current); patchNote(current.id, value); }
  }
  function renameCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) { setRenameError('请输入分类名称'); return; }
    if (categoriesRef.current.some(c => c.id !== renaming.id && c.name === name)) { setRenameError('该分类名称已存在'); return; }
    const groups = categoriesRef.current.map(c => c.id === renaming.id ? { ...c, name } : c);
    categoriesRef.current = groups; setCategories(groups);
    update(notesRef.current.map(n => n.categoryId === renaming.id ? { ...n, categoryName: name, updated: Date.now() } : n));
    setRenaming(null); setRenameError('');
  }
  function deleteCategory(group: Category) {
    if (!confirm(`删除「${group.name}」分类？笔记将归入未分类。`)) return;
    const groups = categoriesRef.current.filter(c => c.id !== group.id);
    categoriesRef.current = groups; setCategories(groups);
    update(notesRef.current.map(n => n.categoryId === group.id ? { ...n, categoryId: 'uncategorized', categoryName: '未分类', updated: Date.now() } : n));
    if (category === group.id) setCategory('all');
  }
  async function exportBackup() {
    try {
      if (!backupPassword) throw new Error('请先输入备份口令。');
      const setup = await createEncryption(backupPassword);
      const data = await encryptNote({ version: 1, notes: notesRef.current, categories: categoriesRef.current }, setup.key);
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'notebook-backup', metadata: setup.metadata, data })], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `笔记簿-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('加密备份已下载，请妥善保存口令。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '导出失败'); }
  }
  async function importBackup(file?: File) {
    if (!file) return;
    try {
      if (!backupPassword) throw new Error('请输入备份口令。');
      const envelope = JSON.parse(await file.text());
      if (envelope.format !== 'notebook-backup') throw new Error('不支持此备份格式。');
      const key = await unlockEncryption(backupPassword, envelope.metadata);
      const data = await decryptNote<{ notes: Note[]; categories: Category[] }>(envelope.data, key);
      if (!Array.isArray(data.notes) || !Array.isArray(data.categories) || data.notes.some(n => typeof n.id !== 'string' || !/^[\w-]{1,100}$/.test(n.id) || typeof n.title !== 'string' || typeof n.body !== 'string' || !Number.isFinite(n.updated)) || data.categories.some(c => typeof c.id !== 'string' || typeof c.name !== 'string' || !Number.isFinite(c.order))) throw new Error('备份内容无效。');
      if (!confirm(`导入 ${data.notes.length} 篇笔记？现有内容将保留，同名版本冲突会保留副本。`)) return;
      const groups = [...categoriesRef.current];
      for (const c of data.categories) if (!groups.some(g => g.id === c.id)) groups.push(c);
      categoriesRef.current = groups; setCategories(groups);
      update(mergeNotes(notesRef.current, data.notes, null).notes); await saveQueue.current; setNotice('备份已恢复。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '恢复失败'); }
  }
  
  
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
  const activeNotes = notes.filter(n => !n.deletedAt);
  const visible = [...activeNotes]
    .filter(note => `${note.title} ${note.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .filter(note => category === 'all' || (note.categoryId || 'uncategorized') === category)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : b.updated - a.updated));
  const categoryLabel = (note: Note) => categories.find(c => c.id === note.categoryId)?.name || note.categoryName || '未分类';
  function update(next: Note[]) {
    const groups = [...categoriesRef.current];
    for (const note of next) {
      if (note.categoryId && !groups.some(c => c.id === note.categoryId)) groups.push({ id: note.categoryId, name: note.categoryName || '导入分类', order: groups.length });
    }
    categoriesRef.current = groups; setCategories(groups);
    notesRef.current = next; setNotes(next); persist(next, groups);
  }
  function add() {
    const now = Date.now();
    const group = categories.find(c => c.id === category);
    const note: Note = { id: crypto.randomUUID(), title: '', body: '', created: now, updated: now, categoryId: group?.id || 'uncategorized', categoryName: group?.name || '未分类', pinned: false, deletedAt: null };
    update([note, ...notesRef.current]); openNote(note.id);
  }
  function edit(patch: Partial<Note>) {
    if (current) { history.current.past.push(current); if (history.current.past.length > 100) history.current.past.shift(); history.current.future = []; patchNote(current.id, patch); }
  }
  function remove(id: string) {
    patchNote(id, { deletedAt: Date.now() });
    if (selected === id) setSelected(null);
  }
  function closeSync() { setShowSync(false);  }
  function openSync() { setShowSync(true);  setSyncError(''); setSyncMessage(''); }
  function syncNow() { if (syncConfigured) void startSync(); else openSync(); }
  async function sendLocal(cloud: Awaited<ReturnType<typeof getRemote>>, items: Note[] = notesRef.current) {
    const localAtStart = notesRef.current;
    const auth = await accessToken();
    const latest = await getRemoteIndex(folder, auth);
    if (indexFingerprint(latest) !== cloud.fingerprint) throw new Error('云端笔记已变化，请重新同步。');
    await putRemote(folder, auth, secret, items, cloud);
    const updated = await getRemote(folder, auth, secret);
    const merged = mergeNotes(notesRef.current, updated.notes, localAtStart).notes;
    update(merged);
    saveStored(baselineKey(validateFolder(folder)), snapshot(updated.notes));
    saveStored(indexKey(validateFolder(folder)), updated.fingerprint);
    saveStored(lastSyncKey(validateFolder(folder)), Date.now());
    
    setSyncMessage('本地笔记已同步到云端。');
    await saveQueue.current;
  }
  function receiveCloud(cloud: Awaited<ReturnType<typeof getRemote>>) {
    update(mergeNotes(notesRef.current, cloud.notes, notes).notes);
    saveStored(baselineKey(validateFolder(folder)), snapshot(cloud.notes));
    saveStored(indexKey(validateFolder(folder)), cloud.fingerprint);
    saveStored(lastSyncKey(validateFolder(folder)), Date.now());
    
    setSyncMessage('云端笔记已同步到本地。');
  }
  async function startSync() {
    try {
      setSyncBusy(true); setSyncError(''); setSyncMessage(''); 
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
        const plan = mergeNotes(notesRef.current, cloud.notes, baseNotes);
        update(plan.notes);
        await saveQueue.current;
        await sendLocal(cloud, plan.notes);
        setSyncMessage(plan.conflicts.length ? `同步完成，保留了 ${plan.conflicts.length} 篇冲突副本。` : '已安全合并并同步两边笔记。');
      }
    } catch (error) { setSyncError(error instanceof Error ? error.message : '同步失败。'); }
    finally { setSyncBusy(false); }
  }
  function clearCredentials() {
    localStorage.removeItem(credentialsKey);
    localStorage.removeItem(tokenPassphraseKey);
    tokenCache.current = null;
    setFolder(''); setToken(''); setTokenPassphrase(''); setSecret('');  setSyncMessage('已清除这台设备保存的同步配置。');
  }
  const groupSelect = (note: Note) => <select aria-label="所属分类" value={note.categoryId || 'uncategorized'} onChange={e => patchNote(note.id, { categoryId: e.target.value, categoryName: categories.find(c => c.id === e.target.value)?.name })}>{!categories.some(c => c.id === note.categoryId) && note.categoryId && <option value={note.categoryId}>{categoryLabel(note)}</option>}{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
  return <div className={`notes-app ${current ? 'editing' : ''}`}>
    {!current && <header className="app-top"><div className="app-brand"><span><NotebookPen aria-hidden="true" /></span><strong>笔记簿</strong></div><details className="menu"><summary aria-label="更多操作">•••</summary><div><button onClick={() => setSubpage('categories')}>分类管理</button><button onClick={() => setSubpage('trash')}>回收站</button></div></details></header>}
    <main className="app-content">
    {!ready ? <div className="empty">{saveState}</div> : current ? <section className="detail">
      <div className="detail-bar"><button className="back" onClick={() => setSelected(null)}><ChevronLeft />返回</button><span className="saved" role="status">{saveState}</span><details className="menu"><summary aria-label="笔记更多操作">•••</summary><div><button onClick={() => edit({ pinned: !current.pinned })}>{current.pinned ? '取消置顶' : '置顶笔记'}</button><button className="danger" onClick={() => remove(current.id)}>移至回收站</button></div></details></div>
      <input className="title-input" aria-label="标题" value={current.title} onChange={event => edit({ title: event.target.value })} placeholder="笔记标题" />
      <div className="editor-meta">{groupSelect(current)}<small>{formatTime(current.updated)}</small></div>
      <div className="editor-tools"><button onClick={() => undo()} disabled={!history.current.past.length}>撤销</button><button onClick={() => undo(true)} disabled={!history.current.future.length}>重做</button><button className={!preview ? 'chosen' : ''} onClick={() => setPreview(false)}>Markdown</button><button className={preview ? 'chosen' : ''} onClick={() => setPreview(true)}>预览</button></div>
      <React.Suspense fallback={<p className="muted">正在加载编辑器…</p>}>
        {preview ? <div className="markdown" style={{ fontSize: preferences.fontSize }}><MarkdownPreview body={current.body} /></div> : <MarkdownEditor value={current.body} onChange={body => edit({ body })} fontSize={preferences.fontSize} theme={preferences.theme} />}
      </React.Suspense>
    </section> : subpage ? <section className="secondary"><div className="page-heading"><button className="back" onClick={() => { setSubpage(''); setNotice(''); }}><ChevronLeft />返回</button><h1>{{ categories: '分类管理', trash: '回收站', backup: '数据导入与导出', editor: '编辑器设置' }[subpage]}</h1></div>
      {subpage === 'categories' && <><form className="category-form" onSubmit={e => { e.preventDefault(); const name = categoryName.trim(); if (!name || categories.some(c => c.name === name)) { setNotice('请输入不重复的分类名称'); return; } changeCategories([...categories, { id: crypto.randomUUID(), name, order: categories.length }]); setCategoryName(''); setNotice(''); }}><input aria-label="新分类名称" placeholder="新分类名称" maxLength={30} value={categoryName} onChange={e => setCategoryName(e.target.value)} /><button className="primary">新增</button></form><div className="settings-card">{categories.map(c => <div className="category-row" key={c.id}>{renaming?.id === c.id ? <form className="rename-form" onSubmit={renameCategory}><div className="rename-controls"><input autoFocus aria-label="分类名称" aria-invalid={Boolean(renameError)} aria-describedby={renameError ? 'rename-error' : undefined} maxLength={30} value={renaming.name} onChange={e => { setRenaming({ ...renaming, name: e.target.value }); setRenameError(''); }} onKeyDown={e => { if (e.key === 'Escape') { setRenaming(null); setRenameError(''); } }} /><button type="submit">保存</button><button type="button" onClick={() => { setRenaming(null); setRenameError(''); }}>取消</button></div>{renameError && <p id="rename-error" className="sync-error" role="alert">{renameError}</p>}</form> : <><span><strong>{c.name}</strong><small>{activeNotes.filter(n => (n.categoryId || 'uncategorized') === c.id).length} 篇笔记</small></span>{c.id !== 'uncategorized' && <><button onClick={() => { setRenaming({ id: c.id, name: c.name }); setRenameError(''); }}>重命名</button><button className="danger" onClick={() => deleteCategory(c)}>删除</button></>}</>}</div>)}</div></>}
      {subpage === 'trash' && <><p className="muted">已删除笔记会保留在这里，可随时恢复。</p>{notes.some(n => n.deletedAt) && <button className="danger" onClick={() => { if (confirm('永久清空回收站？此操作无法撤销。')) update(notesRef.current.filter(n => !n.deletedAt)); }}>清空回收站</button>}{notes.filter(n => n.deletedAt).map(n => <div className="settings-card trash-row" key={n.id}><span><strong>{n.title || '无标题'}</strong><small>{formatTime(n.deletedAt!)}</small></span><button onClick={() => patchNote(n.id, { deletedAt: null })}>恢复</button></div>)}{!notes.some(n => n.deletedAt) && <div className="empty">回收站是空的</div>}</>}
      {subpage === 'backup' && <section className="settings-card"><h2>加密备份与恢复</h2><p>备份包含全部笔记、分类及回收站。恢复时保留现有笔记；请保存好口令。</p><label className="field">备份口令<input type="password" autoComplete="new-password" value={backupPassword} onChange={e => setBackupPassword(e.target.value)} /></label><div className="settings-actions"><button className="primary" onClick={exportBackup}>下载加密备份</button><label className="import-button">导入备份<input type="file" accept=".json,application/json" onChange={e => { void importBackup(e.target.files?.[0]); e.target.value = ''; }} /></label></div></section>}
      {subpage === 'editor' && <section className="settings-card"><label className="field">默认打开方式<select value={String(preferences.preview)} onChange={e => setPreferences({ ...preferences, preview: e.target.value === 'true' })}><option value="false">Markdown 编辑</option><option value="true">Markdown 预览</option></select></label><label className="field">字体大小<select value={preferences.fontSize} onChange={e => setPreferences({ ...preferences, fontSize: Number(e.target.value) })}>{[15, 17, 19, 21].map(size => <option key={size} value={size}>{size}px</option>)}</select></label><label className="field">主题外观<select value={preferences.theme} onChange={e => setPreferences({ ...preferences, theme: e.target.value })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><p>自动保存已开启 · 每次修改均写入本地数据库</p></section>}
      {notice && <p role="status">{notice}</p>}
    </section> : page === 'notes' ? <section className="list-page">
      <div className="topline"><h1>我的笔记</h1><div className="list-controls"><select aria-label="笔记排序" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">最近修改</option><option value="title">按标题</option></select><p>共 {activeNotes.length} 篇</p></div></div>
      <label className="search"><Search aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题和笔记内容" aria-label="搜索标题和笔记内容" /></label>
      <div className="category-filter"><div className="category-tabs">{[{ id: 'all', name: '全部' }, ...categories.filter(c => c.id !== 'uncategorized')].map(c => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => setCategory(c.id)}>{c.name}</button>)}</div><button className="icon-button" onClick={() => setSubpage('categories')} aria-label="管理分类"><Settings /></button></div>
      {visible.length ? <div className="note-list">{visible.map(note => <article className="note-card" key={note.id}><button className="note-open" onClick={() => openNote(note.id)}><span className="note-title">{note.pinned && <span className="pin">置顶 · </span>}{note.title.trim() || '无标题'}</span><span className="note-preview">{note.body.trim().replace(/\s+/g, ' ') || '暂无内容，点击开始记录'}</span><span className="note-footer"><span className="badge">{categoryLabel(note)}</span><span>{formatTime(note.updated)}</span></span></button><details className="menu card-menu"><summary aria-label={`${note.title || '无标题'}的更多操作`}>•••</summary><div><button onClick={() => patchNote(note.id, { pinned: !note.pinned })}>{note.pinned ? '取消置顶' : '置顶'}</button>{groupSelect(note)}<button className="danger" onClick={() => remove(note.id)}>移至回收站</button></div></details></article>)}</div> : <div className="empty"><NotebookPen /><strong>{query || category !== 'all' ? '没有找到笔记' : '记录从这里开始'}</strong><p>{query || category !== 'all' ? '试试其他关键词或分类' : '点击右下角 ＋，写下第一篇笔记'}</p></div>}
      <button className="fab" onClick={add} aria-label="新建笔记"><Plus /></button>
    </section> : <section className="settings-page"><h1>设置</h1>
      <section className="settings-card"><h2><Cloud />数据同步与备份</h2><div className="sync-summary"><span /><div><strong>{saveState === '已保存' ? '本地数据已保存' : saveState}</strong><small>最近同步：{syncTime}</small></div></div><p>{hasLocalChanges ? '有本地更新待同步' : '本地与云端状态已记录'} · 冲突时保留副本</p><div className="settings-actions"><button className="primary" onClick={syncNow} disabled={syncBusy || !ready}>{syncBusy ? '同步中…' : '立即同步'}</button><button onClick={openSync}>同步配置</button></div>{syncError && <p className="sync-error" role="alert">{syncError}</p>}{syncMessage && <p role="status">{syncMessage}</p>}</section>
      <section className="settings-card"><h2><Database />数据导入与导出</h2><p>导出加密文件留存，或从备份恢复笔记。</p><button className="card-link" onClick={() => setSubpage('backup')}>管理数据 →</button></section>
      <section className="settings-card"><h2>数据概况</h2><p className="note-count">{activeNotes.length} 篇笔记 · {categories.length} 个分类</p><p>本地数据：{(new Blob([JSON.stringify({ notes, categories })]).size / 1024).toFixed(1)} KB<br />最近修改：{notes.length ? formatTime(Math.max(...notes.map(n => n.updated))) : '暂无记录'}</p></section>
      <section className="settings-card"><h2>笔记管理</h2><p>分类管理、回收站、已删除笔记恢复</p><div className="settings-actions"><button onClick={() => setSubpage('categories')}>分类管理 →</button><button onClick={() => setSubpage('trash')}>回收站（{notes.filter(n => n.deletedAt).length}）→</button></div></section>
      <section className="settings-card"><h2><Settings />编辑器设置</h2><p>Markdown、字体大小、主题外观</p><button className="card-link" onClick={() => setSubpage('editor')}>编辑偏好 →</button></section>
    </section>}
    </main>
    {!current && !subpage && <nav className="bottom-nav" aria-label="主导航"><button className={page === 'notes' ? 'active' : ''} onClick={() => setPage('notes')}><NotebookPen />笔记</button><button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><Settings />设置</button></nav>}
    {showSync && <div className="modal-backdrop" onClick={closeSync}><div className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-title" onClick={event => event.stopPropagation()}>
      <div className="dialog-heading"><h2 id="sync-title">同步配置</h2><button className="close-dialog" onClick={closeSync} aria-label="关闭"><X aria-hidden="true" /></button></div>
      <p className="repo-name">私有仓库：{storageRepository} / notes/{folder.trim() || '<名字>'}。不同名字使用不同云端文件夹。</p>
      <label className="field">云端名字<input value={folder} onChange={event => { setFolder(event.target.value);  }} placeholder="字母、数字、下划线或连字符" autoComplete="username" /></label>
      {hasBundledToken ? <label className="field">云端访问口令<input type="password" value={tokenPassphrase} onChange={event => { setTokenPassphrase(event.target.value); if (event.target.value) localStorage.setItem(tokenPassphraseKey, event.target.value); else localStorage.removeItem(tokenPassphraseKey); tokenCache.current = null;  }} placeholder="用于解锁 GitHub 访问凭证" autoComplete="off" /></label> :
        <label className="field">GitHub Token<input type="password" value={token} onChange={event => { setToken(event.target.value);  }} placeholder="Contents: Read and write" autoComplete="off" /></label>
      }
      <label className="field">数据加密口令<input type="password" value={secret} onChange={event => { setSecret(event.target.value);  }} placeholder="用于加密和解密笔记" autoComplete="off" /></label>
      {(folder || token || tokenPassphrase || secret) && <button className="clear-credentials" onClick={clearCredentials} type="button">清除已保存的配置</button>}
      <button className="read-cloud" onClick={startSync} disabled={syncBusy || !ready}>{syncBusy ? '同步中…' : '保存并同步'}</button>
      {syncError && <p className="sync-error" role="alert">{syncError}</p>}{syncMessage && <p className="sync-success" role="status">{syncMessage}</p>}

    </div></div>}
  </div>;
}

function formatTime(value: number) {
  const date = new Date(value), today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return date.toLocaleDateString('zh-CN', { year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric' });
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
