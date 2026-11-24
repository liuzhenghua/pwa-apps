import { activeCycle, recentPrices, tradePrices, validateLedger, type CycleBoundary, type Ledger, type TradePrice } from './domain.ts';

export type Part = { file: string; digest: string };
export type ArchiveIndex = {
  core: Ledger;
  years: Record<string, Part>;
} & (
  | { format: 'stocks-index-v2'; open?: Part }
  | { format: 'stocks-index-v3'; open: OpenStock[] }
);
export type ArchiveState = { folder: string; commit?: string; years: Record<string, Part>; missing: string[] };
type OpenStock = { stockId: string; trades: TradePrice[] };
type ArchivedCycle = OpenStock & { boundary: CycleBoundary };
export type YearRecords = ArchivedCycle[];

const archiveYear = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Shanghai' });

export function calendarYear(value: string | number | Date = new Date()): string {
  return archiveYear.format(new Date(value));
}

export function splitLedger(ledger: Ledger) {
  const open: OpenStock[] = [];
  const years: Record<string, YearRecords> = {};
  const stocks = ledger.stocks.map(stock => {
    const history = tradePrices(stock, ledger.orders);
    const ongoing = activeCycle(stock, history);
    if (ongoing.length) open.push({ stockId: stock.id, trades: ongoing });
    let end = history.length;
    for (const boundary of stock.cycles ?? []) {
      const start = end - boundary.count;
      const year = calendarYear(boundary.endedAt);
      (years[year] ??= []).push({ stockId: stock.id, boundary, trades: history.slice(start, end) });
      end = start;
    }

    // The latest prices remain available even when their original year has not loaded.
    const { history: _history, cycles: _cycles, ...metadata } = stock;
    return { ...metadata, recent: recentPrices(stock, ledger.orders) };
  });
  return { core: { ...ledger, stocks }, open, years };
}

export function assembleLedger(core: Ledger, open: OpenStock[], years: YearRecords[]): Ledger {
  const openByStock = new Map(open.map(item => [item.stockId, item.trades]));
  const cyclesByStock = new Map<string, YearRecords>();
  for (const cycle of years.flat()) {
    if (cycle.trades.length !== cycle.boundary.count) throw Error('年度归档中的交易笔数不一致');
    const cycles = cyclesByStock.get(cycle.stockId) ?? [];
    cycles.push(cycle);
    cyclesByStock.set(cycle.stockId, cycles);
  }
  const stocks = core.stocks.map(stock => {
    const cycles = (cyclesByStock.get(stock.id) ?? []).sort((a, b) => a.boundary.endedAt.localeCompare(b.boundary.endedAt));
    return {
      ...stock,
      history: [...(openByStock.get(stock.id) ?? []), ...[...cycles].reverse().flatMap(cycle => cycle.trades)],
      cycles: cycles.map(cycle => cycle.boundary),
    };
  });
  return validateLedger({ ...core, stocks });
}

export function validateIndex(raw: unknown): ArchiveIndex {
  const index = raw as ArchiveIndex;
  const valid = (part: Part, prefix: string) => part && typeof part.file === 'string' &&
    (part.file === prefix + '.json' || part.file.startsWith(prefix + '-')) && /^[\w-]+\.json$/.test(part.file) && /^[0-9a-f]{64}$/.test(part.digest);
  if ((index?.format !== 'stocks-index-v2' && index?.format !== 'stocks-index-v3') ||
      !index.years || typeof index.years !== 'object' || Array.isArray(index.years) ||
      (index.format === 'stocks-index-v2' ? index.open && !valid(index.open, 'open') : !Array.isArray(index.open))) {
    throw Error('云端归档索引格式无效');
  }
  for (const [year, part] of Object.entries(index.years)) {
    if (!/^\d{4}$/.test(year) || !valid(part, 'year-' + year)) throw Error('云端年度归档索引无效');
  }
  validateLedger(index.core);
  return index;
}
