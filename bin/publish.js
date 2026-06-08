// bin/publish.js — submit approved store records to Facebook's scheduler.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadToken, loadConfig } from "../lib/env.js";
import { MetaClient } from "../lib/metaClient.js";
import { runSubmit, selectApproved } from "../lib/submitter.js";
import { listRecords } from "../lib/store.js";
import { zonedToUnix } from "../lib/tz.js";

const cfg = await loadConfig();
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const storeDir = path.resolve(repoRoot, cfg.store.dir);

if (process.argv.includes("--dry-run")) {
  const approved = selectApproved(await listRecords(storeDir));
  const nowS = Math.floor(Date.now() / 1000);
  console.log(`[dry-run] ${approved.length} approved record(s) to submit:`);
  for (const r of approved) {
    const unix = r.scheduled_date && r.scheduled_time ? zonedToUnix(r.scheduled_date, r.scheduled_time, cfg.timezone) : 0;
    const mode = unix >= nowS + 600 ? `schedule @ ${r.scheduled_date} ${r.scheduled_time}` : "publish now";
    console.log(` - ${r.page_name}: ${mode}`);
  }
  process.exit(0);
}

const token = await loadToken(cfg.tokenEnvPath);
const meta = new MetaClient({ token, graphVersion: cfg.graphVersion });
const res = await runSubmit({ storeDir, meta, timezone: cfg.timezone });
console.log(`scheduled=${res.scheduled.length} posted=${res.posted.length} errors=${res.errors.length}`);

// Persist a per-post run summary so bin/notify.js --summary can report what actually happened.
const byId = new Map((await listRecords(storeDir)).map((r) => [r.id, r]));
const enrich = (arr) =>
  arr.map((x) => {
    const rec = byId.get(x.id) || {};
    return {
      id: x.id,
      post_id: x.post_id,
      page_name: rec.page_name,
      scheduled_date: rec.scheduled_date,
      scheduled_time: rec.scheduled_time,
      message: rec.message,
      image_path: rec.image_path,
      image_source: rec.image_source,
    };
  });
const summary = {
  ts: new Date().toISOString(),
  scheduled: enrich(res.scheduled),
  posted: enrich(res.posted),
  errors: res.errors,
};
await writeFile(path.join(repoRoot, "state", "last-run.json"), JSON.stringify(summary, null, 2), "utf8");

if (res.errors.length) process.exitCode = 1;
