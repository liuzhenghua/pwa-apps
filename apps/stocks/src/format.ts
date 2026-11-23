const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const tradeDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });
const whole = new Intl.NumberFormat('zh-CN');

export const dateLabel = (value: string | number) => dateTime.format(new Date(value));

export const tradeDateLabel = (value: string) => tradeDate.format(new Date(value));

export function money(cents: number) {
  const amount = Math.abs(cents);
  const fraction = String(amount % 100).padStart(2, '0');
  return (cents < 0 ? '−' : '') + '¥' + whole.format(Math.floor(amount / 100)) + '.' + fraction;
}
