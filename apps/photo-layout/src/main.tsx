import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [columns, setColumns] = useState(3);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map(file => URL.createObjectURL(file));
    setUrls(next);
    return () => next.forEach(URL.revokeObjectURL);
  }, [files]);
  return <main><header><h1>照片布局</h1><p>选择照片，调整列数，预览排版。</p></header><div className="controls"><label className="upload">添加照片<input type="file" accept="image/*" multiple onChange={event => { setFiles(previous => [...previous, ...Array.from(event.target.files || [])]); event.target.value = ''; }}/></label><label>列数 <select value={columns} onChange={event => setColumns(Number(event.target.value))}>{[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}</select></label><button onClick={() => setFiles([])} disabled={!files.length}>清空</button></div>{urls.length ? <div className="grid" style={{ '--columns': columns } as React.CSSProperties}>{urls.map((url, index) => <figure key={url}><img src={url} alt={files[index].name}/><figcaption>{files[index].name}</figcaption></figure>)}</div> : <div className="empty">尚未选择照片</div>}<footer>照片只在当前页面预览，刷新后会清空。</footer></main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
