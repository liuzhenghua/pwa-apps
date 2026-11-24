import { useEffect, useState } from 'react';
import { cents, type Stock } from './domain.ts';

export type Quote = { name: string; price: number; time: string; previousClose?: number };
type Symbol = Pick<Stock, 'code' | 'market'>;

export function symbolFor(stock: Symbol): string {
  return (stock.market === '沪市' ? 'sh' : 'sz') + stock.code;
}

export function parseQuotes(text: string, symbols: string[]): Map<string, Quote> {
  const requested = new Set(symbols);
  const quotes = new Map<string, Quote>();
  for (const match of text.matchAll(/(?:^|\n)v_((?:sh|sz)\d{6})="([^"\r\n]*)";/g)) {
    const [, symbol, payload] = match;
    if (!requested.has(symbol)) continue;
    const fields = payload.split('~');
    const name = fields[1]?.trim();
    const timestamp = fields[30]?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if (!name || fields[2] !== symbol.slice(2) || !timestamp) continue;
    const [, year, month, day, hour, minute, second] = timestamp;
    const time = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
    if (!Number.isFinite(time.getTime())) continue;
    try {
      const quote: Quote = { name, price: cents(fields[3]), time: time.toISOString() };
      try {
        quote.previousClose = cents(fields[4] ?? '');
      } catch {
        // Keep a valid latest price even when the previous close is missing.
      }
      quotes.set(symbol, quote);
    } catch {
      // A suspended or unavailable symbol may return a zero or blank price.
    }
  }
  return quotes;
}

export async function fetchQuotes(symbols: string[], signal: AbortSignal): Promise<Map<string, Quote>> {
  if (!symbols.every(symbol => /^(sh|sz)\d{6}$/.test(symbol))) throw Error('报价代码无效');
  const quotes = new Map<string, Quote>();
  for (let start = 0; start < symbols.length; start += 50) {
    const batch = symbols.slice(start, start + 50);
    const response = await fetch('https://qt.gtimg.cn/q=' + batch.join(','), { signal, cache: 'no-store' });
    if (!response.ok) throw Error('暂时无法获取行情');
    const data = new TextDecoder('gb18030').decode(await response.arrayBuffer());
    for (const [symbol, quote] of parseQuotes(data, batch)) quotes.set(symbol, quote);
  }
  return quotes;
}

export function useQuotes(stocks: Stock[], enabled: boolean) {
  const key = stocks.map(symbolFor).sort().join(',');
  const [quotes, setQuotes] = useState(new Map<string, Quote>());
  const [missing, setMissing] = useState(new Set<string>());
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!enabled || !key) {
      setLoading(false);
      return;
    }
    const symbols = key.split(',');
    const lifetime = new AbortController();
    let inFlight = false;
    async function load() {
      if (document.hidden || inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const fresh = await fetchQuotes(symbols, AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]));
        if (lifetime.signal.aborted) return;
        setQuotes(previous => {
          const next = new Map(previous);
          for (const [symbol, quote] of fresh) {
            if (!next.has(symbol) || quote.time >= next.get(symbol)!.time) next.set(symbol, quote);
          }
          return next;
        });
        setMissing(new Set(symbols.filter(symbol => !fresh.has(symbol))));
      } catch {
        if (!lifetime.signal.aborted) setMissing(new Set(symbols));
      } finally {
        inFlight = false;
        if (!lifetime.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(load, 30_000);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('online', load);
    return () => {
      lifetime.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('online', load);
    };
  }, [enabled, key, refresh]);

  return { quotes, missing, loading, refresh: () => setRefresh(value => value + 1) };
}
