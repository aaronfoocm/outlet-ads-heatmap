#!/usr/bin/env python3
"""
Wipe old daily_outlet_sales and reload from the enriched CSV with Category column.
Maps: Date → date (YYYY-MM-DD), LocCode → loc_code, LocName → loc_name,
      NetSales → net_sales, Category → category
"""
import csv, sys, time, math

import os

SB_PROJECT = os.environ.get('SB_PROJECT', '')
SB_KEY     = os.environ.get('SB_KEY', '')
if not SB_KEY:
    raise RuntimeError('SB_KEY env var not set — copy .env.template to .env and fill in your credentials')
SB_BASE    = f"https://{SB_PROJECT}.supabase.co/rest/v1"
TABLE     = "daily_outlet_sales"
HEADERS   = {
    "apikey": SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

CSV_PATH = "/Users/aaronfoo/.openclaw/media/inbound/Heatmap_Sheet_-_Sheet4_1---ace27132-ae94-4b07-8054-e66206819c78.csv"

def req(method, url, body=None):
    import urllib.request
    data = bytes(json.dumps(body), "utf-8") if body is not None else None
    req  = urllib.request.Request(url, data=data, method=method,
                                  headers={**HEADERS, "Content-Length": str(len(data) if data else 0)})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode()

def sql(sql_text):
    import urllib.request
    url  = f"{SB_BASE}/rpc/exec_sql"
    data = json.dumps({"q": sql_text}).encode()
    req  = urllib.request.Request(url, data=data, method="POST",
                                  headers={"apikey": SB_KEY,
                                           "Authorization": f"Bearer {SB_KEY}",
                                           "Content-Type": "application/json",
                                           "Content-Length": str(len(data))})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

import json, urllib.request

def delete_batch(offset=0, batch=500):
    """Delete a batch by id range."""
    url = f"{SB_BASE}/{TABLE}?id=gte.{offset+1}&id=lte.{offset+batch}&order=id&limit={batch}"
    _, text = req("DELETE", url)
    return text

# ── Step 1: Count existing rows ───────────────────────────────────────────────
status, resp = req("GET", f"{SB_BASE}/{TABLE}?id=eq.1&limit=1")
print(f"Table reachable: status={status}")

# Get total count
_, count_resp = req("GET", f"{SB_BASE}/{TABLE}?select=id&limit=0")
# Parse from content-range header
print(f"Count response: {count_resp[:200]}")

# Quick estimate: get max id
_, max_resp = req("GET", f"{SB_BASE}/{TABLE}?select=id&order=id.desc&limit=1")
max_data = json.loads(max_resp)
total = max_data[0]["id"] if max_data else 0
print(f"Total existing rows to delete: {total}")

# ── Step 2: Delete all rows in batches ─────────────────────────────────────────
print("\nDeleting old rows in batches of 500...")
deleted = 0
while deleted < total:
    batch_size = min(500, total - deleted)
    resp = delete_batch(deleted)
    deleted += batch_size
    print(f"  Deleted {deleted}/{total}", flush=True)
    time.sleep(0.3)

print(f"✓ Deleted {total} old rows")

# ── Step 3: Parse CSV and prepare rows ────────────────────────────────────────
print("\nParsing CSV...")
rows = []
with open(CSV_PATH, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for i, row in enumerate(reader):
        date_raw = row["Date"].strip()
        parts = date_raw.split("-")
        if len(parts) == 3:
            # DD-MM-YYYY → YYYY-MM-DD
            day, mon, year = parts
            date_iso = f"{year}-{mon.zfill(2)}-{day.zfill(2)}"
        else:
            date_iso = date_raw

        rows.append({
            "date":     date_iso,
            "loc_code": row["LocCode"].strip(),
            "loc_name": row.get("LocName", "").strip() or None,
            "net_sales": float(row["NetSales"]),
            "category": row.get("Category", "").strip() or None,
        })

print(f"Parsed {len(rows)} data rows")

# Deduplicate (keep first occurrence per loc_code + date)
seen, deduped = set(), []
for r in rows:
    key = (r["date"], r["loc_code"])
    if key not in seen:
        seen.add(key)
        deduped.append(r)

print(f"After dedup: {len(deduped)} unique (date, loc_code) rows")

# ── Step 4: Insert in batches ──────────────────────────────────────────────────
print("\nInserting rows in batches of 500...")
inserted = 0
errors = 0
for i in range(0, len(deduped), 500):
    batch = deduped[i:i+500]
    url  = f"{SB_BASE}/{TABLE}"
    data = json.dumps(batch).encode()
    req_obj = urllib.request.Request(url, data=data, method="POST",
        headers={"apikey": SB_KEY,
                 "Authorization": f"Bearer {SB_KEY}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates",
                 "Content-Length": str(len(data))})
    try:
        with urllib.request.urlopen(req_obj, timeout=60) as r:
            inserted += len(batch)
            print(f"  Inserted {inserted}/{len(deduped)}", flush=True)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"  ERROR at batch {i}: {e.code} {err_body[:200]}")
        errors += 1
    time.sleep(0.5)

print(f"\n✓ Import complete!")
print(f"  Total rows inserted: {inserted}")
print(f"  Batch errors: {errors}")

# ── Step 5: Verify ──────────────────────────────────────────────────────────────
_, verify = req("GET", f"{SB_BASE}/{TABLE}?select=date,loc_code,loc_name,net_sales,category&limit=3")
data = json.loads(verify)
print(f"\nSample rows:")
for r in data:
    print(f"  {r}")

# Unique categories
_, cats = req("GET", f"{SB_BASE}/{TABLE}?select=category&order=category&limit=100")
all_cats = json.loads(cats)
uniq = sorted(set(r["category"] for r in all_cats if r.get("category")))
print(f"\nUnique categories: {uniq}")
