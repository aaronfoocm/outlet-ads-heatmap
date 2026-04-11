'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';

// ── Brand palette ───────────────────────────────────────────────
const CREAM    = '#FCF1E4';
const SOFT_GRN = '#A3B78A';
const DEEP_GRN = '#486A34';
const BORDER   = '#E5E0D8';

// Strip leading "Koppiku " prefix for cleaner display names
const disp = (s: string) => s.replace(/^Koppiku\s+/, '');
const WHITE    = '#FFFFFF';

// ── Brighter heatmap palette ──────────────────────────────────────
// Positive: bright green (t=0) → dark forest green (t=1)
const G1 = { r:  0, g: 230, b:  0 };
const G2 = { r:  0, g: 190, b: 20 };
const G3 = { r: 15, g: 140, b: 30 };
const G4 = { r: 20, g: 100, b: 30 };
// Negative: steel blue (t=0) → dark navy (t=1)
const B1 = { r: 80, g: 130, b: 210 };
const B2 = { r: 40, g:  90, b: 230 };
const B3 = { r: 15, g:  55, b: 220 };
const B4 = { r:  5, g:  30, b: 200 };

function brightCellBg(dev: number, maxAbs: number) {
  if (maxAbs === 0) return 'rgba(237,243,232,0.5)';
  const t = Math.min(Math.abs(dev) / maxAbs, 1);
  const c = dev > 0 ? (t < 0.3 ? G1 : t < 0.6 ? G2 : t < 0.85 ? G3 : G4)
                    : (t < 0.3 ? B1 : t < 0.6 ? B2 : t < 0.85 ? B3 : B4);
  return `rgba(${c.r},${c.g},${c.b},${0.28 + t * 0.72})`;
}

function brightCellFg(dev: number) {
  return Math.abs(dev) > 0.25 ? WHITE : DEEP_GRN;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Date helpers ─────────────────────────────────────────────────
function toSortable(d: string) {
  if (!d) return d;
  const p = d.trim().split('-');
  if (p.length !== 3) return d;
  const first = parseInt(p[0]);
  if (first >= 1 && first <= 31) {
    // DD-MM-YYYY → YYYY-MM-DD
    return `${p[2].padStart(4,'0')}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  }
  return d;
}

function toDate(str: string) {
  if (!str || str.trim() === '') return null;
  const p = str.trim().split('-');
  if (p.length !== 3) return null;
  let y: number, m: number, d: number;
  const first = parseInt(p[0]);
  if (first >= 1 && first <= 31) {
    y = parseInt(p[2]); m = parseInt(p[1]); d = first;
  } else {
    y = parseInt(p[0]); m = parseInt(p[1]); d = parseInt(p[2]);
  }
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;
  return date;
}

function dateAddDays(dateStr: string, days: number) {
  const d = toDate(dateStr);
  if (!d) return '';
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (y < 1000 || y > 3000) return '';
  return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function fmtShort(d: string) {
  const p = d.split('-');
  return `${parseInt(p[2])} ${MONTHS[parseInt(p[1]) - 1]}`;
}

function fmtFullDate(d: string) {
  const p = d.split('-');
  return `${parseInt(p[2])} ${MONTHS[parseInt(p[1]) - 1]} ${p[0]}`;
}

function fmtK(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 0) return '–';
  return n.toFixed(0);
}

type Period = 'Day' | 'Week' | 'Month' | 'Quarter';

function getPeriodRange(d: string, period: Period) {
  const pd = toDate(d);
  if (!pd) return d;
  const y = pd.getFullYear();
  const m = pd.getMonth() + 1;
  const dom = pd.getDate();
  if (period === 'Day') return d;
  if (period === 'Week') {
    const dow = pd.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(pd);
    mon.setDate(dom + diffToMon);
    return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
  }
  if (period === 'Month') return `${y}-${String(m).padStart(2,'0')}-01`;
  const qm = Math.ceil(m / 3) * 3 - 2;
  return `${y}-${String(qm).padStart(2,'0')}-01`;
}

function fmtPeriodHeader(d: string, period: Period) {
  const pd = toDate(d);
  if (!pd) return d;
  const y = pd.getFullYear();
  const m = pd.getMonth() + 1;
  if (period === 'Day') return `${MONTHS[m-1]} ${pd.getDate()}`;
  if (period === 'Week') return `${MONTHS[m-1]} ${pd.getDate()}`;
  if (period === 'Month') return `${MONTHS[m-1]} ${y}`;
  const q = Math.ceil(m / 3);
  return `Q${q} ${y}`;
}

function fmtPeriodSub(d: string, period: Period) {
  if (period === 'Day') return null;
  if (period === 'Week') return 'week';
  return null;
}

// ── Fetcher ─────────────────────────────────────────────────────
let _cache: { hash: string; data: { allRows: {date:string;locCode:string;netSales:number;locName:string;category:string}[]; locCodes: string[]; locNames: Record<string,string>; categories: string[]; minDate: string; maxDate: string } } | null = null;

// Simple CSV parser — handles quoted fields with embedded commas
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let inQuotes = false;
  let field = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { field += '"'; i++; }
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

async function fetchAndCache(url: string) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('CSV fetch failed');
  const text = await r.text();
  const hash = text.slice(0, 200);
  if (_cache && _cache.hash === hash) return _cache.data;
  const lines = text.trim().split('\n');
  const rows: {date:string;locCode:string;netSales:number;locName:string;category:string}[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    if (c.length < 3) continue;
    if (!c[0] || !c[1] || !c[2]) continue;
    if (c[0] === 'Date') continue;
    const ns = parseFloat(c[2]);
    if (isNaN(ns)) continue;
    rows.push({ date: c[0], locCode: c[1], netSales: ns, locName: c[3] ?? '', category: c[4] ?? '' });
  }
  const locs = [...new Set(rows.map(r => r.locCode))].sort();
  const ds = [...new Set(rows.map(r => toSortable(r.date)))].sort();
    const locNameMap: Record<string,string> = {};
  for (const r of rows) { locNameMap[r.locCode] = r.locName; }
  const categories = [...new Set(rows.map(r => r.category))].sort();
  const data = { allRows: rows, locCodes: locs, locNames: locNameMap, categories, minDate: ds[0] ?? '', maxDate: ds[ds.length-1] ?? '' };
  _cache = { hash, data };
  return data;
}

// ── Types ───────────────────────────────────────────────────────
interface HoverInfo {
  loc: string;
  locName: string;
  category: string;
  periodKey: string;
  periodAds: number | null;
  colAdsValue: number;
  colAds: number;
  selfAds: number;
  athSelf: number;
  colDev: number;
  selfDev: number;
  x: number;
  y: number;
}

// ── Main component ──────────────────────────────────────────────
export default function HeatmapPage() {
  const { data: parsed, isLoading, error } = useSWR(
    '/data/outlet_daily_sales.csv?v=4',
    fetchAndCache,
    { refreshInterval: 30000, revalidateOnFocus: true, revalidateOnMount: true }
  );

  // ── ALL hooks declared BEFORE any conditional return ───────────
  const { allRows, locCodes, locNames, categories, minDate, maxDate } = parsed ?? { allRows: [], locCodes: [], locNames: {}, categories: [], minDate: '', maxDate: '' };
  const [selectedLocs, setSelectedLocs] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [period, setPeriod] = useState<Period>('Week');
  const [compareMode, setCompareMode] = useState<'col' | 'self'>('self');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hovered, setHovered] = useState<HoverInfo | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Set default date range once data loads
  useEffect(() => {
    if (!minDate) return;
    setStartDate(dateAddDays(maxDate, -89));
    setEndDate(maxDate);
  }, [minDate, maxDate]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Dismiss tooltip on scroll
  useEffect(() => {
    function handleScroll() { setHovered(null); }
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  // ── Derived data ──────────────────────────────────────────────
  const toggleLoc = useCallback((loc: string) => {
    setSelectedLocs(prev => prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]);
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedLocs(prev => prev.length >= locCodes.length ? [] : [...locCodes]);
  }, [locCodes]);

  const { adsMap, cellMap, colAdsMap, gridDates, overallAds, athSelfMap, sumMap } = useMemo(() => {
    const totals = new Map<string,{total:number;count:number}>();
    const pcells = new Map<string,Map<string,{sum:number;count:number}>>();
for (const r of allRows) {
      const d = toSortable(r.date);
      if (d < startDate || d > endDate) continue;
      if (selectedLocs.length > 0 && !selectedLocs.includes(r.locCode)) continue;
      if (selectedCategories.length > 0 && !selectedCategories.includes(r.category)) continue;
      const pKey = getPeriodRange(d, period);
      const acc = totals.get(r.locCode) ?? {total:0,count:0};
      totals.set(r.locCode, {total: acc.total + r.netSales, count: acc.count + 1});
      if (!pcells.has(r.locCode)) pcells.set(r.locCode, new Map());
      const prev = pcells.get(r.locCode)!.get(pKey) ?? {sum:0,count:0};
      pcells.get(r.locCode)!.set(pKey, {sum: prev.sum + r.netSales, count: prev.count + 1});
    }

    const ads = new Map<string,number>();
    for (const [loc, v] of totals) ads.set(loc, v.count > 0 ? v.total / v.count : 0);

    const colAds = new Map<string,number>();
    const periods = [...new Set([...pcells.values()].flatMap(m => [...m.keys()]))].sort();
    for (const p of periods) {
      let sum = 0, n = 0;
      for (const [loc, pm] of pcells) {
        const cell = pm.get(p);
        if (!cell || cell.count === 0) continue;
        sum += cell.sum / cell.count; // ADS for this outlet in this period
        n++;
      }
      colAds.set(p, n > 0 ? sum / n : 0);
    }

    // Only show period keys that actually have data (no empty gaps)
    const gridDs = startDate && endDate
      ? [...new Set([...pcells.values()].flatMap(m => [...m.keys()]))].sort()
      : [];

    let oaSum = 0, oaN = 0;
    for (const [, v] of totals) { oaSum += v.total; oaN += v.count; }

    const athSelf = new Map<string,number>();
    for (const [loc, pm] of pcells) {
      let best = 0;
      for (const [, cell] of pm) {
        if (cell.count > 0) best = Math.max(best, cell.sum / cell.count);
      }
      athSelf.set(loc, best);
    }

    const sum = new Map<string,number>();
    for (const [loc, v] of totals) sum.set(loc, v.total);

    return { adsMap: ads, cellMap: pcells, colAdsMap: colAds, gridDates: gridDs, overallAds: oaN > 0 ? oaSum / oaN : 0, athSelfMap: athSelf, sumMap: sum };
  }, [allRows, startDate, endDate, period, selectedLocs, selectedCategories]);

  const selfMaxAbsDevMap = useMemo(() => {
    const m = new Map<string,number>();
    for (const [loc, dateMap] of cellMap) {
      let locMax = 0;
      for (const [, cell] of dateMap) {
        if (cell.count === 0) continue;
        locMax = Math.max(locMax, cell.sum / cell.count);
      }
      m.set(loc, locMax || 1);
    }
    return m;
  }, [cellMap]);

  const maxAbsDev = useMemo(() => {
    if (compareMode === 'self') return 1;
    let m = 0;
    for (const [, periodMap] of cellMap) {
      for (const [p, cell] of periodMap) {
        if (cell.count === 0) continue;
        const periodAds = cell.sum / cell.count;
        const colA = colAdsMap.get(p) ?? 0;
        if (colA <= 0) continue;
        m = Math.max(m, Math.abs((periodAds - colA) / colA));
      }
    }
    return m || 1;
  }, [cellMap, colAdsMap, compareMode]);

  // ── Conditional returns AFTER all hooks ────────────────────────
  if (isLoading) {
    return (
      <div style={{backgroundColor: CREAM, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <p style={{color: DEEP_GRN, fontSize: 14}}>Loading data…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{backgroundColor: CREAM, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8}}>
        <p style={{color: '#C0392B', fontSize: 14}}>Failed to load data</p>
        <p style={{color: '#AAA', fontSize: 12}}>{String(error)}</p>
      </div>
    );
  }

  const outletsInScope = selectedCategories.length > 0
    ? [...new Set(allRows.filter(r => selectedCategories.includes(r.category)).map(r => r.locCode))]
    : locCodes;
  const sortedLocs = outletsInScope.filter(loc => cellMap.has(loc)).sort((a, b) => (sumMap.get(b) ?? 0) - (sumMap.get(a) ?? 0));

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{backgroundColor: CREAM, minHeight: '100vh', fontFamily: 'system-ui, sans-serif', color: DEEP_GRN}}>
      <div style={{position: 'sticky', top: 0, zIndex: 20, backgroundColor: WHITE, backdropFilter: 'blur(4px)', padding: '14px 16px', borderBottom: `2px solid ${BORDER}`}}>
        <div style={{fontSize: 18, fontWeight: 700, color: DEEP_GRN}}>Outlet ADS Heatmap</div>
        <div style={{fontSize: 11, color: SOFT_GRN, marginTop: 2}}>
          Green = above ADS · Blue = below ADS · {sortedLocs.length} outlets · {gridDates.length} {period.toLowerCase()}{gridDates.length !== 1 ? 's' : ''} · CSV auto-refreshes every 30s
        </div>
      </div>

      <div style={{padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14}}>
        {/* Controls */}
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center'}}>
          <div style={{display: 'flex', gap: 4}}>
            {(['Day','Week','Month','Quarter'] as Period[]).map(p => {
              const active = period === p;
              return (
                <button key={p} onClick={() => { setPeriod(p); setHovered(null); }}
                  style={{fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', backgroundColor: active ? DEEP_GRN : WHITE, color: active ? WHITE : DEEP_GRN, border: `1.5px solid ${active ? DEEP_GRN : BORDER}`, fontWeight: active ? 600 : 400, transition: 'all 0.15s'}}>
                  {p}
                </button>
              );
            })}
          </div>
          <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
            <label style={{fontSize: 11, color: SOFT_GRN}}>From</label>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setHovered(null); }} style={{fontSize: 11, border: `1.5px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', color: DEEP_GRN}} />
            <label style={{fontSize: 11, color: SOFT_GRN}}>To</label>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setHovered(null); }} style={{fontSize: 11, border: `1.5px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', color: DEEP_GRN}} />
          </div>
          <div style={{position: 'relative'}} ref={dropdownRef}>
            <button onClick={() => setDropdownOpen(o => !o)} style={{fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1.5px solid ${BORDER}`, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6}}>
              {selectedLocs.length === 0 ? `All outlets (${locCodes.length})` : `${selectedLocs.length} outlets selected`}
              <span style={{fontSize: 9, color: SOFT_GRN}}>▼</span>
            </button>
            {dropdownOpen && (
              <div style={{position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, backgroundColor: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 8, padding: 8, minWidth: 220, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto'}}>
                <div style={{display: 'flex', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${BORDER}`}}>
                  <button onClick={() => { setSelectedLocs([]); setHovered(null); }} style={{fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1px solid ${BORDER}`}}>All</button>
                  <button onClick={() => { setSelectedLocs([...locCodes]); setHovered(null); }} style={{fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1px solid ${BORDER}`}}>None</button>
                </div>
                {locCodes.map(loc => {
                  const checked = selectedLocs.includes(loc);
                  return (
                    <label key={loc} style={{display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer'}}>
                      <input type="checkbox" checked={checked} onChange={() => { toggleLoc(loc); setHovered(null); }} style={{cursor: 'pointer'}} />
                      <span style={{fontSize: 11, color: DEEP_GRN}}>{disp(locNames[loc] ?? loc)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Category filter — shown inline beside outlet filter */}
          <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center'}}>
            <span style={{fontSize: 10, color: SOFT_GRN, marginRight: 2}}>Cat:</span>
            {categories.map(cat => {
              const active = selectedCategories.includes(cat);
              return (
                <button key={cat} onClick={() => { setSelectedCategories(prev => active ? prev.filter(c => c !== cat) : [...prev, cat]); setHovered(null); }} style={{fontSize: 10, padding: '3px 8px', borderRadius: 12, cursor: 'pointer', backgroundColor: active ? DEEP_GRN : WHITE, color: active ? WHITE : DEEP_GRN, border: `1px solid ${active ? DEEP_GRN : BORDER}`}}>
                  {cat}
                </button>
              );
            })}
            {selectedCategories.length > 0 && (
              <button onClick={() => { setSelectedCategories([]); setHovered(null); }} style={{fontSize: 10, padding: '3px 8px', borderRadius: 12, cursor: 'pointer', backgroundColor: '#EEE', color: '#888', border: '1px solid #CCC'}}>
                Clear
              </button>
            )}
          </div>
        
          <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 6}}>
            <div style={{display: 'flex', gap: 4, alignItems: 'center'}}>
              <span style={{fontSize: 10, color: SOFT_GRN, whiteSpace: 'nowrap'}}>Compare:</span>
              <button onClick={() => { setCompareMode('col'); setHovered(null); }} style={{fontSize: 10, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', backgroundColor: compareMode === 'col' ? DEEP_GRN : WHITE, color: compareMode === 'col' ? WHITE : DEEP_GRN, border: `1.5px solid ${compareMode === 'col' ? DEEP_GRN : BORDER}`, fontWeight: compareMode === 'col' ? 600 : 400}}>vs Column</button>
              <button onClick={() => { setCompareMode('self'); setHovered(null); }} style={{fontSize: 10, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', backgroundColor: compareMode === 'self' ? DEEP_GRN : WHITE, color: compareMode === 'self' ? WHITE : DEEP_GRN, border: `1.5px solid ${compareMode === 'self' ? DEEP_GRN : BORDER}`, fontWeight: compareMode === 'self' ? 600 : 400}}>vs Self</button>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: SOFT_GRN}}>
              <span>Below {compareMode === 'col' ? 'Column ADS' : 'Own ADS'}</span>
              {[0.2,0.4,0.6,0.8,1.0].map(t => <div key={t} style={{width: 20, height: 15, borderRadius: 3, backgroundColor: brightCellBg(-t, 1)}} />)}
              <span style={{marginLeft: 4}}>Neutral</span>
              <div style={{width: 20, height: 15, borderRadius: 3, backgroundColor: '#EDF3E8'}} />
              <span style={{marginLeft: 4}}>Above {compareMode === 'col' ? 'Column ADS' : 'Own ADS'}</span>
              {[0.2,0.4,0.6,0.8,1.0].map(t => <div key={t} style={{width: 20, height: 15, borderRadius: 3, backgroundColor: brightCellBg(t, 1)}} />)}
            </div>
          </div>
        </div>

        {/* Heatmap */}
        {sortedLocs.length === 0 ? (
          <div style={{textAlign: 'center', padding: 32, color: SOFT_GRN, fontSize: 13}}>No data for selected filters.</div>
        ) : (
          <div style={{overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 310px)'}}>
            {hovered && (
              <div style={{position: 'fixed', left: hovered.x + 14, top: hovered.y + 14, zIndex: 9999, backgroundColor: WHITE, border: `1.5px solid ${DEEP_GRN}`, borderRadius: 8, padding: '10px 14px', boxShadow: '0 6px 24px rgba(0,0,0,0.18)', minWidth: 210, pointerEvents: 'none'}}>
                <div style={{fontSize: 12, fontWeight: 700, color: DEEP_GRN, marginBottom: 2}}>{hovered.locName}</div>
                <div style={{fontSize: 10, color: SOFT_GRN, marginBottom: 8, lineHeight: 1.4}}>
                  {hovered.category && <span style={{backgroundColor: '#EDF3E8', borderRadius: 4, padding: '1px 5px', marginRight: 6}}>{hovered.category}</span>}
                  {fmtPeriodHeader(hovered.periodKey, period)}
                  {fmtPeriodSub(hovered.periodKey, period) && <><br/><span style={{fontSize: 9}}>{fmtPeriodSub(hovered.periodKey, period)}</span></>}
                </div>
                <div style={{display: 'flex', flexDirection: 'column', gap: 5}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', gap: 20}}><span style={{color: '#888'}}>Period ADS</span><span style={{color: DEEP_GRN, fontWeight: 600}}>{hovered.periodAds !== null ? fmtK(hovered.periodAds) : '–'}</span></div>
                  <div style={{display: 'flex', justifyContent: 'space-between', gap: 20}}><span style={{color: '#888'}}>Column ADS</span><span style={{color: DEEP_GRN, fontWeight: 600}}>{fmtK(hovered.colAds)}</span></div>
                  <div style={{display: 'flex', justifyContent: 'space-between', gap: 20}}><span style={{color: '#888'}}>Own ADS</span><span style={{color: DEEP_GRN, fontWeight: 600}}>{fmtK(hovered.selfAds)}</span></div>
                  <div style={{display: 'flex', justifyContent: 'space-between', gap: 20}}><span style={{color: '#888'}}>ATH (Self)</span><span style={{color: '#7B3F9E', fontWeight: 600}}>{fmtK(hovered.athSelf)}</span></div>
                  <div style={{borderTop: `1px solid ${BORDER}`, paddingTop: 5, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 4}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', gap: 20}}><span style={{color: '#888'}}>vs Column</span><span style={{color: hovered.colDev >= 0 ? '#2E7D32' : '#1565C0', fontWeight: 600}}>{hovered.periodAds !== null && hovered.colAdsValue > 0 ? `${((hovered.periodAds - hovered.colAdsValue) / hovered.colAdsValue * 100).toFixed(1)}%` : '–'}</span></div>
                    <div style={{display: 'flex', justifyContent: 'space-between', gap: 20}}><span style={{color: '#888'}}>vs Self</span><span style={{color: hovered.selfDev >= 0 ? '#2E7D32' : '#1565C0', fontWeight: 600}}>{hovered.periodAds !== null && hovered.selfAds > 0 ? `${((hovered.periodAds - hovered.selfAds) / hovered.selfAds * 100).toFixed(1)}%` : '–'}</span></div>
                  </div>
                </div>
              </div>
            )}
            <table style={{borderCollapse: 'collapse', minWidth: gridDates.length * 44 + 160}}>
              <thead>
                <tr>
                  <th style={{position: 'sticky', left: 0, top: 0, zIndex: 30, backgroundColor: WHITE, padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: DEEP_GRN, borderRight: `2px solid ${BORDER}`, borderBottom: `2px solid ${BORDER}`}}>Outlet</th>
                  <th style={{position: 'sticky', top: 0, zIndex: 29, backgroundColor: WHITE, padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: DEEP_GRN, borderBottom: `2px solid ${BORDER}`, minWidth: 64, borderRight: `1px solid ${BORDER}`}}>ADS</th>
                  {gridDates.map(d => {
                    const sub = fmtPeriodSub(d, period);
                    return (
                      <th key={d} style={{padding: '5px 3px', textAlign: 'center', fontSize: 10, color: DEEP_GRN, borderBottom: `1px solid ${BORDER}`, minWidth: 44}}>
                        <span style={{fontSize: 10, fontWeight: 500}}>{fmtPeriodHeader(d, period)}</span>
                        {sub && <><br/><span style={{fontSize: 8, color: SOFT_GRN}}>{sub}</span></>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedLocs.map(loc => {
                  const ads = adsMap.get(loc) ?? 0;
                  const dateMap = cellMap.get(loc)!;
                  return (
                    <tr key={loc}>
                      <td style={{position: 'sticky', left: 0, zIndex: 5, backgroundColor: WHITE, padding: '5px 10px', fontSize: 11, fontWeight: 500, color: DEEP_GRN, borderRight: `2px solid ${BORDER}`, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{disp(locNames[loc] ?? loc)}</td>
                      <td style={{padding: '5px 10px', textAlign: 'right', fontSize: 11, borderRight: `1px solid ${BORDER}`, color: DEEP_GRN, fontWeight: 600}}>{fmtK(ads)}</td>
                      {gridDates.map(d => {
                        const cell = dateMap.get(d) ?? null;
                        const periodAds = cell !== null ? cell.sum / cell.count : null;
                        const colAds = compareMode === 'col' ? (colAdsMap.get(d) ?? 0) : ads;
                        const dev = periodAds !== null && colAds > 0 ? (periodAds - colAds) / colAds : 0;
                        const locMaxAbs = compareMode === 'self' ? 1 : maxAbsDev;
                        const bg = brightCellBg(dev, locMaxAbs);
                        const fg = brightCellFg(dev);
                        const cellLabel = periodAds !== null ? (periodAds >= 1000 ? `${(periodAds/1000).toFixed(1)}k` : periodAds >= 100 ? periodAds.toFixed(0) : periodAds.toFixed(1)) : null;
                        return (
                          <td
                            key={d}
                            onMouseEnter={e => {
                              if (periodAds !== null) {
                                setHovered({loc, locName: locNames[loc] ?? loc, category: categories.find(cat => allRows.some(r => r.locCode === loc && r.category === cat)) ?? '', periodKey: d, periodAds, colAdsValue: colAds, colAds, selfAds: ads, athSelf: athSelfMap.get(loc) ?? 0, colDev: colAds > 0 ? (periodAds - colAds) / colAds : 0, selfDev: ads > 0 ? (periodAds - ads) / ads : 0, x: (e as unknown as MouseEvent).clientX, y: (e as unknown as MouseEvent).clientY});
                              }
                            }}
                            onMouseLeave={() => setHovered(null)}
                            style={{padding: '5px 2px', textAlign: 'center', fontSize: 10, fontWeight: 500, backgroundColor: bg, color: fg, borderRight: `1px solid ${BORDER}`, cursor: periodAds !== null ? 'pointer' : 'default', minWidth: 44}}
                          >{cellLabel}</td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{fontSize: 10, textAlign: 'center', color: SOFT_GRN}}>
          ADS = total NetSales &divide; days with transactions in selected range &nbsp;&middot;&nbsp;
          CSV: <code style={{fontSize: 9, color: SOFT_GRN}}>outlet-ads-heatmap/data/outlet_daily_sales.csv</code>
        </div>
      </div>
    </div>
  );
}
