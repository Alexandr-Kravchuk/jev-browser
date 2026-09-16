// Pure helpers over the page model returned by the page script. No browser, no network.

export const FIELDISH = e => !!e && (/^(input:(text|email|password|search|tel|url|number|date|datetime-local|month|week|time|color|range)|textarea)/.test(e.tag) || /\[(textbox|searchbox|combobox)\]/.test(e.tag) || (e.tag.startsWith("div[") && e.value !== undefined));
export const SELECTISH = e => !!e && (e.tag === "select" || !!e.options);
export const FILEISH = e => !!e && e.tag === "input:file";

export function brief(e) {
  if (!e) return "?";
  const name = e.label || e.text || e.placeholder || e.name || e.near || e.href || "";
  return `${e.tag} "${String(name).slice(0, 50)}"`;
}

// What changed between two page models: elements added/removed (with state), URL, metrics, new words.
export function pageDiff(a, b) {
  if (!a) return undefined;
  const key = e => `${brief(e)}${e.near && e.near !== (e.label || e.text) ? ` near "${e.near.slice(0, 40)}"` : ""}${e.checked !== undefined ? ` checked=${e.checked}` : ""}${e.value ? ` value="${e.value}"` : ""}${e.active ? " active" : ""}${e.sorted ? ` sorted=${e.sorted}` : ""}`;
  const A = new Set(a.elements.map(key)), B = new Set(b.elements.map(key));
  const d = { added: [...B].filter(x => !A.has(x)).slice(0, 15), removed: [...A].filter(x => !B.has(x)).slice(0, 15) };
  if (!d.added.length && !d.removed.length) {
    // same elements, different order (drag-and-drop, sorting): show the part that moved
    const ka = a.elements.map(key), kb = b.elements.map(key);
    const first = ka.findIndex((k, i) => k !== kb[i]);
    if (first >= 0 && ka.length === kb.length) {
      let last = ka.length - 1; while (last > first && ka[last] === kb[last]) last--;
      d.reordered = { before: ka.slice(first, Math.min(last + 1, first + 10)), after: kb.slice(first, Math.min(last + 1, first + 10)) };
    }
  }
  if (a.url !== b.url) d.url = `${a.url} -> ${b.url}`;
  for (const k of Object.keys(b.metrics ?? {})) if (a.metrics?.[k] !== b.metrics[k]) (d.metrics ??= {})[k] = `${a.metrics?.[k]} -> ${b.metrics[k]}`;
  const words = new Set(a.text.split(" "));
  d.new_text = b.text.split(" ").filter(w => !words.has(w)).join(" ").slice(0, 300);
  return d;
}

export function repeatedElements(elements) {
  const counts = {};
  for (const e of elements) { const k = brief(e); counts[k] = (counts[k] ?? 0) + 1; }
  const rep = Object.entries(counts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return rep.length ? Object.fromEntries(rep) : undefined;
}

// Compact, line-per-element rendering for an LLM that takes over from Jev.
export function formatPage(page, { maxElements = 400 } = {}) {
  const lines = [`url: ${page.url}`, `title: ${page.title}`];
  if (page.dialogs?.length) lines.push(`dialogs: ${page.dialogs.join(" || ")}`);
  lines.push(`visible text: ${page.text}`, `elements (${page.elements.length}):`);
  for (const e of page.elements.slice(0, maxElements)) {
    const f = [];
    for (const k of ["label", "text", "placeholder", "name"]) if (e[k]) f.push(`${k === "text" ? "" : k + "="}"${e[k]}"`);
    if (e.value !== undefined && e.value !== "") f.push(`value="${e.value}"`);
    if (e.options) f.push(`options=[${e.options.slice(0, 8).join(", ")}${e.options.length > 8 ? ", …" : ""}]`);
    for (const k of ["checked", "disabled", "busy", "expanded", "active", "hidden"]) if (e[k] !== undefined) f.push(`${k}=${e[k]}`);
    if (e.sorted) f.push(`sorted=${e.sorted}`);
    if (e.href) f.push(`href=${e.href}`);
    if (e.near && !e.text) f.push(`near="${e.near}"`);
    if (e.frame) f.push(`frame=${e.frame}`);
    lines.push(`[${e.i}] ${e.tag} ${f.join(" ")}`);
  }
  if (page.elements.length > maxElements) lines.push(`… ${page.elements.length - maxElements} more`);
  return lines.join("\n");
}
