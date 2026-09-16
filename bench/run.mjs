#!/usr/bin/env node
// node bench/run.mjs [--set base|hard|guard|local|all] [--only id,id] [--concurrency 3] [--out file.json]
//
// Each task runs in a fresh browser context. Per step: `assert` (JS in page) is ground truth,
// `assertEvents` matches dialog/tab events, `expectStatus` overrides the expected status (default done).
// Tasks with `expect: "fail"` must not be reported done. Tasks with `guard: true` run with the
// irreversible-action pause on; everything else runs with it off.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JevBrowser } from "../src/session.mjs";
import { TASKS as BASE, HARD, GUARD } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LOCAL = existsSync(resolve(HERE, "tasks.local.mjs")) ? (await import("./tasks.local.mjs")).LOCAL : [];
const SETS = { base: BASE, hard: HARD, guard: GUARD, local: LOCAL };
const set = arg("--set", "all");
const pool = set === "all" ? [...BASE, ...HARD, ...GUARD, ...LOCAL] : set.split(",").flatMap(s => SETS[s] ?? []);
const only = arg("--only")?.split(",");
const tasks = pool.filter(t => !only || only.includes(t.id));
const conc = +arg("--concurrency", 3);
const out = resolve(arg("--out", resolve(HERE, "results", `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`)));

const browser = await chromium.launch();
async function runTask(t) {
  const b = await JevBrowser.launch({ browser });
  const lines = []; const log = s => lines.push(s);
  const rec = { id: t.id, cat: t.cat, expect: t.expect ?? "pass", guard: !!t.guard, steps: [] };
  const t0 = Date.now();
  let ok = true;
  try {
    await b.open(t.url);
    for (const s of t.steps) {
      log(`step: ${s.goal}`);
      let r;
      try { r = await b.do(s.goal, { values: s.values ?? {}, maxActions: s.maxActions ?? 10, allowIrreversible: !t.guard, log }); }
      catch (e) { r = { status: "exception", info: String(e.message).split("\n")[0].slice(0, 200), rounds: [], actions: [] }; }
      if (s.assert) { await b.settle(); r.truth = await b.page.evaluate(`(${s.assert})()`).catch(e => `assert error: ${e.message.split("\n")[0]}`); }
      if (s.assertEvents) r.truth = r.actions.some(h => h.event && new RegExp(s.assertEvents, "i").test(h.event));
      const want = s.expectStatus ?? "done";
      r.expected_status = want;
      const statusOk = r.status === want || (want === "done" && r.status === "likely_done");
      r.step_ok = statusOk && (r.truth === undefined || r.truth === true);
      log(`  => ${r.status}${r.info ? ` (${r.info})` : ""}${r.truth !== undefined ? ` truth=${r.truth}` : ""}`);
      rec.steps.push({ goal: s.goal, ...r });
      if (!r.step_ok) { ok = false; break; }
    }
  } catch (e) { rec.error = String(e.message).split("\n")[0]; ok = false; }
  rec.ms = Date.now() - t0; rec.calls = b.stats.calls; rec.tokens = b.stats.tokens; rec.jev_ms = b.stats.jev_ms;
  const last = rec.steps.at(-1);
  const complete = rec.steps.length === t.steps.length;
  rec.claimed = complete && rec.steps.every(s => s.status === s.expected_status);
  rec.truth = complete && (last?.truth === undefined ? last?.status === "done" : last.truth === true);
  rec.correct = rec.expect === "fail" ? !rec.steps.some(s => ["done", "likely_done"].includes(s.status)) : ok && complete;
  rec.achieved = rec.expect === "fail" ? null : rec.truth;
  rec.false_done = rec.steps.some(s => s.status === "done" && s.truth !== undefined && s.truth !== true);
  rec.likely_done = rec.steps.filter(s => s.status === "likely_done").map(s => ({ goal: s.goal, truth: s.truth }));
  rec.log = lines;
  await b.close();
  console.log(`${rec.correct ? "✓" : "✗"} ${t.id.padEnd(22)} status=${last?.status ?? "-"} truth=${last?.truth} ${rec.calls} calls ${(rec.ms / 1000).toFixed(1)}s${rec.false_done ? "  FALSE-DONE" : ""}`);
  return rec;
}

const results = []; let next = 0;
await Promise.all(Array.from({ length: conc }, async () => { while (next < tasks.length) results.push(await runTask(tasks[next++])); }));
await browser.close();
results.sort((a, b) => tasks.indexOf(tasks.find(t => t.id === a.id)) - tasks.indexOf(tasks.find(t => t.id === b.id)));

// guard false positives: rounds in unguarded tasks where the pause would have fired
const wouldPause = results.filter(r => !r.guard).flatMap(r => r.steps.flatMap(s => (s.rounds ?? []).filter(x => x.irreversible >= 0.6 && ["click", "press_enter", "press_key"].includes(x.tool)).map(x => `${r.id}: ${x.tool} ${x.el} (${x.irreversible})`)));
const calls = results.reduce((a, r) => a + r.calls, 0);
const sum = {
  tasks: results.length, correct: results.filter(r => r.correct).length, false_done: results.filter(r => r.false_done).length,
  likely_done: results.flatMap(r => r.likely_done.map(l => `${r.id}: ${l.goal} (truth=${l.truth})`)),
  calls, tokens: results.reduce((a, r) => a + r.tokens, 0), avg_jev_ms: Math.round(results.reduce((a, r) => a + r.jev_ms, 0) / Math.max(calls, 1)),
  guard_would_pause: wouldPause,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ summary: sum, results }, null, 1));
console.log(`\n${sum.correct}/${sum.tasks} correct · ${sum.false_done} false-done · ${calls} Jev calls (avg ${sum.avg_jev_ms}ms) · ${sum.tokens} tokens`);
if (sum.likely_done.length) console.log(`likely_done (caller should verify):\n  ${sum.likely_done.join("\n  ")}`);
if (wouldPause.length) console.log(`guard would have paused (unguarded tasks):\n  ${wouldPause.join("\n  ")}`);
console.log(`→ ${out}`);
