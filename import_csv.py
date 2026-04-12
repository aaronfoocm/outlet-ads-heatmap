#!/usr/bin/env python3
"""Bulk import outlet daily sales from CSV to Supabase daily_outlet_sales table."""
import csv
import urllib.request
import urllib.error
import json
import time

import os

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SERVICE_KEY', '')
if not SERVICE_KEY:
    raise RuntimeError('SERVICE_KEY env var not set — copy .env.template to .env and fill in your credentials')
CSV_PATH = "/Users/aaronfoo/workspace/outlet-ads-heatmap/data/outlet_daily_sales.csv"
BATCH_SIZE = 500

def supabase_insert(rows):
    data = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/daily_outlet_sales",
        data=data,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        return e.code, body

# Parse CSV
reader = csv.DictReader(open(CSV_PATH))
batches = []
batch = []
for i, row in enumerate(reader):
    date_str = row["Date"].strip()          # DD-MM-YYYY
    loc_code = row["LocCode"].strip()
    net_sales = float(row["NetSales"])
    # Convert DD-MM-YYYY -> YYYY-MM-DD
    parts = date_str.split("-")
    iso_date = f"{parts[2]}-{parts[1]}-{parts[0]}"
    batch.append({
        "date": iso_date,
        "loc_code": loc_code,
        "net_sales": round(net_sales, 2),
    })
    if len(batch) >= BATCH_SIZE:
        batches.append(batch)
        batch = []
if batch:
    batches.append(batch)

total = sum(len(b) for b in batches)
print(f"Prepared {total} rows in {len(batches)} batches of up to {BATCH_SIZE}")
print("Starting import...")

for idx, batch in enumerate(batches):
    status = supabase_insert(batch)
    if isinstance(status, tuple):
        print(f"  Batch {idx+1}/{len(batches)} ERROR {status[0]}: {status[1][:100]}")
    else:
        print(f"  Batch {idx+1}/{len(batches)} ✓ ({len(batch)} rows)")
    time.sleep(0.25)

print("Done!")
