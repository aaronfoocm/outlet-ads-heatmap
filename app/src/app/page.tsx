'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { Period, CompareMode, EntityType } from '../lib/heatmap-types';
import { parseSalesCSV, toSortable, dateAddDays, getPeriodRange, fmtPeriodHeader, fmtPeriodSub, toDate } from '../lib/heatmap-utils';

// ── Brand palette ───────────────────────────────────────────────
const CREAM    = '#FCF1E4';
const SOFT_GRN = '#A3B78A';
const DEEP_GRN = '#486A34';
const BORDER   = '#E5E0D8';
const WHITE    = '#FFFFFF';

// Strip leading "Koppiku " prefix — only for Outlet view
const disp = (s: string, isOutlet = false) => isOutlet ? s.replace(/^Koppiku\s+/, '') : s;

// ── Color palette ────────────────────────────────────────────────
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

// ── Number formatters ────────────────────────────────────────────
function fmtK(n: number, isCount = false) {
  if (isCount) {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toFixed(0);
  }
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return n.toFixed(0);
  return n.toFixed(1);
}

// ── Fetcher ────────────────────────────────────────────────────
async function fetchCSV(url: string) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('CSV fetch failed');
  return r.text();
}

// ── Main component ────────────────────────────────────────────────
export default function HeatmapPage() {
  const [view, setView] = useState<EntityType>('outlet');
  const [period, setPeriod] = useState<Period>('Week');
  const [compareMode, setCompareMode] = useState<CompareMode>('self');
  const [adsType, setAdsType] = useState<'netSales' | 'orderQty' | 'pspd' | 'perOutlet'>('netSales');
  // 'per' = each entity individually, 'all' = single combined row, 'group' = by category/channel
  const [groupBy, setGroupBy] = useState<'per' | 'all' | 'group'>('per');
  // SKU sub-toggle: 'name' collapses variants (current), 'code' shows each SKU separately

  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false);
  const catDropdownRef = useRef<HTMLDivElement>(null);
  const [focusedCatOptionIdx, setFocusedCatOptionIdx] = useState(-1);
  const channelDropdownRef = useRef<HTMLDivElement>(null);
  const [focusedChannelOptionIdx, setFocusedChannelOptionIdx] = useState(-1);
  const [hovered, setHovered] = useState<{entity:string;entityName:string;category:string;periodKey:string;periodAds:number|null;colAdsValue:number;colAds:number;selfAds:number;athSelf:number;colDev:number;selfDev:number;x:number;y:number}|null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [focusedOptionIdx, setFocusedOptionIdx] = useState(-1);
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const [compareModeHint, setCompareModeHint] = useState<string | null>(null);

  const csvUrl = view === 'outlet' ? '/data/outlet_daily_sales.csv?v=6' : '/data/sku_daily_sales.csv?v=1';
  const locCountUrl = '/data/loc_daily_count.csv?v=1';
  const { data: rawCsv, isLoading } = useSWR(csvUrl, fetchCSV, { refreshInterval: 86400000, revalidateOnFocus: true, revalidateOnMount: true });
  const { data: rawLocCount } = useSWR(locCountUrl, fetchCSV, { refreshInterval: 86400000, revalidateOnFocus: true, revalidateOnMount: true });

  const { allRows, entityCodes, entityNames, categories, channels, minDate, maxDate, locCount } = useMemo(() => {
    if (!rawCsv) return { allRows: [], entityCodes: [], entityNames: {}, categories: [], channels: [], minDate: '', maxDate: '', locCount: {} as Record<string, number> };
    return parseSalesCSV(rawCsv, rawLocCount ?? undefined);
  }, [rawCsv]);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  useEffect(() => {
    if (!minDate) return;
    const today = new Date().toISOString().slice(0, 10);
    setStartDate(dateAddDays(maxDate, -89)); // default: last 90 days
    setEndDate(maxDate > today ? today : maxDate);
  }, [minDate, maxDate]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
      if (catDropdownRef.current && !catDropdownRef.current.contains(e.target as Node)) setCatDropdownOpen(false);
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(e.target as Node)) setChannelDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    function handleScroll() { setHovered(null); }
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  // ── Dropdown keyboard navigation ───────────────────────────────
  const handleEntityDropdownKeyDown = useCallback((e: React.KeyboardEvent, options: string[]) => {
    if (!dropdownOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedOptionIdx(i => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedOptionIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (focusedOptionIdx >= 0 && focusedOptionIdx < options.length) {
        toggleEntity(options[focusedOptionIdx]);
        setHovered(null);
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
      setFocusedOptionIdx(-1);
    }
  }, [dropdownOpen, focusedOptionIdx]);

  const handleCatDropdownKeyDown = useCallback((e: React.KeyboardEvent, options: string[]) => {
    if (!catDropdownOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedCatOptionIdx(i => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedCatOptionIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (focusedCatOptionIdx >= 0 && focusedCatOptionIdx < options.length) {
        const cat = options[focusedCatOptionIdx];
        setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
        setHovered(null);
      }
    } else if (e.key === 'Escape') {
      setCatDropdownOpen(false);
      setFocusedCatOptionIdx(-1);
    }
  }, [catDropdownOpen, focusedCatOptionIdx]);

  const handleChannelDropdownKeyDown = useCallback((e: React.KeyboardEvent, options: string[]) => {
    if (!channelDropdownOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedChannelOptionIdx(i => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedChannelOptionIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (focusedChannelOptionIdx >= 0 && focusedChannelOptionIdx < options.length) {
        const ch = options[focusedChannelOptionIdx];
        setSelectedChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);
        setHovered(null);
      }
    } else if (e.key === 'Escape') {
      setChannelDropdownOpen(false);
      setFocusedChannelOptionIdx(-1);
    }
  }, [channelDropdownOpen, focusedChannelOptionIdx]);

  // Reset focused index when dropdown closes
  useEffect(() => { if (!dropdownOpen) setFocusedOptionIdx(-1); }, [dropdownOpen]);
  useEffect(() => { if (!catDropdownOpen) setFocusedCatOptionIdx(-1); }, [catDropdownOpen]);
  useEffect(() => { if (!channelDropdownOpen) setFocusedChannelOptionIdx(-1); }, [channelDropdownOpen]);

  // ── Compare mode auto-switch hint ───────────────────────────
  useEffect(() => {
    if (groupBy === 'all' || groupBy === 'group') {
      if (compareMode !== 'col') {
        setCompareMode('col');
        setCompareModeHint('Compare set to vs Column');
        const timer = setTimeout(() => setCompareModeHint(null), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [groupBy, compareMode]);

  // ── Derived data ──────────────────────────────────────────────
  const toggleEntity = useCallback((code: string) => {
    setSelectedEntities(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  }, []);

  const toggleAllEntities = useCallback(() => {
    setSelectedEntities(prev => prev.length >= entityCodes.length ? [] : [...entityCodes]);
  }, [entityCodes]);

  const metricVal = (r: typeof allRows[0]) => adsType === 'pspd' || adsType === 'perOutlet' ? r.orderQty / r.storeCount : adsType === 'orderQty' ? r.orderQty : r.netSales;

  const { adsMap, cellMap, colAdsMap, gridDates, overallAds, athSelfMap, sumMap, pspdMap, pspdCellMap, perOutletMap, perOutletCellMap } = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>();
    const pcells = new Map<string, Map<string, { sum: number; count: number }>>();
    const maxAllowedDate = new Date().toISOString().slice(0, 10);
    for (const r of allRows) {
      const d = toSortable(r.date);
      if (d < startDate || d > endDate) continue;
      if (d > maxAllowedDate) continue;
      if (selectedEntities.length > 0 && !selectedEntities.includes(r.entityCode)) continue;
      if (selectedCategories.length > 0 && !selectedCategories.includes(r.category)) continue;
      if (selectedChannels.length > 0 && !selectedChannels.includes(r.mainChannel)) continue;
      const pKey = getPeriodRange(d, period);
      const val = metricVal(r);
      // Key by entityCode — stable unique identifier
      const rowKey = r.entityCode;
      const acc = totals.get(rowKey) ?? { total: 0, count: 0 };
      totals.set(rowKey, { total: acc.total + val, count: acc.count + 1 });
      if (!pcells.has(rowKey)) pcells.set(rowKey, new Map());
      const prev = pcells.get(rowKey)!.get(pKey) ?? { sum: 0, count: 0 };
      pcells.get(rowKey)!.set(pKey, { sum: prev.sum + val, count: prev.count + 1 });
    }

    const ads = new Map<string, number>();
    for (const [code, v] of totals) ads.set(code, v.count > 0 ? v.total / v.count : 0);
    // Ensure all entityCodes have a name entry (entityNames is already keyed by entityCode from parseSalesCSV)
    for (const r of allRows) { if (!entityNames[r.entityCode]) entityNames[r.entityCode] = r.entityName; }

    const colAds = new Map<string, number>();
    const periods = [...new Set([...pcells.values()].flatMap(m => [...m.keys()]))].sort();
    for (const p of periods) {
      let sum = 0, n = 0;
      for (const [, pm] of pcells) {
        const cell = pm.get(p);
        if (!cell || cell.count === 0) continue;
        sum += cell.sum / cell.count;
        n++;
      }
      colAds.set(p, n > 0 ? sum / n : 0);
    }

    const gridDs = startDate && endDate
      ? [...new Set([...pcells.values()].flatMap(m => [...m.keys()]))].sort()
      : [];

    let oaSum = 0, oaN = 0;
    for (const [, v] of totals) { oaSum += v.total; oaN += v.count; }

    const athSelf = new Map<string, number>();
    for (const [code, pm] of pcells) {
      let best = 0;
      for (const [, cell] of pm) {
        if (cell.count > 0) best = Math.max(best, cell.sum / cell.count);
      }
      athSelf.set(code, best);
    }

    const sum = new Map<string, number>();
    for (const [code, v] of totals) sum.set(code, v.total);

    // ── PSPD & Per Outlet computation ─────────────────────────────────────────
    // PSPD = total orderQty / locCount[date] (global active outlet count per date)
    // Per Outlet = total netSales / locCount[date]
    // locCount is keyed by DD-MM-YYYY; sortable dates are YYYY-MM-DD — convert for lookup
    const toLocCountKey = (d: string) => { const p = d.split('-'); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d; };
    const pspdCells = new Map<string, Map<string, { orderQtySum: number; netSalesSum: number; dateKeys: string[] }>>();
    for (const r of allRows) {
      const d = toSortable(r.date);
      if (d < startDate || d > endDate) continue;
      const maxAllowedDate = new Date().toISOString().slice(0, 10);
      if (d > maxAllowedDate) continue;
      if (selectedEntities.length > 0 && !selectedEntities.includes(r.entityCode)) continue;
      if (selectedCategories.length > 0 && !selectedCategories.includes(r.category)) continue;
      if (selectedChannels.length > 0 && !selectedChannels.includes(r.mainChannel)) continue;
      const pKey = getPeriodRange(d, period);
      const rowKey = r.entityCode;
      if (!pspdCells.has(rowKey)) pspdCells.set(rowKey, new Map());
      const prev = pspdCells.get(rowKey)!.get(pKey) ?? { orderQtySum: 0, netSalesSum: 0, dateKeys: [] };
      const lck = toLocCountKey(d);
      pspdCells.get(rowKey)!.set(pKey, {
        orderQtySum: prev.orderQtySum + r.orderQty,
        netSalesSum: prev.netSalesSum + r.netSales,
        dateKeys: prev.dateKeys.includes(lck) ? prev.dateKeys : [...prev.dateKeys, lck],
      });
    }

    // Overall PSPD per entity = avg of period PSPD values
    // Period PSPD = orderQtySum / locCount[date] (global active outlet count)
    // Per Outlet = netSalesSum / locCount[date]
    const pspdMap = new Map<string, number>();
    const perOutletMap = new Map<string, number>();
    const pspdCellMap = new Map<string, Map<string, number>>();
    const perOutletCellMap = new Map<string, Map<string, number>>();

    for (const [rowKey, pm] of pspdCells) {
      const periodPspd = new Map<string, number>();
      const periodPerOutlet = new Map<string, number>();
      let pspdSum = 0, pspdN = 0;
      let poSum = 0, poN = 0;
      for (const [pKey, cell] of pm) {
        // For Day period: locCount key is the date itself; for Week/Month: avg across dates in period
        let lc = 0;
        if (cell.dateKeys.length > 0) {
          lc = cell.dateKeys.reduce((s, dk) => s + (locCount[dk] ?? 0), 0) / cell.dateKeys.length;
        }
        if (lc > 0) {
          const pspd = cell.orderQtySum / lc;
          const pout = cell.netSalesSum / lc;
          periodPspd.set(pKey, pspd);
          periodPerOutlet.set(pKey, pout);
          pspdSum += pspd;
          pspdN++;
          poSum += pout;
          poN++;
        }
      }
      pspdCellMap.set(rowKey, periodPspd);
      perOutletCellMap.set(rowKey, periodPerOutlet);
      pspdMap.set(rowKey, pspdN > 0 ? pspdSum / pspdN : 0);
      perOutletMap.set(rowKey, poN > 0 ? poSum / poN : 0);
    }

    return { adsMap: ads, cellMap: pcells, colAdsMap: colAds, gridDates: gridDs, overallAds: oaN > 0 ? oaSum / oaN : 0, athSelfMap: athSelf, sumMap: sum, pspdMap, pspdCellMap, perOutletMap, perOutletCellMap };
  }, [allRows, startDate, endDate, period, selectedEntities, selectedCategories, selectedChannels, adsType, rawLocCount]);

  // ── Grouped data (Per Category / Per Channel) ──────────────────
  // Aggregates entity data by group dimension (category for outlets, channel for SKUs)
  const { groupAdsMap, groupCellMap, groupSumMap, groupAthMap } = useMemo(() => {
    const gTotals = new Map<string, { total: number; count: number }>();
    const gCells = new Map<string, Map<string, { sum: number; count: number }>>();
    const gAllRows = allRows.filter(r => !!r.entityCode);
    for (const r of gAllRows) {
      const d = toSortable(r.date);
      if (d < startDate || d > endDate) continue;
      if (selectedEntities.length > 0 && !selectedEntities.includes(r.entityCode)) continue;
      if (selectedCategories.length > 0 && !selectedCategories.includes(r.category)) continue;
      if (selectedChannels.length > 0 && !selectedChannels.includes(r.mainChannel)) continue;
      const grpDim = view === 'sku' ? 'mainChannel' : 'category';
      const grp = grpDim === 'mainChannel' ? r.mainChannel : r.category;
      if (!grp) continue;
      const pKey = getPeriodRange(d, period);
      const val = adsType === 'orderQty' ? r.orderQty : r.netSales;
      const acc = gTotals.get(grp) ?? { total: 0, count: 0 };
      gTotals.set(grp, { total: acc.total + val, count: acc.count + 1 });
      if (!gCells.has(grp)) gCells.set(grp, new Map());
      const prev = gCells.get(grp)!.get(pKey) ?? { sum: 0, count: 0 };
      gCells.get(grp)!.set(pKey, { sum: prev.sum + val, count: prev.count + 1 });
    }
    const gAds = new Map<string, number>();
    for (const [g, v] of gTotals) gAds.set(g, v.count > 0 ? v.total / v.count : 0);
    const gSum = new Map<string, number>();
    for (const [g, v] of gTotals) gSum.set(g, v.total);
    // Group ATH: max ATH across all entities in the group
    const gAth = new Map<string, number>();
    for (const [g] of gTotals) {
      let best = 0;
      for (const r of gAllRows) {
        const grpDim = view === 'sku' ? 'mainChannel' : 'category';
        const grp = grpDim === 'mainChannel' ? r.mainChannel : r.category;
        if (grp !== g) continue;
        const a = athSelfMap.get(r.entityCode) ?? 0;
        if (a > best) best = a;
      }
      gAth.set(g, best);
    }
    return { groupAdsMap: gAds, groupCellMap: gCells, groupSumMap: gSum, groupAthMap: gAth };
  }, [allRows, startDate, endDate, period, selectedEntities, selectedCategories, selectedChannels, adsType, athSelfMap]);

  // Unfiltered group sums for sort-ordering all group rows (so channel/category filter
  // doesn't determine which rows appear — only which entities feed into each group).
  const { allGroups, groupUnfilteredSumMap } = useMemo(() => {
    const grpDim = view === 'sku' ? 'mainChannel' : 'category';
    const maxAllowedDate = new Date().toISOString().slice(0, 10);
    const validRows = allRows.filter(r => {
      const d = toSortable(r.date);
      return d >= startDate && d <= endDate && d <= maxAllowedDate;
    });
    const groups = [...new Set(validRows.map(r => grpDim === 'mainChannel' ? r.mainChannel : r.category).filter(Boolean))].sort();
    // Compute unfiltered total per group across the full dataset (date-filtered only)
    const unfilteredTotals = new Map<string, number>();
    for (const r of validRows) {
      const grp = grpDim === 'mainChannel' ? r.mainChannel : r.category;
      if (!grp) continue;
      const val = adsType === 'orderQty' ? r.orderQty : r.netSales;
      unfilteredTotals.set(grp, (unfilteredTotals.get(grp) ?? 0) + val);
    }
    return { allGroups: groups, groupUnfilteredSumMap: unfilteredTotals };
  }, [allRows, startDate, endDate, view, adsType]);

  // Use entityCode as the unique row identifier — entityName is display-only
  const allEntityCodes = useMemo(() => [...new Set(allRows.map(r => r.entityCode))].sort(), [allRows]);

  const outletsInScope = (selectedCategories.length > 0 || selectedChannels.length > 0)
    ? [...new Set(allRows.filter(r =>
        (selectedCategories.length === 0 || selectedCategories.includes(r.category)) &&
        (selectedChannels.length === 0 || selectedChannels.includes(r.mainChannel))
      ).map(r => r.entityCode))]
    : allEntityCodes;

  // Build sortedEntities based on groupBy mode
  const sortedEntities = (() => {
    if (groupBy === 'all') return ['__ALL__'] as string[];
    if (groupBy === 'group') {
      // Use unfiltered sums so ALL groups appear as rows regardless of channel/category filter.
      // Only groups with actual data (groupUnfilteredSumMap.has(g)) are shown.
      return allGroups.filter(g => groupUnfilteredSumMap.has(g)).sort((a, b) => (groupUnfilteredSumMap.get(b) ?? 0) - (groupUnfilteredSumMap.get(a) ?? 0));
    }
    return outletsInScope.filter((code: string) =>
      cellMap.has(code) &&
      (selectedEntities.length === 0 || selectedEntities.includes(code))
    ).sort((a: string, b: string) => (sumMap.get(b) ?? 0) - (sumMap.get(a) ?? 0));
  })();

  // ── Conditional returns AFTER all hooks ────────────────────────
  if (isLoading) {
    return (
      <div style={{ backgroundColor: CREAM, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: DEEP_GRN, fontSize: 14 }}>Loading data…</p>
      </div>
    );
  }

  const entityLabel = view === 'outlet' ? 'Outlet' : 'SKU';

  return (
    <div style={{ backgroundColor: CREAM, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {/* Accessibility: focus ring styles via CSS custom property */}
      <style>{`
        :root { --focus-ring: #2D5016; }
        button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
        input[type="date"]:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-color: var(--focus-ring) !important; }
        /* Dropdown options: keyboard-focused highlight */
        .dropdown-option:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; border-radius: 4px; }
      `}</style>
      {/* ── Header ── */}
      <div style={{ backgroundColor: WHITE, borderBottom: `2px solid ${BORDER}`, padding: '12px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: DEEP_GRN }}>Koppiku Heatmap</div>
            <div style={{ fontSize: 11, color: SOFT_GRN, marginTop: 2 }}>
              {view === 'outlet' ? 'Outlet' : 'SKU'} · {groupBy === 'per' ? `${sortedEntities.length} ${entityLabel.toLowerCase()}${sortedEntities.length !== 1 ? 's' : ''}` : groupBy === 'all' ? 'All combined' : `${sortedEntities.length} ${view === 'sku' ? 'channels' : 'categories'}`} · {gridDates.length} {period.toLowerCase()}{gridDates.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button type="button"
            onClick={() => { if (!isLoading && allRows.length) { const s = ['Entity Name', ...gridDates.map(d => fmtPeriodHeader(d, period)), adsType === 'pspd' ? 'Total PSPD' : adsType === 'perOutlet' ? 'Total NS Per-Outlet' : 'Total ADS'].join(','); const rows = sortedEntities.map(code => { const isAll = code === '__ALL__'; const isGroupRow = groupBy === 'group'; const lbl = isAll ? `All ${entityLabel}s` : isGroupRow ? code : view === 'outlet' ? disp(entityNames[code] ?? code, true) : (entityNames[code] ?? code); const dm = isAll ? (() => { const m = new Map<string,{sum:number;count:number}>(); for (const[,pm] of cellMap) for (const[pk,c] of pm) { const a = m.get(pk)??{sum:0,count:0}; m.set(pk,{sum:a.sum+c.sum,count:a.count+c.count}); } return m; })() : isGroupRow ? (groupCellMap.get(code) ?? new Map()) : (cellMap.get(code) ?? new Map()); const pv = gridDates.map(d => { const c = dm.get(d); return c && c.count > 0 ? (c.sum/c.count).toFixed(2) : ''; }); const ta = isAll ? (() => { let s=0,n=0; for (const[,v] of sumMap){s+=v;} for (const[,pm] of cellMap){for(const[,c]of pm){n+=c.count;}} return n>0?s/n:0; })() : isGroupRow ? (groupAdsMap.get(code)??0) : (adsMap.get(code)??0); return [lbl,...pv,ta.toFixed(2)].join(','); }); const csv = [s,...rows].join('\n'); const b = new Blob([csv],{type:'text/csv'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href=u; a.download=`kopiku-heatmap-${view}-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); } }}
            style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1.5px solid ${BORDER}`, fontWeight: 500, outline: 'none' }}>
            Export CSV
          </button>

          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 0, marginLeft: 'auto', border: `1.5px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
            {(['outlet', 'sku'] as EntityType[]).map(v => (
              <button key={v} type="button" onClick={() => { setView(v); setSelectedEntities([]); setSelectedCategories([]); setSelectedChannels([]); setHovered(null); setGroupBy('per'); setCompareMode('self'); setAdsType('netSales'); }}
                style={{ fontSize: 11, padding: '5px 14px', cursor: 'pointer', backgroundColor: view === v ? DEEP_GRN : WHITE, color: view === v ? WHITE : DEEP_GRN, border: 'none', fontWeight: view === v ? 600 : 400, outline: 'none' }}>
                {v === 'outlet' ? 'Outlet' : 'SKU'}
              </button>
            ))}

          </div>

          {/* Individual / Grouped toggle */}
          <div style={{ display: 'flex', gap: 0, border: `1.5px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
            <button type="button" onClick={() => { setGroupBy('per'); setCompareMode('self'); setHovered(null); }}
              style={{ fontSize: 11, padding: '5px 14px', cursor: 'pointer', backgroundColor: groupBy === 'per' ? DEEP_GRN : WHITE, color: groupBy === 'per' ? WHITE : DEEP_GRN, border: 'none', fontWeight: groupBy === 'per' ? 600 : 400, outline: 'none' }}>
              Per {entityLabel}
            </button>
            <button type="button" onClick={() => { setGroupBy('all'); setHovered(null); }}
              style={{ fontSize: 11, padding: '5px 14px', cursor: 'pointer', backgroundColor: groupBy === 'all' ? DEEP_GRN : WHITE, color: groupBy === 'all' ? WHITE : DEEP_GRN, border: 'none', fontWeight: groupBy === 'all' ? 600 : 400, outline: 'none' }}>
              All {entityLabel}s
            </button>
            <button type="button" onClick={() => { setGroupBy('group'); setHovered(null); }}
              style={{ fontSize: 11, padding: '5px 14px', cursor: 'pointer', backgroundColor: groupBy === 'group' ? DEEP_GRN : WHITE, color: groupBy === 'group' ? WHITE : DEEP_GRN, border: 'none', fontWeight: groupBy === 'group' ? 600 : 400, outline: 'none' }}>
              Per {view === 'sku' ? 'Channel' : 'Category'}
            </button>
          </div>
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
          {/* Period */}
          {(['Day', 'Week', 'Month', 'Quarter'] as Period[]).map(p => (
            <button type="button" key={p} onClick={() => { setPeriod(p); setHovered(null); }}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', backgroundColor: period === p ? DEEP_GRN : WHITE, color: period === p ? WHITE : DEEP_GRN, border: `1px solid ${period === p ? DEEP_GRN : BORDER}`, fontWeight: period === p ? 600 : 400, outline: 'none' }}>
              {p}
            </button>
          ))}

          {/* Date range */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: SOFT_GRN }}>From</label>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setHovered(null); }}
              style={{ fontSize: 11, border: `1.5px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', color: DEEP_GRN }} />
            <label style={{ fontSize: 11, color: SOFT_GRN }}>To</label>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setHovered(null); }}
              style={{ fontSize: 11, border: `1.5px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', color: DEEP_GRN }} />
          </div>

          {/* Entity filter dropdown */}
          <div style={{ position: 'relative' }} ref={dropdownRef}>
            <button type="button" aria-haspopup="listbox" aria-expanded={dropdownOpen} aria-label={`Filter by ${entityLabel.toLowerCase()}: ${selectedEntities.length === 0 ? `all selected` : `${selectedEntities.length} selected`}`}
              onClick={() => setDropdownOpen(o => !o)}
              style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1.5px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 6, outline: 'none' }}>
              {selectedEntities.length === 0 ? `All ${entityLabel.toLowerCase()}s (${allEntityCodes.length})` : `${selectedEntities.length} selected`}
              <span style={{ fontSize: 9, color: SOFT_GRN }}>▼</span>
            </button>
            {dropdownOpen && (
              <div role="listbox" aria-multiselectable="true" aria-label={`${entityLabel} options`}
                style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, backgroundColor: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 8, padding: 8, minWidth: 240, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 300, overflowY: 'auto' }}
                onKeyDown={e => handleEntityDropdownKeyDown(e, allEntityCodes)}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>
                  <button type="button" onClick={() => { setSelectedEntities([...allEntityCodes]); setHovered(null); }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1px solid ${BORDER}`, outline: 'none' }}>All</button>
                  <button type="button" onClick={() => { setSelectedEntities([]); setHovered(null); }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1px solid ${BORDER}`, outline: 'none' }}>None</button>
                </div>
                {allEntityCodes.map((code: string, i: number) => {
                  const checked = selectedEntities.includes(code);
                  const label = view === 'outlet' ? disp(entityNames[code] ?? code, true) : (entityNames[code] ?? code);
                  return (
                    <div key={code} role="option" aria-selected={checked} tabIndex={focusedOptionIdx === i ? 0 : -1}
                      className="dropdown-option"
                      onClick={() => { toggleEntity(code); setHovered(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', cursor: 'pointer', borderRadius: 4, backgroundColor: focusedOptionIdx === i ? '#EDF3E8' : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={() => { toggleEntity(code); setHovered(null); }} style={{ cursor: 'pointer', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
                      <span style={{ fontSize: 11, color: DEEP_GRN }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Category filter */}
          <div style={{ position: 'relative' }} ref={catDropdownRef}>
            <button type="button" aria-haspopup="listbox" aria-expanded={catDropdownOpen} aria-label={`Filter by category: ${selectedCategories.length === 0 ? `all selected` : `${selectedCategories.length} selected`}`}
              onClick={() => setCatDropdownOpen(o => !o)}
              style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1.5px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 6, outline: 'none' }}>
              {selectedCategories.length === 0 ? `All Categories (${categories.length})` : `${selectedCategories.length} selected`}
              <span style={{ fontSize: 9, color: SOFT_GRN }}>▼</span>
            </button>
            {catDropdownOpen && (
              <div role="listbox" aria-multiselectable="true" aria-label="Category options"
                style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, backgroundColor: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 8, padding: 8, minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto' }}
                onKeyDown={e => handleCatDropdownKeyDown(e, categories)}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>
                  <button type="button" onClick={() => { setSelectedCategories([...categories]); setHovered(null); }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1px solid ${BORDER}`, outline: 'none' }}>All</button>
                  <button type="button" onClick={() => { setSelectedCategories([]); setHovered(null); }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1px solid ${BORDER}`, outline: 'none' }}>None</button>
                </div>
                {categories.map((cat: string, i: number) => {
                  const checked = selectedCategories.includes(cat);
                  return (
                    <div key={cat} role="option" aria-selected={checked} tabIndex={focusedCatOptionIdx === i ? 0 : -1}
                      className="dropdown-option"
                      onClick={() => { setSelectedCategories(prev => checked ? prev.filter(c => c !== cat) : [...prev, cat]); setHovered(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', cursor: 'pointer', borderRadius: 4, backgroundColor: focusedCatOptionIdx === i ? '#EDF3E8' : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={() => { setSelectedCategories(prev => checked ? prev.filter(c => c !== cat) : [...prev, cat]); setHovered(null); }} style={{ cursor: 'pointer', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
                      <span style={{ fontSize: 11, color: DEEP_GRN }}>{cat}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Channel filter — only shown for SKU view */}
          {view === 'sku' && channels.length > 0 && (
            <div style={{ position: 'relative' }} ref={channelDropdownRef}>
              <button type="button" aria-haspopup="listbox" aria-expanded={channelDropdownOpen} aria-label={`Filter by channel: ${selectedChannels.length === 0 ? `all selected` : `${selectedChannels.length} selected`}`}
                onClick={() => setChannelDropdownOpen(o => !o)}
                style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1.5px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 6, outline: 'none' }}>
                {selectedChannels.length === 0 ? `All Channels (${channels.length})` : `${selectedChannels.length} selected`}
                <span style={{ fontSize: 9, color: SOFT_GRN }}>▼</span>
              </button>
              {channelDropdownOpen && (
                <div role="listbox" aria-multiselectable="true" aria-label="Channel options"
                  style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, backgroundColor: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 8, padding: 8, minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto' }}
                  onKeyDown={e => handleChannelDropdownKeyDown(e, channels)}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>
                    <button type="button" onClick={() => { setSelectedChannels([...channels]); setHovered(null); }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1px solid ${BORDER}`, outline: 'none' }}>All</button>
                    <button type="button" onClick={() => { setSelectedChannels([]); setHovered(null); }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', backgroundColor: WHITE, color: DEEP_GRN, border: `1px solid ${BORDER}`, outline: 'none' }}>None</button>
                  </div>
                  {channels.map((ch: string, i: number) => {
                    const checked = selectedChannels.includes(ch);
                    return (
                      <div key={ch} role="option" aria-selected={checked} tabIndex={focusedChannelOptionIdx === i ? 0 : -1}
                        className="dropdown-option"
                        onClick={() => { setSelectedChannels(prev => checked ? prev.filter(c => c !== ch) : [...prev, ch]); setHovered(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', cursor: 'pointer', borderRadius: 4, backgroundColor: focusedChannelOptionIdx === i ? '#EDF3E8' : 'transparent' }}>
                        <input type="checkbox" checked={checked} onChange={() => { setSelectedChannels(prev => checked ? prev.filter(c => c !== ch) : [...prev, ch]); setHovered(null); }} style={{ cursor: 'pointer', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
                        <span style={{ fontSize: 11, color: DEEP_GRN }}>{ch}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compare + Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 6 }}>
          {/* Metric toggle — SKU only */}
          {view === 'sku' && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: SOFT_GRN, whiteSpace: 'nowrap' }}
                title="NetSales ADS: Sum NetSales ÷ Transactions
OrderQty ADS: Sum OrderQty ÷ Transactions
NS Per-Outlet: Sum NetSales ÷ Active Outlets (locCount)
PSPD: Sum OrderQty ÷ Active Outlets (locCount)">
                Metric: <span style={{ fontSize: 9, color: SOFT_GRN, cursor: 'help' }}>[?]</span>
              </span>
              <div style={{ display: 'flex', gap: 0, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
                <button type="button" onClick={() => { setAdsType('netSales'); setHovered(null); }}
                  style={{ fontSize: 10, padding: '3px 10px', cursor: 'pointer', backgroundColor: adsType === 'netSales' ? DEEP_GRN : WHITE, color: adsType === 'netSales' ? WHITE : DEEP_GRN, border: 'none', fontWeight: adsType === 'netSales' ? 600 : 400, outline: 'none' }}>NetSales ADS</button>
                <button type="button" onClick={() => { setAdsType('perOutlet'); setHovered(null); }}
                  style={{ fontSize: 10, padding: '3px 10px', cursor: 'pointer', backgroundColor: adsType === 'perOutlet' ? DEEP_GRN : WHITE, color: adsType === 'perOutlet' ? WHITE : DEEP_GRN, border: 'none', fontWeight: adsType === 'perOutlet' ? 600 : 400, outline: 'none' }}>NS Per-Outlet</button>
                <button type="button" onClick={() => { setAdsType('orderQty'); setHovered(null); }}
                  style={{ fontSize: 10, padding: '3px 10px', cursor: 'pointer', backgroundColor: adsType === 'orderQty' ? DEEP_GRN : WHITE, color: adsType === 'orderQty' ? WHITE : DEEP_GRN, border: 'none', fontWeight: adsType === 'orderQty' ? 600 : 400, outline: 'none' }}>OrderQty ADS</button>
                <button type="button" onClick={() => { setAdsType('pspd'); setHovered(null); }}
                  style={{ fontSize: 10, padding: '3px 10px', cursor: 'pointer', backgroundColor: adsType === 'pspd' ? DEEP_GRN : WHITE, color: adsType === 'pspd' ? WHITE : DEEP_GRN, border: 'none', fontWeight: adsType === 'pspd' ? 600 : 400, outline: 'none' }}>PSPD</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: SOFT_GRN, whiteSpace: 'nowrap' }}>Compare:</span>
            <button type="button" onClick={() => { setCompareMode('col'); setHovered(null); }}
              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', backgroundColor: compareMode === 'col' ? DEEP_GRN : WHITE, color: compareMode === 'col' ? WHITE : DEEP_GRN, border: `1.5px solid ${compareMode === 'col' ? DEEP_GRN : BORDER}`, fontWeight: compareMode === 'col' ? 600 : 400, outline: 'none' }}>vs Column</button>
            <button type="button" onClick={() => { setCompareMode('self'); setHovered(null); }}
              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', backgroundColor: compareMode === 'self' ? DEEP_GRN : WHITE, color: compareMode === 'self' ? WHITE : DEEP_GRN, border: `1.5px solid ${compareMode === 'self' ? DEEP_GRN : BORDER}`, fontWeight: compareMode === 'self' ? 600 : 400, outline: 'none' }}>vs Self</button>
            {compareModeHint && <span style={{ fontSize: 9, color: '#999', fontStyle: 'italic', whiteSpace: 'nowrap' }}>{compareModeHint}</span>}
          </div>
          <div role="img" aria-label={`Color legend: Below ${compareMode === 'col' ? 'Column ADS' : 'Own ADS'} (blue shades from light to dark), Neutral (light green), Above ${compareMode === 'col' ? 'Column ADS' : 'Own ADS'} (green shades from light to dark)`}
            style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: SOFT_GRN }}>
            <span>Below {compareMode === 'col' ? 'Column ADS' : 'Own ADS'}</span>
            {[0.2, 0.4, 0.6, 0.8, 1.0].map(t => <div key={t} style={{ width: 20, height: 15, borderRadius: 3, backgroundColor: brightCellBg(-t, 1) }} />)}
            <span style={{ marginLeft: 4 }}>Neutral</span>
            <div style={{ width: 20, height: 15, borderRadius: 3, backgroundColor: '#EDF3E8' }} />
            <span style={{ marginLeft: 4 }}>Above {compareMode === 'col' ? 'Column ADS' : 'Own ADS'}</span>
            {[0.2, 0.4, 0.6, 0.8, 1.0].map(t => <div key={t} style={{ width: 20, height: 15, borderRadius: 3, backgroundColor: brightCellBg(t, 1) }} />)}
          </div>
        </div>
      </div>

      {/* Heatmap */}
      {sortedEntities.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: SOFT_GRN, fontSize: 13 }}>No data for selected filters.</div>
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 310px)' }}>
          {/* Tooltip */}
          {hovered && (
            <div style={{ position: 'fixed', left: hovered.x + 14 + (hovered.x + 260 > window.innerWidth ? -260 : 0), top: Math.min(hovered.y + 14, window.innerHeight - 220), zIndex: 9999, backgroundColor: WHITE, border: `1.5px solid ${DEEP_GRN}`, borderRadius: 8, padding: '10px 14px', boxShadow: '0 6px 24px rgba(0,0,0,0.18)', minWidth: 220, pointerEvents: 'none' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: DEEP_GRN, marginBottom: 2 }}>{disp(hovered.entityName, view === 'outlet')}</div>
              <div style={{ fontSize: 11, color: SOFT_GRN, marginBottom: 8, lineHeight: 1.4 }}>
                {hovered.category && <span style={{ backgroundColor: '#EDF3E8', borderRadius: 4, padding: '1px 5px', marginRight: 6 }}>{hovered.category}</span>}
                {fmtPeriodHeader(hovered.periodKey, period)}
                {fmtPeriodSub(hovered.periodKey, period) && <><br /><span style={{ fontSize: 9 }}>{fmtPeriodSub(hovered.periodKey, period)}</span></>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}><span style={{ color: '#888' }}>{adsType === 'pspd' ? 'Period PSPD' : adsType === 'perOutlet' ? 'Period NS Per-Outlet' : 'Period ADS'}</span><span style={{ color: DEEP_GRN, fontWeight: 600 }}>{hovered.periodAds !== null ? fmtK(hovered.periodAds) : '–'}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}><span style={{ color: '#888' }}>Column ADS</span><span style={{ color: DEEP_GRN, fontWeight: 600 }}>{fmtK(hovered.colAds)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}><span style={{ color: '#888' }}>Own ADS</span><span style={{ color: DEEP_GRN, fontWeight: 600 }}>{fmtK(hovered.selfAds)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}><span style={{ color: '#888' }}>ATH (Self)</span><span style={{ color: '#7B3F9E', fontWeight: 600 }}>{fmtK(hovered.athSelf)}</span></div>
                <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 5, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}><span style={{ color: '#888' }}>vs Column</span><span style={{ color: hovered.colDev >= 0 ? '#2E7D32' : '#1565C0', fontWeight: 600 }}>{hovered.periodAds !== null && hovered.colAdsValue > 0 ? `${((hovered.periodAds - hovered.colAdsValue) / hovered.colAdsValue * 100).toFixed(1)}%` : '–'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}><span style={{ color: '#888' }}>vs Self</span><span style={{ color: hovered.selfDev >= 0 ? '#2E7D32' : '#1565C0', fontWeight: 600 }}>{hovered.periodAds !== null && hovered.selfAds > 0 ? `${((hovered.periodAds - hovered.selfAds) / hovered.selfAds * 100).toFixed(1)}%` : '–'}</span></div>
                </div>
              </div>
            </div>
          )}

          <table style={{ borderCollapse: 'collapse', minWidth: gridDates.length * 44 + 160 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, top: 0, zIndex: 30, backgroundColor: WHITE, padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: DEEP_GRN, borderRight: `2px solid ${BORDER}`, borderBottom: `2px solid ${BORDER}` }}>{entityLabel}</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 29, backgroundColor: WHITE, padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: DEEP_GRN, borderBottom: `2px solid ${BORDER}`, minWidth: 64, borderRight: `1px solid ${BORDER}` }}>ADS</th>
                {gridDates.map(d => (
                  <th key={d} style={{ padding: '5px 3px', textAlign: 'center', fontSize: 10, color: DEEP_GRN, borderBottom: `1px solid ${BORDER}`, minWidth: 44 }}>
                    <span style={{ fontSize: 10, fontWeight: 500 }}>{fmtPeriodHeader(d, period)}</span>
                    {fmtPeriodSub(d, period) && <><br /><span style={{ fontSize: 8, color: SOFT_GRN }}>{fmtPeriodSub(d, period)}</span></>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedEntities.map((code: string) => {
                const isAll = code === '__ALL__';
                const isGroupRow = groupBy === 'group';

                // Compute combined row data for 'all' mode
                const allPeriodMap = isAll
                  ? (() => {
                      const m = new Map<string, { sum: number; count: number }>();
                      for (const [, pm] of cellMap) {
                        for (const [pk, cell] of pm) {
                          const acc = m.get(pk) ?? { sum: 0, count: 0 };
                          m.set(pk, { sum: acc.sum + cell.sum, count: acc.count + cell.count });
                        }
                      }
                      return m;
                    })()
                  : new Map<string, { sum: number; count: number }>();
                const allADS = isAll
                  ? (() => { let s = 0, n = 0; for (const [, v] of sumMap) { s += v; } for (const [, pm] of cellMap) { for (const [, c] of pm) { n += c.count; } } return n > 0 ? s / n : 0; })()
                  : 0;

                // Use grouped data or individual data
                const ads = isAll ? allADS : isGroupRow ? (groupAdsMap.get(code) ?? 0) : (adsMap.get(code) ?? 0);
                const dateMap = isAll ? allPeriodMap : isGroupRow ? (groupCellMap.get(code) ?? new Map()) : (cellMap.get(code) ?? new Map());

                // PSPD & Per Outlet mode: combined period map for 'all' rows (computed from allRows directly)
                const toLocCountKey2 = (d: string) => { const p = d.split('-'); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d; };
                const allPeriodPSPDMap = isAll
                  ? (() => {
                      const m = new Map<string, { orderQtySum: number; netSalesSum: number; dateKeys: string[] }>();
                      const maxAllowedDate = new Date().toISOString().slice(0, 10);
                      for (const r of allRows) {
                        const d = toSortable(r.date);
                        if (d < startDate || d > endDate || d > maxAllowedDate) continue;
                        if (selectedEntities.length > 0 && !selectedEntities.includes(r.entityCode)) continue;
                        if (selectedCategories.length > 0 && !selectedCategories.includes(r.category)) continue;
                        if (selectedChannels.length > 0 && !selectedChannels.includes(r.mainChannel)) continue;
                        const pKey = getPeriodRange(d, period);
                        const lck = toLocCountKey2(d);
                        const acc = m.get(pKey) ?? { orderQtySum: 0, netSalesSum: 0, dateKeys: [] };
                        m.set(pKey, { orderQtySum: acc.orderQtySum + r.orderQty, netSalesSum: acc.netSalesSum + r.netSales, dateKeys: acc.dateKeys.includes(lck) ? acc.dateKeys : [...acc.dateKeys, lck] });
                      }
                      return m;
                    })()
                  : new Map<string, { orderQtySum: number; netSalesSum: number; dateKeys: string[] }>();

                // PSPD & Per Outlet mode: use pspdCellMap/perOutletCellMap for individual entities
                const isPSPD = adsType === 'pspd';
                const isPerOutlet = adsType === 'perOutlet';
                const entityMetricMap = isAll ? new Map<string, number>() : isGroupRow ? new Map<string, number>() : (isPerOutlet ? (perOutletCellMap.get(code) ?? new Map()) : (pspdCellMap.get(code) ?? new Map()));
                const entityOverallMetric = isAll
                  ? (() => { let s = 0, n = 0; for (const [, c] of allPeriodPSPDMap) { const avgLc = c.dateKeys.length > 0 ? c.dateKeys.reduce((su, dk) => su + (locCount[dk] ?? 0), 0) / c.dateKeys.length : 0; if (avgLc > 0) { const v = isPerOutlet ? c.netSalesSum / avgLc : c.orderQtySum / avgLc; s += v; n++; } } return n > 0 ? s / n : 0; })()
                  : isGroupRow ? 0 : (isPerOutlet ? (perOutletMap.get(code) ?? 0) : (pspdMap.get(code) ?? 0));

                const rowLabel = isAll ? `All ${entityLabel}s` : isGroupRow ? code : view === 'outlet' ? disp(entityNames[code] ?? code, true) : (entityNames[code] ?? code);
                const rowKey = isAll ? '__ALL__' : isGroupRow ? code : code;

                return (
                  <tr key={rowKey}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 5, backgroundColor: WHITE, padding: '5px 10px', fontSize: 11, fontWeight: isAll ? 600 : 500, color: DEEP_GRN, borderRight: `2px solid ${BORDER}`, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rowLabel}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, borderRight: `1px solid ${BORDER}`, color: DEEP_GRN, fontWeight: 600 }}>{fmtK(ads)}</td>
                    {gridDates.map(d => {
                      const cell = dateMap.get(d) ?? null;
                      // Period ADS: PSPD uses orderQtySum/locCount, Per Outlet uses netSalesSum/locCount
                      const periodAds = (isPSPD || isPerOutlet)
                        ? (isAll
                            ? (() => { const c = allPeriodPSPDMap.get(d); if (!c || c.dateKeys.length === 0) return null; const avgLc = c.dateKeys.reduce((s, dk) => s + (locCount[dk] ?? 0), 0) / c.dateKeys.length; return avgLc > 0 ? (isPerOutlet ? c.netSalesSum / avgLc : c.orderQtySum / avgLc) : null; })()
                            : (entityMetricMap.get(d) ?? null))
                        : (cell !== null && cell.count > 0 ? cell.sum / cell.count : null);
                      const colAds = compareMode === 'col'
                        ? ((isPSPD || isPerOutlet)
                            ? (isAll
                                ? (() => { const c = allPeriodPSPDMap.get(d); if (!c || c.dateKeys.length === 0) return 0; const avgLc = c.dateKeys.reduce((s, dk) => s + (locCount[dk] ?? 0), 0) / c.dateKeys.length; return avgLc > 0 ? (isPerOutlet ? c.netSalesSum / avgLc : c.orderQtySum / avgLc) : 0; })()
                                : (entityMetricMap.get(d) ?? 0))
                            : (colAdsMap.get(d) ?? 0))
                        : ((isPSPD || isPerOutlet) ? entityOverallMetric : ads);
                      const dev = periodAds !== null && colAds > 0 ? (periodAds - colAds) / colAds : 0;
                      const bg = brightCellBg(dev, 1);
                      const fg = brightCellFg(dev);
                      const cellLabel = periodAds !== null
                        ? ((isPSPD || isPerOutlet)
                            ? (periodAds >= 100 ? periodAds.toFixed(1) : periodAds.toFixed(2))
                            : (periodAds >= 1000 ? `${(periodAds / 1000).toFixed(1)}k` : periodAds >= 100 ? periodAds.toFixed(0) : (adsType === 'orderQty' ? periodAds.toFixed(0) : periodAds.toFixed(1))))
                        : null;
                      const selfAdsVal = (isPSPD || isPerOutlet) ? entityOverallMetric : ads;
                      return (
                        <td key={d}
                          onMouseEnter={e => {
                            if (periodAds !== null) {
                              setHovered({ entity: rowKey, entityName: rowLabel, category: isGroupRow ? code : (allRows.find(r => (r.entityName || r.entityCode) === code)?.category ?? ''), periodKey: d, periodAds, colAdsValue: colAds, colAds, selfAds: selfAdsVal, athSelf: isGroupRow ? (groupAthMap.get(code) ?? 0) : (athSelfMap.get(code) ?? 0), colDev: colAds > 0 ? (periodAds - colAds) / colAds : 0, selfDev: selfAdsVal > 0 ? (periodAds - selfAdsVal) / selfAdsVal : 0, x: (e as unknown as MouseEvent).clientX, y: (e as unknown as MouseEvent).clientY });
                            }
                          }}
                          onMouseLeave={() => setHovered(null)}
                          style={{ padding: '5px 2px', textAlign: 'center', fontSize: 10, fontWeight: 500, backgroundColor: bg, color: fg, borderRight: `1px solid ${BORDER}`, cursor: periodAds !== null ? 'pointer' : 'default', minWidth: 44 }}>
                          {cellLabel}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 10, textAlign: 'center', color: SOFT_GRN, padding: '8px 0' }}>
        ADS = total NetSales ÷ days with transactions &nbsp;·&nbsp;
        {view === 'outlet' ? 'CSV: outlet-ads-heatmap/data/outlet_daily_sales.csv' : 'CSV: outlet-ads-heatmap/data/sku_daily_sales.csv'}
      </div>
    </div>
  );
}
