#!/usr/bin/env node
// bin/list-scaffolds.js — print scaffolded records (id, page, topic, tier, date/time) as JSON
// so the AI step knows exactly what to fill and with what persona/topic.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/env.js";
import { listRecords } from "../lib/store.js";

const cfg = await loadConfig();
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const storeDir = path.resolve(repoRoot, cfg.store.dir);
const scaffolds = (await listRecords(storeDir))
  .filter((r) => r.status === "scaffolded")
  .map(({ id, page_id, page_name, topic, tier, scheduled_date, scheduled_time, format }) =>
    ({ id, page_id, page_name, topic, tier, scheduled_date, scheduled_time, format: format || "fact" }));
console.log(JSON.stringify(scaffolds, null, 2));
