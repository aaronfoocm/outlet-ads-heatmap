/**
 * Wipe + reload daily_outlet_sales from enriched CSV with Category column.
 * Uses native Node.js fetch (v18+).
 */
const SB_PROJECT = process.env.SB_PROJECT ?? '';
const SB_KEY     = process.env.SB_KEY ?? '';
if (!SB_KEY) {
  console.error('SB_KEY env var not set — copy .env.template to .env and fill in your credentials');
  process.exit(1);
}
const SB_BASE    = `https://${SB_PROJECT}.supabase.co/rest/v1`;
const TABLE      = "daily_outlet_sales";
const CSV_PATH   = "/Users/aaronfoo/.openclaw/media/inbound/Heatmap_Sheet_-_Sheet4_1---ace27132-ae94-4b07-8054-e66206819c78.csv";

const $ = s => (s || "").replace(/\r/g, "").trim();

async function supaReq(method, url, body) {
  const opts = {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
  };
  if (body != null) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  return { status: r.status, body: await r.text() };
}

async function getMaxId() {
  const { body } = await supaReq("GET", `${SB_BASE}/${TABLE}?select=id&order=id.desc&limit=1`);
  return JSON.parse(body)[0]?.id ?? 0;
}

async function deleteRange(start, end) {
  return supaReq("DELETE", `${SB_BASE}/${TABLE}?id=gte.${start}&id=lte.${end}&order=id&limit=500`);
}

async function insertBatch(rows) {
  return supaReq("POST", `${SB_BASE}/${TABLE}`, rows);
}

function parseCSV() {
  const fs = require("fs");
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.replace(/\r/g, "").split("\n");
  const h = lines[0].split(",");

  const idx = {
    date:     h.indexOf("Date"),
    locCode:  h.indexOf("LocCode"),
    locName:  h.indexOf("LocName"),
    netSales: h.indexOf("NetSales"),
    category: h.indexOf("Category"),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = lines[i].split(",");
    const dp = $(c[idx.date]).split("-");
    rows.push({
      date:      dp.length === 3 ? `${dp[2]}-${dp[1].padStart(2,"0")}-${dp[0].padStart(2,"0")}` : $(c[idx.date]),
      loc_code:  $(c[idx.locCode]),
      loc_name:  idx.locName >= 0 ? $(c[idx.locName]) || null : null,
      net_sales: parseFloat(c[idx.netSales]) || 0,
      category: idx.category >= 0 ? $(c[idx.category]) || null : null,
    });
  }
  return rows;
}

async function main() {
  const total = await getMaxId();
  console.log(`Existing rows to delete: ${total}`);

  console.log("\nDeleting old rows...");
  let deleted = 0;
  while (deleted < total) {
    const start = deleted + 1;
    const end = Math.min(deleted + 500, total);
    await deleteRange(start, end);
    deleted += 500;
    process.stdout.write(`  ${Math.min(deleted, total)}/${total}\n`);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`✓ Deleted ${total}`);

  console.log("\nParsing CSV...");
  const raw = parseCSV();
  console.log(`CSV rows: ${raw.length}`);

  // Dedup: first wins per (date, loc_code)
  const seen = new Set();
  const rows = raw.filter(r => {
    const k = `${r.date}|${r.loc_code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(`Unique: ${rows.length}`);

  console.log("\nInserting...");
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { status, body } = await insertBatch(batch);
    if (status >= 400) {
      console.log(`  ERROR @${i}: ${status} ${body.slice(0,300)}`);
    } else {
      inserted += batch.length;
      process.stdout.write(`  ${inserted}/${rows.length}\n`);
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`\n✓ ${inserted} rows imported`);

  // Categories
  const { body: cb } = await supaReq("GET",
    `${SB_BASE}/${TABLE}?select=category&order=category&limit=100`);
  const cats = [...new Set(JSON.parse(cb).map(r => r.category).filter(Boolean))].sort();
  console.log(`Categories: ${cats.join(", ")}`);

  // Sample
  const { body: sb } = await supaReq("GET", `${SB_BASE}/${TABLE}?limit=3`);
  console.log("\nSample:");
  JSON.parse(sb).forEach(r => console.log(" ", JSON.stringify(r)));
}

main().catch(e => { console.error(e); process.exit(1); });
