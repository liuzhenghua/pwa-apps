import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { captionFonts, defaultAdjustment, defaultCaption, defaultMargins, getLayout, initialFrames, renderLayout, templates, type Caption, type Frame, type Margins, type PhotoAdjustment, type TemplateId } from './render-layout';
import { TEXT_POOL } from './text-pool';
import './style.css';

type FrameDrag = { index: number; mode: 'move' | 'resize'; startX: number; startY: number; start: Frame; moved: boolean };

function TemplateArt({ template }: { template: TemplateId }) {
  if (!template.startsWith('pip-')) return <span className={`template-mini ${template}`} aria-hidden="true"><i/><i/><i/><i/></span>;
  const layout = getLayout(template);
  return <svg className={`template-art ${template}`} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
    <rect width={layout.width} height={layout.height} fill="#f1f5f9"/>
    <g fill="none" stroke="#d0dae3" strokeWidth="22"><rect x={layout.width / 2 - 60} y={layout.height / 2 - 70} width="120" height="100" rx="12"/><path d={`M${layout.width / 2 - 58} ${layout.height / 2 + 20}l35-38 26 26 20-17 35 30`}/></g>
    <text x={layout.width / 2} y={layout.height / 2 + 100} textAnchor="middle" fill="#cbd5e1" fontSize="42" fontWeight="700">点击上传背景</text>
    {initialFrames(template).map((frame, index) => <g key={index} transform={`rotate(${frame.rotation} ${frame.x + frame.w / 2} ${frame.y + frame.h / 2})`}><rect x={frame.x - 7} y={frame.y - 7} width={frame.w + 14} height={frame.h + 14} fill="#fff"/><rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#dfe6ed"/></g>)}
  </svg>;
}

function App() {
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [slotFiles, setSlotFiles] = useState<(File | null)[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [adjustments, setAdjustments] = useState<PhotoAdjustment[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [margins, setMargins] = useState<Margins>({ horizontal: 0, vertical: 0 });
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [quality, setQuality] = useState(2);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const [fileUrls, setFileUrls] = useState<(string | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const activeSlot = useRef(0);
  const frameDrag = useRef<FrameDrag | null>(null);
  const suppressClick = useRef(false);
  const cropDrag = useRef<{ x: number; y: number; offsetX: number; offsetY: number; index: number } | null>(null);

  useEffect(() => {
    const urls = slotFiles.map(file => file ? URL.createObjectURL(file) : null);
    setFileUrls(urls);
    return () => urls.forEach(url => { if (url) URL.revokeObjectURL(url); });
  }, [slotFiles]);

  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    let createdUrl = '';
    setResult(null);
    setBusy(true);
    const timer = window.setTimeout(() => {
      renderLayout(slotFiles, template, frames, adjustments, quality, captions, margins).then(blob => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setResult({ blob, url: createdUrl });
      }).catch(() => {
        if (!cancelled) setMessage('照片处理失败，请重新选择这张照片。');
      }).finally(() => {
        if (!cancelled) setBusy(false);
      });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [slotFiles, template, frames, adjustments, quality, captions, margins]);

  function openTemplate(next: TemplateId) {
    const count = getLayout(next).slots.length;
    setTemplate(next);
    setFrames(initialFrames(next));
    setSlotFiles(Array(count).fill(null));
    setAdjustments(Array.from({ length: count }, defaultAdjustment));
    setCaptions(Array.from({ length: count }, (_, index) => defaultCaption(index)));
    setMargins(defaultMargins(next));
    setSelectedSlot(next.startsWith('polaroid-') ? 0 : null);
    setResult(null);
    setMessage('');
  }

  function chooseSlot(index: number) {
    activeSlot.current = index;
    setSelectedSlot(index);
    inputRef.current?.click();
  }

  function setSlotFile(file: File) {
    setResult(null);
    setBusy(true);
    setMessage('');
    setSlotFiles(current => current.map((item, index) => index === activeSlot.current ? file : item));
    setAdjustments(current => current.map((item, index) => index === activeSlot.current ? defaultAdjustment() : item));
  }

  function updateAdjustment(index: number, patch: Partial<PhotoAdjustment>) {
    setResult(null);
    setBusy(true);
    setAdjustments(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function updateCaption(index: number, patch: Partial<Caption>) {
    setCaptions(current => current.map((caption, i) => i === index ? { ...caption, ...patch } : caption));
  }

  function randomizeCaption(index: number) {
    const current = captions[index];
    const phrase = () => TEXT_POOL[Math.floor(Math.random() * TEXT_POOL.length)];
    const font = () => captionFonts[Math.floor(Math.random() * captionFonts.length)].value;
    updateCaption(index, { line1: phrase(), font1: font(), ...(current?.line2Enabled ? { line2: phrase(), font2: font() } : {}) });
  }

  function updateFrame(index: number, patch: Partial<Frame>) {
    setResult(null);
    setBusy(true);
    setFrames(current => current.map((item, i) => i === index - 1 ? { ...item, ...patch } : item));
  }

  function addFrame() {
    if (!template?.startsWith('pip-')) return;
    setResult(null);
    setBusy(true);
    const index = frames.length + 1;
    const width = template === 'pip-horizontal' ? 320 : 350;
    setFrames(current => [...current, { x: 120 + current.length * 24, y: 200 + current.length * 24, w: width, h: 240, rotation: 0 }]);
    setSlotFiles(current => [...current, null]);
    setAdjustments(current => [...current, defaultAdjustment()]);
    setSelectedSlot(index);
  }

  function removeSelected() {
    if (selectedSlot === null) return;
    setResult(null);
    setBusy(true);
    if (selectedSlot === 0 || !template?.startsWith('pip-')) {
      setSlotFiles(current => current.map((file, i) => i === selectedSlot ? null : file));
      setAdjustments(current => current.map((item, i) => i === selectedSlot ? defaultAdjustment() : item));
    } else {
      setFrames(current => current.filter((_, i) => i !== selectedSlot - 1));
      setSlotFiles(current => current.filter((_, i) => i !== selectedSlot));
      setAdjustments(current => current.filter((_, i) => i !== selectedSlot));
      setSelectedSlot(null);
    }
  }

  function onFramePointerDown(event: React.PointerEvent<HTMLButtonElement>, index: number) {
    if (index === 0 || !template?.startsWith('pip-')) return;
    const frame = frames[index - 1];
    if (!frame) return;
    const mode = (event.target as HTMLElement).closest('.frame-resizer') ? 'resize' : 'move';
    frameDrag.current = { index, mode, startX: event.clientX, startY: event.clientY, start: frame, moved: false };
    setSelectedSlot(index);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onFramePointerMove(event: React.PointerEvent<HTMLButtonElement>, width: number, height: number) {
    const drag = frameDrag.current;
    if (!drag || !canvasRef.current) return;
    const screen = canvasRef.current.getBoundingClientRect();
    const dx = (event.clientX - drag.startX) * width / screen.width;
    const dy = (event.clientY - drag.startY) * height / screen.height;
    if (Math.abs(dx) + Math.abs(dy) < 5 && !drag.moved) return;
    drag.moved = true;
    if (drag.mode === 'move') updateFrame(drag.index, { x: Math.max(0, Math.min(width - drag.start.w, Math.round(drag.start.x + dx))), y: Math.max(0, Math.min(height - drag.start.h, Math.round(drag.start.y + dy))) });
    else updateFrame(drag.index, { w: Math.max(80, Math.min(width - drag.start.x, Math.round(drag.start.w + dx))), h: Math.max(60, Math.min(height - drag.start.y, Math.round(drag.start.h + dy))) });
  }

  function onFramePointerUp() {
    if (frameDrag.current?.moved) suppressClick.current = true;
    frameDrag.current = null;
  }

  function onSlotClick(index: number) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setSelectedSlot(index);
    if (!slotFiles[index]) chooseSlot(index);
  }

  function download() {
    if (!result || !template) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = `照片排版-${template}-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setMessage('图片已生成。如未自动保存，请长按图片保存。');
  }

  async function share() {
    if (!result || !template) return;
    const image = new File([result.blob], `照片排版-${template}.jpg`, { type: 'image/jpeg' });
    if (!navigator.share || !navigator.canShare?.({ files: [image] })) {
      setMessage('当前浏览器不支持分享图片文件，请保存后从微信等应用中发送。');
      return;
    }
    try {
      await navigator.share({ files: [image], title: '照片排版' });
      setMessage('已交给系统分享面板。');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage('系统分享未完成，请保存图片后从目标应用发送。');
    }
  }

  if (!template) return <main className="app-shell home-page">
    <header className="page-header"><p className="eyebrow">照片布局</p><h1>选择排版</h1><p className="intro">选一个 6 寸模板，再为画面中的每个位置添加照片。</p></header>
    <div className="template-grid">{templates.map(item => <button key={item.id} type="button" className="template-card" onClick={() => openTemplate(item.id)}><span className="template-preview"><TemplateArt template={item.id}/></span><span className="template-copy"><strong>{item.name}</strong><small>{item.orientation} · 点击进入</small></span><span className="template-arrow" aria-hidden="true">›</span></button>)}</div>
  </main>;

  const layout = getLayout(template, frames, margins);
  const selectedTemplate = templates.find(item => item.id === template)!;
  const filledCount = slotFiles.filter(Boolean).length;
  const complete = filledCount === layout.slots.length && !busy && !!result;
  const activeAdjustment = selectedSlot === null ? null : adjustments[selectedSlot];
  const pip = template.startsWith('pip-');
  const polaroid = template.startsWith('polaroid-');
  const selectedCaption = selectedSlot === null ? null : captions[selectedSlot];

  return <main className="app-shell editor-page">
    <header className="editor-header"><button className="back-button" type="button" onClick={() => setTemplate(null)} aria-label="返回选择排版">‹ <span>排版</span></button><div><h1>{selectedTemplate.name}</h1><p>{selectedTemplate.orientation} 6 寸 · {filledCount}/{layout.slots.length} 个位置已添加</p></div></header>
    <p className="editor-tip">{pip ? '点击背景或相框添加照片；拖动相框移动位置，拖右下角调整大小。' : '点击画面中的位置，选择或更换对应照片。'}</p>
    <div className="canvas-wrap"><div ref={canvasRef} className={`layout-canvas ${pip ? 'pip-canvas' : ''}`} style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
      {!pip && (result ? <img src={result.url} alt={`${selectedTemplate.name}排版预览`}/> : <div className="render-loading">{busy ? '正在生成预览…' : '预览暂不可用'}</div>)}
      {layout.slots.map((slot, index) => <button key={index} type="button" className={`slot-target ${slotFiles[index] ? 'filled' : 'empty-slot'} ${selectedSlot === index ? 'active-slot' : ''} ${pip && index > 0 ? 'movable-slot pip-frame' : ''} ${pip && index === 0 ? 'pip-background' : ''}`} style={{ left: `${slot.rect.x / layout.width * 100}%`, top: `${slot.rect.y / layout.height * 100}%`, width: `${slot.rect.w / layout.width * 100}%`, height: `${slot.rect.h / layout.height * 100}%`, transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined }} aria-label={`${slotFiles[index] ? '选择' : '添加'}${slot.label}`} title={slot.label} onClick={() => onSlotClick(index)} onPointerDown={event => onFramePointerDown(event, index)} onPointerMove={event => onFramePointerMove(event, layout.width, layout.height)} onPointerUp={onFramePointerUp} onPointerCancel={onFramePointerUp}>
        {pip && <span className="pip-photo-area">{fileUrls[index] ? <img src={fileUrls[index]!} alt="" draggable={false} style={{ transform: `translate(${(adjustments[index]?.offsetX ?? 0) * 100}%, ${(adjustments[index]?.offsetY ?? 0) * 100}%) rotate(${adjustments[index]?.rotation ?? 0}deg) scale(${adjustments[index]?.zoom ?? 1})` }}/> : index === 0 ? <span className="pip-placeholder"><span className="photo-symbol" aria-hidden="true">▧</span>点击上传{template === 'pip-horizontal' ? '横版' : '竖版'}背景</span> : null}</span>}
        {!pip && <span className="edit-mark" aria-hidden="true">✎</span>}{pip && index > 0 && <span className="frame-resizer" aria-hidden="true"/>}
      </button>)}
    </div></div>
    <input ref={inputRef} className="file-input" type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) setSlotFile(file); event.target.value = ''; }}/>
    <div className="frame-actions">{pip && <button type="button" onClick={addFrame}>＋ 新增相框</button>}<label>导出画质 <select value={quality} onChange={event => { setResult(null); setBusy(true); setQuality(Number(event.target.value)); }}><option value={1}>标清 · 300 DPI</option><option value={2}>高清 · 450 DPI</option><option value={3}>超清 · 600 DPI</option></select></label></div>
    {(template === 'normal-2' || template === 'normal-4' || polaroid) && <div className="margin-controls"><strong>排版边距</strong><label>水平 <input type="range" min="0" max="180" step="2" value={margins.horizontal} onChange={event => setMargins(current => ({ ...current, horizontal: Number(event.target.value) }))}/><span>{margins.horizontal}</span></label><label>垂直 <input type="range" min="0" max="180" step="2" value={margins.vertical} onChange={event => setMargins(current => ({ ...current, vertical: Number(event.target.value) }))}/><span>{margins.vertical}</span></label></div>}
    <div className="slot-list">{layout.slots.map((slot, index) => <button key={index} type="button" className={`${slotFiles[index] ? 'assigned' : ''} ${selectedSlot === index ? 'selected' : ''}`} onClick={() => { setSelectedSlot(index); if (!slotFiles[index]) chooseSlot(index); }}><span>{slot.label}</span><strong>{slotFiles[index] ? '已添加' : '＋ 添加'}</strong></button>)}</div>
    {polaroid && selectedSlot === null && <p className="caption-tip">选择一张照片，可编辑拍立得下方的文字。</p>}
    {selectedSlot !== null && <section className="edit-panel"><div className="panel-heading"><strong>{layout.slots[selectedSlot]?.label}</strong><button type="button" onClick={() => chooseSlot(selectedSlot)}>{slotFiles[selectedSlot] ? '更换照片' : '添加照片'}</button></div>
      {polaroid && selectedCaption && <div className="caption-controls"><div className="caption-heading"><strong>拍立得文案</strong><button type="button" onClick={() => randomizeCaption(selectedSlot)}>随机文案</button></div><label>第一行<input type="text" value={selectedCaption.line1} placeholder="请输入第一行文字" onChange={event => updateCaption(selectedSlot, { line1: event.target.value })}/></label><label>字体<select value={selectedCaption.font1} onChange={event => updateCaption(selectedSlot, { font1: event.target.value })}>{captionFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><label className="caption-toggle"><input type="checkbox" checked={selectedCaption.line2Enabled} onChange={event => updateCaption(selectedSlot, { line2Enabled: event.target.checked })}/>启用第二行</label>{selectedCaption.line2Enabled && <><label>第二行<input type="text" value={selectedCaption.line2} placeholder="请输入第二行文字" onChange={event => updateCaption(selectedSlot, { line2: event.target.value })}/></label><label>字体<select value={selectedCaption.font2} onChange={event => updateCaption(selectedSlot, { font2: event.target.value })}>{captionFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label></>}</div>}
      {pip && selectedSlot > 0 && frames[selectedSlot - 1] && <div className="frame-controls"><div className="quick-actions"><button type="button" onClick={() => updateFrame(selectedSlot, { rotation: frames[selectedSlot - 1].rotation - 5 })}>↶ 左转 5°</button><button type="button" onClick={() => updateFrame(selectedSlot, { rotation: frames[selectedSlot - 1].rotation + 5 })}>↷ 右转 5°</button><button type="button" className="remove-button" onClick={removeSelected}>移除相框</button></div><label>相框宽度 <input type="range" min="80" max={Math.min(600, layout.width - frames[selectedSlot - 1].x)} value={frames[selectedSlot - 1].w} onChange={event => updateFrame(selectedSlot, { w: Number(event.target.value) })}/></label><label>相框高度 <input type="range" min="60" max={Math.min(500, layout.height - frames[selectedSlot - 1].y)} value={frames[selectedSlot - 1].h} onChange={event => updateFrame(selectedSlot, { h: Number(event.target.value) })}/></label></div>}
      {slotFiles[selectedSlot] && activeAdjustment && <div className="crop-controls"><h2>照片裁剪</h2><p>在图片上拖动调整位置，也可使用下方滑杆。</p><div className="crop-preview" style={{ aspectRatio: `${layout.slots[selectedSlot].rect.w} / ${layout.slots[selectedSlot].rect.h}` }} onPointerDown={event => { cropDrag.current = { x: event.clientX, y: event.clientY, offsetX: activeAdjustment.offsetX, offsetY: activeAdjustment.offsetY, index: selectedSlot }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const drag = cropDrag.current; if (!drag) return; const box = event.currentTarget.getBoundingClientRect(); updateAdjustment(drag.index, { offsetX: Math.max(-.5, Math.min(.5, drag.offsetX + (event.clientX - drag.x) / box.width)), offsetY: Math.max(-.5, Math.min(.5, drag.offsetY + (event.clientY - drag.y) / box.height)) }); }} onPointerUp={() => { cropDrag.current = null; }} onPointerCancel={() => { cropDrag.current = null; }}>{fileUrls[selectedSlot] && <img src={fileUrls[selectedSlot]!} alt="裁剪预览" draggable={false} style={{ transform: `translate(${activeAdjustment.offsetX * 100}%, ${activeAdjustment.offsetY * 100}%) rotate(${activeAdjustment.rotation}deg) scale(${activeAdjustment.zoom})` }}/>}</div><label>照片大小 <input type="range" min="1" max="3" step="0.01" value={activeAdjustment.zoom} onChange={event => updateAdjustment(selectedSlot, { zoom: Number(event.target.value) })}/></label><label>照片旋转 <input type="range" min="-180" max="180" step="1" value={activeAdjustment.rotation} onChange={event => updateAdjustment(selectedSlot, { rotation: Number(event.target.value) })}/></label><label>水平位置 <input type="range" min="-0.5" max="0.5" step="0.01" value={activeAdjustment.offsetX} onChange={event => updateAdjustment(selectedSlot, { offsetX: Number(event.target.value) })}/></label><label>垂直位置 <input type="range" min="-0.5" max="0.5" step="0.01" value={activeAdjustment.offsetY} onChange={event => updateAdjustment(selectedSlot, { offsetY: Number(event.target.value) })}/></label><button type="button" className="reset-crop" onClick={() => setAdjustments(current => current.map((item, i) => i === selectedSlot ? defaultAdjustment() : item))}>重置照片位置</button></div>}
      {slotFiles[selectedSlot] && !(pip && selectedSlot > 0) && <button type="button" className="clear-photo" onClick={removeSelected}>移除照片</button>}
    </section>}
    <div className="actions"><button type="button" className="share-button" disabled={!complete} onClick={share}>分享图片</button><button type="button" className="save-button" disabled={!complete} onClick={download}>保存 JPG</button></div>
    <p className="hint">填满所有位置后即可导出。分享会打开系统面板，能否选微信取决于设备和浏览器。</p>
    {message && <p className="status" role="status">{message}</p>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
