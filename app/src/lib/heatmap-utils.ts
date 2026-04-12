import { Period } from './heatmap-types';
import { parse as csvParse } from 'csv-parse/sync';

// ── Date helpers ───────────────────────────────────────

export function toDate(s: string): Date | null {
  if (!s) return null;
  const p = s.trim().split('-');
  if (p.length !== 3) return null;
  let y = parseInt(p[0]), m = parseInt(p[1]), d = parseInt(p[2]);
  // Auto-detect: if first part > 31 → DD-MM-YYYY format
  if (p[0].length === 4) {
    // YYYY-MM-DD already
  } else {
    const tmp = d;
    d = parseInt(p[0]); // DD
    m = parseInt(p[1]);
    y = parseInt(p[2]);
    if (y < 100) y += 2000;
  }
  if (y < 1000 || y > 3000) return null;
  return new Date(y, m - 1, d);
}

export function toSortable(d: string): string {
  if (!d) return d;
  const p = d.trim().split('-');
  if (p.length !== 3) return d;
  const first = parseInt(p[0]);
  if (first >= 1 && first <= 31) {
    return `${p[2]}-${p[1]}-${p[0].padStart(2, '0')}`;
  }
  return d;
}

export function fromSortable(s: string): string {
  if (!s) return s;
  const p = s.split('-');
  if (p.length !== 3) return s;
  return `${p[2]}-${p[1]}-${p[0]}`;
}

export function dateAddDays(s: string, n: number): string {
  const d = toDate(s);
  if (!d) return '';
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, '0')}-${String(copy.getDate()).padStart(2, '0')}`;
}

export function getPeriodRange(d: string, period: Period): string {
  const dt = toDate(d);
  if (!dt) return d;
  const y = dt.getFullYear();
  if (period === 'Day') return d;
  if (period === 'Week') {
    const start = new Date(dt);
    start.setDate(dt.getDate() - dt.getDay());
    const end = new Date(dt);
    end.setDate(dt.getDate() + (6 - dt.getDay()));
    return `${fmtDate(start)} – ${fmtDate(end)}`;
  }
  if (period === 'Month') return `${y}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  if (period === 'Quarter') {
    const q = Math.floor(dt.getMonth() / 3) + 1;
    return `Q${q} ${y}`;
  }
  return d;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtPeriodHeader(key: string, period: Period): string {
  if (period === 'Day') return key;
  if (period === 'Month') {
    const [y, m] = key.split('-');
    return `${MONTHS[parseInt(m) - 1]} ${y}`;
  }
  if (period === 'Quarter') return key;
  if (period === 'Week') {
    const parts = key.split(' – ');
    if (parts.length === 2) {
      const d1 = toDate(parts[0]), d2 = toDate(parts[1]);
      if (!d1 || !d2) return key;
      return `${d1.getDate()} ${MONTHS[d1.getMonth()]} – ${d2.getDate()} ${MONTHS[d2.getMonth()]}`;
    }
    return key;
  }
  return key;
}

export function fmtPeriodSub(key: string, period: Period): string {
  if (period === 'Week' && key.includes(' – ')) {
    const parts = key.split(' – ');
    const d = toDate(parts[0]);
    if (!d) return '';
    return `week ${getWeekNumber(d)}`;
  }
  return '';
}

function getWeekNumber(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d.getTime() - start.getTime();
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

// ── CSV parser ───────────────────────────────────────

export function parseSalesCSV(text: string): {
  allRows: { date: string; entityCode: string; netSales: number; orderQty: number; entityName: string; category: string; mainChannel: string }[];
  entityCodes: string[];
  entityNames: Record<string, string>;
  categories: string[];
  channels: string[];
  minDate: string;
  maxDate: string;
} {
  const records = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  // Detect format: SKU CSV has 'OrderQty' column, outlet CSV does not
  const first = records[0];
  const isSku = first && 'OrderQty' in first;

  const rows: { date: string; entityCode: string; netSales: number; orderQty: number; entityName: string; category: string; mainChannel: string }[] = [];

  for (const row of records) {
    if (!row.Date || !row.SKUCode && !row.LocCode || !row.NetSales) continue;
    const ns = parseFloat(row.NetSales);
    if (isNaN(ns)) continue;

    let entityCode: string;
    let entityName: string;
    let category: string;
    let orderQty = 0;
    let mainChannel = '';

    if (isSku) {
      entityCode = row.SKUCode;
      entityName = row.SKUName ?? '';
      category = row.Category ?? '';
      mainChannel = row.MainChannel ?? '';
      if (row.OrderQty) {
        const oq = parseFloat(row.OrderQty);
        if (!isNaN(oq)) orderQty = oq;
      }
    } else {
      entityCode = row.LocCode;
      entityName = row.LocName ?? '';
      category = row.Category ?? '';
    }

    rows.push({ date: row.Date, entityCode, netSales: ns, orderQty, entityName, category, mainChannel });
  }

  const entityCodes = [...new Set(rows.map(r => r.entityCode))].sort();
  const entityNameMap: Record<string, string> = {};
  for (const r of rows) entityNameMap[r.entityCode] = r.entityName;
  const categories = [...new Set(rows.map(r => r.category))].sort();
  const channels = [...new Set(rows.map(r => r.mainChannel).filter(Boolean))].sort();
  const ds = [...new Set(rows.map(r => toSortable(r.date)))].sort();
  return { allRows: rows, entityCodes, entityNames: entityNameMap, categories, channels, minDate: ds[0] ?? '', maxDate: ds[ds.length - 1] ?? '' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
