#!/usr/bin/env python3
"""Build sku_daily_sales.csv from Heatmap Sheet - Sheet1 (raw POS export).

SKU-level grouping: aggregate by (Date, SKUName, MainChannel), NOT by ItemCode.
All ItemCode variants of the same SKU name are consolidated under one SKUName.
Garbage names (#ERROR!, #N/A, modifiers like "1 Pump", etc.) are excluded.
"""
import csv

SRC = "/Users/aaronfoo/workspace/outlet-ads-heatmap/data/sku_raw.csv"
DST = "/Users/aaronfoo/workspace/outlet-ads-heatmap/app/public/data/sku_daily_sales.csv"

SKIP_PREFIXES = ('#', '1 ', '2 ', '3 ', '4 ', '5 ', '25%', '50%', '75%',
                 'Half ', 'Full ', 'Add ', 'Extra ', 'Sugar ', 'Syrup ')
SKIP_NAMES = {'#ERROR!', '#N/A', '', 'nan', 'null'}

def is_valid_sku(name):
    n = name.strip()
    if n in SKIP_NAMES:
        return False
    if n.startswith(SKIP_PREFIXES):
        return False
    return True

print("Reading Sheet1...")
with open(SRC, newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
print(f"  {len(rows):,} rows")

agg = {}
for r in rows:
    date     = r["Date"].strip()
    sku_name = r["Name"].strip()
    channel  = r.get("MainChannel","").strip() or r.get("Channel","").strip()
    dept     = r.get("DeptDesc","").strip()
    ns       = float(r["NetSales"]) if r.get("NetSales","").strip() else 0
    oqty     = float(r["OrderQty"]) if r.get("OrderQty","").strip() else 0
    if not date or not is_valid_sku(sku_name):
        continue

    # Aggregate by (date, SKU) — collapse across channels.
    # storeCount comes from loc_daily_count.csv, NOT from Sheet1 (Sheet1 StoreCount is a date-level constant, not row-level)
    key = (date, sku_name)
    if key not in agg:
        agg[key] = {"date": date, "skuName": sku_name, "mainChannel": channel,
                    "category": dept, "netSales": 0, "orderQty": 0}
    agg[key]["netSales"] += ns
    agg[key]["orderQty"] += oqty
    # Keep first non-empty channel/category as representative
    if not agg[key]["mainChannel"] and channel:
        agg[key]["mainChannel"] = channel
    if not agg[key]["category"] and dept:
        agg[key]["category"] = dept

print(f"  {len(agg):,} unique (date, SKUName) combos")

sorted_rows = sorted(agg.values(), key=lambda x: (x["date"], x["skuName"]))

print(f"Writing {DST}...")
with open(DST, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Date","SKUName","NetSales","OrderQty","MainChannel","Category"])
    for r in sorted_rows:
        w.writerow([
            r["date"], r["skuName"],
            f"{r['netSales']:.2f}", f"{r['orderQty']:.0f}",
            r["mainChannel"], r["category"]
        ])

print(f"✅ {len(sorted_rows):,} rows written")
print(f"  Date range: {sorted_rows[0]['date']} → {sorted_rows[-1]['date']}")
unique_skus = len(set(r["skuName"] for r in sorted_rows))
print(f"  Unique SKU names: {unique_skus}")

# 2026 check
y2026 = [r for r in sorted_rows if '2026' in r['date']]
print(f"  2026 rows: {len(y2026):,}")
print(f"  Latest dates: {sorted(set(r['date'] for r in y2026))[-3:]}")