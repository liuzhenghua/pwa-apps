export const templates = [
  { id: 'normal-2', name: '常规拼图 · 2 张', orientation: '竖版' },
  { id: 'normal-4', name: '常规拼图 · 4 张', orientation: '竖版' },
  { id: 'pip-horizontal', name: '横版画中画', orientation: '横版' },
  { id: 'pip-vertical', name: '竖版画中画', orientation: '竖版' },
  { id: 'polaroid-1', name: '拍立得 · 1 张', orientation: '竖版' },
  { id: 'polaroid-2', name: '拍立得 · 2 张', orientation: '横版' },
  { id: 'id-photo', name: '证件照', orientation: '横版' },
] as const;

export type TemplateId = typeof templates[number]['id'];
export type Rect = { x: number; y: number; w: number; h: number };
export type Frame = Rect & { rotation: number };
export type Margins = { horizontal: number; vertical: number; captionSpace?: number };
export function defaultMargins(template: TemplateId): Margins {
  if (template === 'normal-2') return { horizontal: 52, vertical: 52 };
  if (template === 'normal-4') return { horizontal: 44, vertical: 44 };
  if (template === 'polaroid-1') return { horizontal: 72, vertical: 48, captionSpace: 300 };
  if (template === 'polaroid-2') return { horizontal: 72, vertical: 48, captionSpace: 200 };
  return { horizontal: 0, vertical: 0 };
}
export type PhotoAdjustment = { zoom: number; offsetX: number; offsetY: number; rotation: number };
export const defaultAdjustment = (): PhotoAdjustment => ({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });
export const captionFonts = [
  { label: '马善政', value: 'Ma Shan Zheng', fallback: 'cursive' },
  { label: '站酷快乐体', value: 'ZCOOL KuaiLe', fallback: 'cursive' },
  { label: '站酷小薇体', value: 'ZCOOL XiaoWei', fallback: 'serif' },
  { label: '站酷庆科黄油体', value: 'ZCOOL QingKe HuangYou', fallback: 'cursive' },
  { label: '龙藏体', value: 'Long Cang', fallback: 'cursive' },
  { label: 'Caveat', value: 'Caveat', fallback: 'cursive' },
  { label: 'Pacifico', value: 'Pacifico', fallback: 'cursive' },
  { label: 'Handwritten', value: 'Comic Sans MS', fallback: 'cursive' },
] as const;
export type Caption = { line1: string; line2: string; line2Enabled: boolean; font1: string; font2: string };
export const defaultCaption = (index: number): Caption => ({ line1: index === 0 ? '今日份快乐' : '记录这一刻', line2: '', line2Enabled: false, font1: 'Ma Shan Zheng', font2: 'ZCOOL KuaiLe' });
export type Slot = { label: string; rect: Rect; rotation?: number };
export type Layout = { width: number; height: number; slots: Slot[] };

export function initialFrames(template: TemplateId): Frame[] {
  if (template === 'pip-horizontal') return [
    { x: 30, y: 860, w: 320, h: 240, rotation: -3 },
    { x: 380, y: 900, w: 320, h: 240, rotation: 2 },
    { x: 730, y: 880, w: 320, h: 240, rotation: -1 },
    { x: 1080, y: 910, w: 320, h: 240, rotation: 3 },
    { x: 1430, y: 870, w: 320, h: 240, rotation: -2 },
  ];
  if (template === 'pip-vertical') return [
    { x: 60, y: 1130, w: 350, h: 240, rotation: -2 },
    { x: 420, y: 1120, w: 350, h: 240, rotation: 1 },
    { x: 780, y: 1130, w: 350, h: 240, rotation: -1.5 },
    { x: 70, y: 1450, w: 350, h: 240, rotation: 2 },
    { x: 430, y: 1440, w: 350, h: 240, rotation: -1.5 },
    { x: 790, y: 1450, w: 350, h: 240, rotation: 1.5 },
  ];
  return [];
}

export function getLayout(template: TemplateId, frames = initialFrames(template), margins = defaultMargins(template)): Layout {
  const horizontal = template === 'pip-horizontal' || template === 'polaroid-2' || template === 'id-photo';
  const width = horizontal ? 1800 : 1200;
  const height = horizontal ? 1200 : 1800;
  const h = margins.horizontal;
  const v = margins.vertical;
  if (template === 'normal-2') return { width, height, slots: [
    { label: '上方照片', rect: { x: h, y: v, w: width - 2 * h, h: (height - 3 * v) / 2 } },
    { label: '下方照片', rect: { x: h, y: (height + v) / 2, w: width - 2 * h, h: (height - 3 * v) / 2 } },
  ] };
  if (template === 'normal-4') return { width, height, slots: [
    { label: '左上照片', rect: { x: h, y: v, w: (width - 3 * h) / 2, h: (height - 3 * v) / 2 } },
    { label: '右上照片', rect: { x: (width + h) / 2, y: v, w: (width - 3 * h) / 2, h: (height - 3 * v) / 2 } },
    { label: '左下照片', rect: { x: h, y: (height + v) / 2, w: (width - 3 * h) / 2, h: (height - 3 * v) / 2 } },
    { label: '右下照片', rect: { x: (width + h) / 2, y: (height + v) / 2, w: (width - 3 * h) / 2, h: (height - 3 * v) / 2 } },
  ] };
  if (template === 'pip-horizontal' || template === 'pip-vertical') {
    return { width, height, slots: [
      { label: '背景照片', rect: { x: 0, y: 0, w: width, h: height } },
      ...frames.map((frame, i) => ({ label: `相框 ${i + 1}`, rect: frame, rotation: frame.rotation })),
    ] };
  }
  if (template === 'polaroid-1') return { width, height, slots: [
    { label: '拍立得照片', rect: { x: h, y: v, w: width - 2 * h, h: height - 2 * v - (margins.captionSpace ?? 300) } },
  ] };
  if (template === 'polaroid-2') {
    const photoWidth = (width - 3 * h) / 2;
    return { width, height, slots: [
      { label: '左侧照片', rect: { x: h, y: v, w: photoWidth, h: height - 2 * v - (margins.captionSpace ?? 200) } },
      { label: '右侧照片', rect: { x: 2 * h + photoWidth, y: v, w: photoWidth, h: height - 2 * v - (margins.captionSpace ?? 200) } },
    ] };
  }
  return { width, height, slots: [{ label: '证件照原图', rect: { x: 65, y: 95, w: 1670, h: 1000 } }] };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取照片')); };
    image.src = url;
  });
}

function adjustedTransform(image: HTMLImageElement, rect: Rect, adjustment: PhotoAdjustment) {
  const angle = adjustment.rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const absCos = Math.abs(cos);
  const absSin = Math.abs(sin);
  const cover = Math.max(rect.w / image.naturalWidth, rect.h / image.naturalHeight);
  const rotatedCover = Math.max(
    (absCos * rect.w + absSin * rect.h) / image.naturalWidth,
    (absSin * rect.w + absCos * rect.h) / image.naturalHeight,
  );
  const scale = Math.max(cover * adjustment.zoom, rotatedCover);
  const requestedX = adjustment.offsetX * rect.w;
  const requestedY = adjustment.offsetY * rect.h;
  const maxLocalX = Math.max(0, (image.naturalWidth * scale - absCos * rect.w - absSin * rect.h) / 2);
  const maxLocalY = Math.max(0, (image.naturalHeight * scale - absSin * rect.w - absCos * rect.h) / 2);
  const localX = Math.max(-maxLocalX, Math.min(maxLocalX, cos * requestedX + sin * requestedY));
  const localY = Math.max(-maxLocalY, Math.min(maxLocalY, -sin * requestedX + cos * requestedY));
  const dx = cos * localX - sin * localY;
  const dy = sin * localX + cos * localY;
  return { angle, scale, dx, dy };
}

export function clampAdjustment(image: HTMLImageElement, rect: Rect, adjustment: PhotoAdjustment): PhotoAdjustment {
  const { dx, dy } = adjustedTransform(image, rect, adjustment);
  return { ...adjustment, offsetX: dx / rect.w, offsetY: dy / rect.h };
}

export function drawAdjusted(ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: Rect, adjustment = defaultAdjustment()) {
  const { angle, scale, dx, dy } = adjustedTransform(image, rect, adjustment);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(rect.x + rect.w / 2 + dx, rect.y + rect.h / 2 + dy);
  ctx.rotate(angle);
  ctx.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  ctx.restore();
}

function drawEmpty(ctx: CanvasRenderingContext2D, rect: Rect, label: string) {
  ctx.fillStyle = '#e9eeea';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = '#809889';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.min(42, Math.max(20, rect.w / 8))}px system-ui, sans-serif`;
  ctx.fillText('＋', rect.x + rect.w / 2, rect.y + rect.h / 2 - 20);
  ctx.font = `500 ${Math.min(28, Math.max(16, rect.w / 12))}px system-ui, sans-serif`;
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 22, rect.w - 12);
}

function drawCaption(ctx: CanvasRenderingContext2D, template: TemplateId, rect: Rect, caption: Caption) {
  const single = template === 'polaroid-1';
  const centerX = rect.x + rect.w / 2;
  const maxWidth = rect.w - (single ? 36 : 24);
  const innerBottom = (single ? 1800 : 1200) - rect.y;
  const captionSpace = innerBottom - (rect.y + rect.h);
  const captionCenter = rect.y + rect.h + captionSpace / 2;
  const firstY = captionCenter - (caption.line2Enabled ? (single ? 38 : 27) : 0);
  const drawLine = (text: string, font: string, size: number, y: number) => {
    if (!text.trim()) return;
    const option = captionFonts.find(item => item.value === font);
    const family = option ? `"${option.value}", ${option.fallback}` : 'cursive';
    ctx.font = `${size}px ${family}`;
    while (ctx.measureText(text).width > maxWidth && size > 20) { size -= 2; ctx.font = `${size}px ${family}`; }
    ctx.fillText(text, centerX, y, maxWidth);
  };
  ctx.save();
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawLine(caption.line1, caption.font1, single ? 68 : 54, firstY);
  if (caption.line2Enabled) drawLine(caption.line2, caption.font2, single ? 50 : 40, firstY + (single ? 76 : 54));
  ctx.restore();
}

export async function renderLayout(files: (File | null)[], template: TemplateId, frames = initialFrames(template), adjustments: PhotoAdjustment[] = [], quality = 2, captions: Caption[] = [], margins = defaultMargins(template)): Promise<Blob> {
  const layout = getLayout(template, frames, margins);
  if (template.startsWith('polaroid-')) {
    const usedFonts = captions.flatMap(caption => [caption.font1, caption.line2Enabled ? caption.font2 : '']).filter(Boolean);
    await Promise.allSettled(usedFonts.map(font => document.fonts.load(`24px "${font}"`)));
  }
  const images = await Promise.all(layout.slots.map((_, i) => files[i] ? loadImage(files[i]) : Promise.resolve(null)));
  const canvas = document.createElement('canvas');
  const outputScale = quality === 1 ? 1 : quality === 3 ? 2 : 1.5;
  canvas.width = Math.round(layout.width * outputScale);
  canvas.height = Math.round(layout.height * outputScale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('设备不支持图片排版');
  ctx.scale(outputScale, outputScale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (template === 'pip-horizontal' || template === 'pip-vertical') {
    const background = layout.slots[0];
    if (images[0]) drawAdjusted(ctx, images[0], background.rect, adjustments[0]);
    else drawEmpty(ctx, background.rect, template === 'pip-horizontal' ? '点击上传横版背景' : '点击上传竖版背景');
    layout.slots.slice(1).forEach((slot, frameIndex) => {
      const frame = frames[frameIndex];
      if (!frame) return;
      ctx.save();
      ctx.translate(frame.x + frame.w / 2, frame.y + frame.h / 2);
      ctx.rotate(frame.rotation * Math.PI / 180);
      ctx.shadowColor = '#27303a40';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 13;
      ctx.fillStyle = '#fff';
      ctx.fillRect(-frame.w / 2 - 7, -frame.h / 2 - 7, frame.w + 14, frame.h + 14);
      ctx.shadowColor = 'transparent';
      const inner = { x: -frame.w / 2, y: -frame.h / 2, w: frame.w, h: frame.h };
      const source = images[frameIndex + 1];
      if (source) drawAdjusted(ctx, source, inner, adjustments[frameIndex + 1]);
      else { ctx.fillStyle = '#e2e8f0'; ctx.fillRect(inner.x, inner.y, inner.w, inner.h); }
      ctx.strokeStyle = '#aeb8c3';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(frame.w / 2 - 20, frame.h / 2 - 7);
      ctx.lineTo(frame.w / 2 - 7, frame.h / 2 - 7);
      ctx.lineTo(frame.w / 2 - 7, frame.h / 2 - 20);
      ctx.stroke();
      ctx.restore();
    });
  } else if (template === 'id-photo') {
    const cells = Array.from({ length: 8 }, (_, i) => ({ x: 65 + (i % 4) * 432, y: 95 + Math.floor(i / 4) * 520, w: 368, h: 480 }));
    const source = images[0];
    cells.forEach(rect => source ? drawAdjusted(ctx, source, rect, adjustments[0]) : drawEmpty(ctx, rect, '照片'));
  } else {
    layout.slots.forEach((slot, i) => {
      images[i] ? drawAdjusted(ctx, images[i], slot.rect, adjustments[i]) : drawEmpty(ctx, slot.rect, slot.label);
      if (template.startsWith('polaroid-')) drawCaption(ctx, template, slot.rect, captions[i] ?? defaultCaption(i));
    });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法导出图片')), 'image/jpeg', 0.94);
  });
}
