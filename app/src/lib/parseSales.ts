import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export interface DailySale {
  date: string;       // DD-MM-YYYY
  locCode: string;
  netSales: number;
}

export interface OutletInfo {
  locCode: string;
  totalNetSales: number;
  daysActive: number;
  ads: number;
}

function parseDate(d: string): string {
  // Input: DD-MM-YYYY → sort-friendly: YYYY-MM-DD
  const parts = d.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  return d;
}

function fmtDate(d: string): string {
  // YYYY-MM-DD → DD MMM
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(parts[2])} ${months[parseInt(parts[1])-1]}`;
}

let _cache: { rows: DailySale[]; mtime: number } | null = null;

export function readCSV(): DailySale[] {
  const filePath = path.join(process.cwd(), '..', '..', 'data', 'outlet_daily_sales.csv');
  const stats = fs.statSync(filePath);
  const mtime = stats.mtimeMs;

  if (_cache && _cache.mtime === mtime) return _cache.rows;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const records = parse(raw, { skip_empty_lines: true, relax_column_count: true }) as string[][];

  const rows: DailySale[] = [];
  for (const row of records) {
    if (!row[0] || !row[1] || !row[2]) continue;
    if (row[0] === 'Date' || row[0] === 'date') continue;
    const ns = parseFloat(row[2]);
    if (isNaN(ns)) continue;
    rows.push({ date: row[0], locCode: row[1], netSales: ns });
  }

  _cache = { rows, mtime };
  return rows;
}

export function getOutlets(rows: DailySale[]): string[] {
  return [...new Set(rows.map(r => r.locCode))].sort();
}

export function getDateRange(rows: DailySale[]): [string, string] {
  const dates = rows.map(r => parseDate(r.date)).sort();
  return [dates[0], dates[dates.length - 1]];
}

export function filterRows(
  rows: DailySale[],
  locCodes: string[],
  startDate: string,   // YYYY-MM-DD
  endDate: string      // YYYY-MM-DD
): DailySale[] {
  return rows.filter(r => {
    const d = parseDate(r.date);
    if (d < startDate || d > endDate) return false;
    if (locCodes.length > 0 && !locCodes.includes(r.locCode)) return false;
    return true;
  });
}

export function computeADS(rows: DailySale[]): Map<string, number> {
  const map = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const cur = map.get(r.locCode) ?? { total: 0, count: 0 };
    map.set(r.locCode, { total: cur.total + r.netSales, count: cur.count + 1 });
  }
  const ads = new Map<string, number>();
  for (const [loc, v] of map) ads.set(loc, v.total / v.count);
  return ads;
}

export function fmtDateLabel(d: string): string {
  // YYYY-MM-DD → "01 Aug"
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(parts[2])} ${months[parseInt(parts[1]) - 1]}`;
}

export function parseDateFull(d: string): string {
  return parseDate(d);
}
