const number = new Intl.NumberFormat('zh-CN');
const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const moneyParts = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const count = (value: number) => number.format(value);
export const dateLabel = (value: string | number) => dateTime.format(new Date(value));

export function priceInput(value: number) {
  const positive = Math.abs(value);
  return (value < 0 ? '-' : '') + Math.floor(positive / 100) + '.' + String(positive % 100).padStart(2, '0');
}

export function money(value: number, signed = false) {
  const [whole, fraction] = priceInput(Math.abs(value)).split('.');
  return (value < 0 ? '−' : signed && value > 0 ? '+' : '') + '¥' + moneyParts.format(Number(whole)) + '.' + fraction;
}

export const rateLabel = (value: number) => (value > 0 ? '+' : value < 0 ? '−' : '') + Math.abs(value).toFixed(2) + '%';
export const tone = (value: number) => value > 0 ? 'gain' : value < 0 ? 'loss' : '';

export function localDate(value = new Date()) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
}

export function localTime(value = new Date()) {
  return localDate(value) + 'T' + String(value.getHours()).padStart(2, '0') + ':' + String(value.getMinutes()).padStart(2, '0');
}
