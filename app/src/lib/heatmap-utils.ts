import { Period } from './heatmap-types';

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
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let inQuotes = false;
  let field = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  result.push(field.trim());
  return result;
}

export function parseSalesCSV(text: string): {
  allRows: { date: string; entityCode: string; netSales: number; orderQty: number; entityName: string; category: string; mainChannel: string }[];
  entityCodes: string[];
  entityNames: Record<string, string>;
  categories: string[];
  channels: string[];
  minDate: string;
  maxDate: string;
} {
  const lines = text.trim().split('\n');
  const header = parseCSVLine(lines[0]);
  // Detect format: SKU CSV has 'OrderQty' in header, outlet CSV does not
  const isSku = header.includes('OrderQty');
  const rows: { date: string; entityCode: string; netSales: number; orderQty: number; entityName: string; category: string; mainChannel: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    if (c.length < 3) continue;
    if (!c[0] || !c[1] || !c[2]) continue;
    if (c[0] === 'Date') continue;
    const ns = parseFloat(c[2]);
    if (isNaN(ns)) continue;
    let orderQty = 0;
    let entityName = '';
    let category = '';
    let mainChannel = '';
    let entityCode = c[1];
    if (isSku) {
      // SKU CSV: Date, SKUCode, NetSales, OrderQty, SKUName, Category, MainChannel
      orderQty = c.length > 3 && c[3] ? parseFloat(c[3]) : 0;
      entityName = c.length > 4 ? (c[4] ?? '') : '';
      category = c.length > 5 ? (c[5] ?? '') : '';
      mainChannel = c.length > 6 ? (c[6] ?? '') : '';
    } else {
      // Outlet CSV: Date, LocCode, NetSales, LocName, Category
      entityName = c.length > 3 ? (c[3] ?? '') : '';
      category = c.length > 4 ? (c[4] ?? '') : '';
    }
    rows.push({ date: c[0], entityCode, netSales: ns, orderQty, entityName, category, mainChannel });
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
