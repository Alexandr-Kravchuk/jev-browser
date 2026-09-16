// Offline tests: page script against a local fixture, and pure page-model helpers. No Jev calls.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { JevBrowser, repeatsBlock } from "../src/session.mjs";
import { pageDiff, formatPage, repeatedElements } from "../src/page-model.mjs";

const FIXTURE = `<!doctype html><html><head><title>Fixture</title>
<style>.ghost{opacity:0;position:absolute} .hidden{display:none} th{cursor:default} .clicky{cursor:pointer} .far{margin-top:3000px}</style></head><body>
<h1>Fixture page</h1>
<label for="email">Email address</label><input id="email" type="email" placeholder="you@x.com">
<label>Password <input type="password" name="pw"></label>
<span id="lbl">Search the docs</span><input aria-labelledby="lbl">
<div id="boxes"><input type="checkbox"> checkbox 1<br><input type="checkbox" checked> checkbox 2</div>
<ul><li class="completed"><input class="ghost" type="checkbox" aria-label="Toggle Todo"><label>buy milk</label></li></ul>
<input type="file" class="hidden" id="upl">
<button disabled>Save</button><button aria-busy="true">Working…</button>
<select name="s"><option>One</option><option selected>Two</option></select>
<table><thead><tr><th aria-sort="ascending">Last Name</th><th>First</th></tr></thead><tbody><tr><td>Bach</td><td>J</td></tr></tbody></table>
<div class="clicky">Open panel</div>
<img src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2740%27 height=%2740%27/%3E" width="40" height="40" alt="User avatar">
<button class="hidden">Invisible</button>
<div aria-hidden="true"><button>Behind modal</button></div>
<my-el></my-el>
<iframe srcdoc="<input id='inner' placeholder='Inside frame'>" width="300" height="80"></iframe>
<a href="/x">Delete</a><a href="/y">Delete</a>
<p class="far">Offscreen paragraph text</p>
<script>customElements.define("my-el", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<button>Shadow button</button>"; } });</script>
</body></html>`;

let browser, b, page;
before(async () => {
  browser = await chromium.launch();
  b = await JevBrowser.launch({ browser });
  await b.page.setContent(FIXTURE);
  await b.page.waitForTimeout(300);
  page = await b.snapshot();
});
after(async () => { await b.close(); await browser.close(); });

const find = pred => page.elements.find(pred);

test("labels come from for=, wrapping label, aria-labelledby and adjacent text", () => {
  assert.equal(find(e => e.tag === "input:email").label, "Email address");
  assert.equal(find(e => e.tag === "input:password").label, "Password");
  assert.equal(find(e => e.label === "Search the docs")?.tag, "input:text");
  const boxes = page.elements.filter(e => e.tag === "input:checkbox" && /checkbox \d/.test(e.label ?? ""));
  assert.deepEqual(boxes.map(e => [e.label, e.checked]), [["checkbox 1", false], ["checkbox 2", true]]);
});

test("transparent styled checkbox is kept with row context", () => {
  const t = find(e => e.label === "Toggle Todo");
  assert.ok(t, "opacity:0 checkbox listed");
  assert.equal(t.row_state, "completed");
  assert.match(t.near, /buy milk/);
});

test("hidden file input is listed and flagged", () => {
  assert.equal(find(e => e.tag === "input:file")?.hidden, true);
});

test("state flags: disabled, busy, select value/options, sort", () => {
  assert.equal(find(e => e.text === "Save").disabled, true);
  assert.equal(find(e => e.text === "Working…").busy, true);
  const s = find(e => e.tag === "select");
  assert.equal(s.value, "Two"); assert.deepEqual(s.options, ["One", "Two"]);
  assert.equal(find(e => e.tag === "th" && e.text === "Last Name").sorted, "ascending");
});

test("pointer-cursor divs, images, shadow DOM and iframes are reachable", () => {
  assert.ok(find(e => e.text === "Open panel"), "cursor:pointer div");
  assert.ok(find(e => e.tag === "img" && e.text === "User avatar"), "image");
  assert.ok(find(e => e.text === "Shadow button"), "shadow DOM");
  const inner = find(e => e.placeholder === "Inside frame");
  assert.ok(inner?.frame, "iframe element carries its frame");
});

test("hidden and aria-hidden elements are excluded", () => {
  assert.equal(find(e => e.text === "Invisible"), undefined);
  assert.equal(find(e => e.text === "Behind modal"), undefined);
});

test("visible text is the viewport, metrics describe the whole page", () => {
  assert.match(page.text, /Fixture page/);
  assert.doesNotMatch(page.text, /Offscreen paragraph/);
  assert.ok(page.metrics.page_height > 3000);
  assert.equal(page.metrics.elements, page.elements.length);
});

test("repeated elements are counted", () => {
  assert.equal(page.repeated_elements['a "Delete"'], 2);
  assert.equal(repeatedElements([{ tag: "a", text: "x" }]), undefined);
});

test("every element can be located and acted on, including in frames", async () => {
  const inner = find(e => e.placeholder === "Inside frame");
  await b.act({ tool: "type", target: inner.i, value: "hello" });
  assert.equal(await b.locate(inner.i).inputValue(), "hello");
  const box = find(e => e.label === "checkbox 1");
  await b.act({ tool: "click", target: box.i });
  assert.equal(await b.locate(box.i).isChecked(), true);
});

test("pageDiff reports added/removed elements, url and metric changes", () => {
  const a = { url: "u1", text: "hello world", metrics: { elements: 1 }, elements: [{ i: 0, tag: "button", text: "Add" }] };
  const c = { url: "u2", text: "hello world again", metrics: { elements: 2 }, elements: [{ i: 0, tag: "button", text: "Add" }, { i: 1, tag: "button", text: "Delete" }] };
  const d = pageDiff(a, c);
  assert.deepEqual(d.added, ['button "Delete"']);
  assert.deepEqual(d.removed, []);
  assert.equal(d.url, "u1 -> u2");
  assert.equal(d.metrics.elements, "1 -> 2");
  assert.equal(d.new_text, "again");
  assert.equal(pageDiff(null, c), undefined);
});

test("pageDiff reports reordering when the same elements move", () => {
  const els = ["A", "B", "C"].map((t, i) => ({ i, tag: "div", text: t }));
  const a = { url: "u", text: "", elements: els };
  const c = { url: "u", text: "", elements: [els[1], els[0], els[2]] };
  assert.deepEqual(pageDiff(a, c).reordered, { before: ['div "A"', 'div "B"'], after: ['div "B"', 'div "A"'] });
  assert.equal(pageDiff(a, a).reordered, undefined);
});

test("formatPage renders one line per element", () => {
  const txt = formatPage(page);
  assert.match(txt, /^url: /);
  assert.match(txt, /\[\d+\] input:email label="Email address"/);
});

test("resolve keeps tool, target and value consistent", () => {
  const pg = { elements: [{ i: 0, tag: "button", text: "Go" }, { i: 1, tag: "input:text", label: "Name" }, { i: 2, tag: "input:file" }] };
  const ans = (tool, target) => ({ tool: { choice: tool, probabilities: { [tool]: 0.9 } }, target: { probabilities: target }, value: { choice: "name" } });
  // type aimed at a button falls back to the likeliest text field
  let r = b.resolve(pg, ans("type", { 0: 0.7, 1: 0.3, 2: 0 }), { name: "Ada" });
  assert.equal(r.tool, "type"); assert.equal(r.target, 1); assert.equal(r.value, "Ada");
  // type with no values becomes click
  r = b.resolve(pg, ans("type", { 1: 0.9, 0: 0.1 }), {});
  assert.equal(r.tool, "click");
  // upload always lands on a file input
  r = b.resolve(pg, ans("upload", { 0: 0.95, 1: 0.05 }), { name: "/tmp/f" });
  assert.equal(r.target, 2);
});

test("repeatsBlock detects action loops", () => {
  assert.equal(repeatsBlock(["t", "e", "t", "e", "t", "e"], 2, 3), true);
  assert.equal(repeatsBlock(["x", "t", "e", "t", "e"], 2, 3), false);
  assert.equal(repeatsBlock(["a", "a", "a"], 1, 5), false);
  assert.equal(repeatsBlock(["a", "a", "a", "a", "a"], 1, 5), true);
  assert.equal(repeatsBlock(["a", "a", "a", "a", "a", "a"], 2, 3), false);
});
