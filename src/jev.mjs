// Minimal client for the Typesafe System One API (model: Jev).
// Jev answers typed questions over a state object; it never generates text.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const API_URL = process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
export const MODEL = process.env.JEV_MODEL || "jev-latest";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KEY_NAMES = ["TYPESAFE_API_KEY"];
let cachedKey;
export function apiKey() {
  if (cachedKey) return cachedKey;
  for (const k of KEY_NAMES) if (process.env[k]) return (cachedKey = process.env[k]);
  for (const p of [resolve(process.cwd(), ".env"), resolve(ROOT, ".env")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\s]+)"?/);
      if (m && KEY_NAMES.includes(m[1])) return (cachedKey = m[2]);
    }
  }
  throw new Error("No TypeSafe API key: set TYPESAFE_API_KEY in the environment or in .env");
}

// questions: { name: { type: "noul" | "choice" | "score", instructions, criteria? } }
export async function jev(state, questions, { retries = 5, timeout = 60_000 } = {}) {
  const key = apiKey();
  for (let attempt = 0; ; attempt++) {
    const t = performance.now();
    let res, body;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: MODEL, questions }),
        signal: AbortSignal.timeout(timeout),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      if (attempt < retries) { await sleep(800 * (attempt + 1)); continue; }
      throw e;
    }
    const ms = Math.round(performance.now() - t);
    const answers = body.answers ?? body.data?.answers;
    if (res.ok && answers) return { answers, ms, tokens: body.usage?.input_tokens ?? 0 };
    if (attempt < retries && (res.status === 429 || res.status >= 500)) { await sleep(Math.min(8000, 1000 * 2 ** attempt) + Math.random() * 500); continue; }
    throw new Error(`Jev ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
