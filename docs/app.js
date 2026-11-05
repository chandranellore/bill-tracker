/* JAYANAS Bill Tracker: a static single-page app over the JSON files that tools/build.py writes to data/.
   Routes are hash based (#/bill/hr9171) so the site works on any static host. */
"use strict";

const $main = document.getElementById("main");
const $status = document.getElementById("status");
const cache = {};
const TYPES = { HR: "H.R.", S: "S.", HJRES: "H.J.Res.", SJRES: "S.J.Res.", HRES: "H.Res.", SRES: "S.Res.", HCONRES: "H.Con.Res.", SCONRES: "S.Con.Res." };
const TOPIC = { b: ["Budget", "b"], e: ["Energy", "e"], o: ["Offshore and minerals", "o"] };
const STAGES = ["Introduced", "In committee", "Reported", "Passed one chamber", "Passed both chambers", "To President", "Law"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ---------- helpers ---------- */
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtDate(d) {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return esc(d);
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}
function houseDate(d) { // "24-Feb-2026" to ISO
  const m = /^(\d{1,2})-(\w{3})-(\d{4})$/.exec(d || "");
  return m ? `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}` : d;
}
function billLabel(type, number) { return `${TYPES[type] || type} ${number}`; }
function congressUrl(type, number) {
  const kind = { HR: "house-bill", S: "senate-bill", HJRES: "house-joint-resolution", SJRES: "senate-joint-resolution", HRES: "house-resolution", SRES: "senate-resolution", HCONRES: "house-concurrent-resolution", SCONRES: "senate-concurrent-resolution" }[type];
  return `https://www.congress.gov/bill/119th-congress/${kind}/${number}`;
}
function badges(topics) { return [...(topics || "")].map(t => TOPIC[t] ? `<span class="badge ${t}">${TOPIC[t][0]}</span>` : "").join(""); }
function announce(msg) { $status.textContent = ""; setTimeout(() => { $status.textContent = msg; }, 50); }
async function data(name) {
  if (!cache[name]) cache[name] = fetch(`data/${name}`).then(r => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); });
  return cache[name];
}
async function bills() {
  if (!cache._bills) {
    const raw = await data("bills.json");
    const F = raw.fields;
    cache._bills = raw.rows.map(r => { const o = {}; F.forEach((f, i) => o[f] = r[i]); o.label = billLabel(o.type, o.number); return o; });
    cache._billIndex = new Map(cache._bills.map(b => [b.id, b]));
  }
  return cache._bills;
}
async function billRow(id) { await bills(); return cache._billIndex.get(id); }
const store = {
  get(k, d) { try { const v = localStorage.getItem("bt." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("bt." + k, JSON.stringify(v)); } catch (e) { /* storage blocked: features still render */ } },
};
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || "") };
}
function page(title, html) {
  document.title = `${title} | JAYANAS Bill Tracker`;
  $main.innerHTML = html;
  const h1 = $main.querySelector("h1");
  if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}
function setNav(route) {
  document.querySelectorAll("#nav a").forEach(a => {
    const r = a.getAttribute("href").replace("#/", "");
    if (r === route) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}
function laLine(date, text) { return `<div class="meta">${fmtDate(date)}${text ? ": " + esc(text) : ""}</div>`; }
function billItem(b, extra = "") {
  return `<li><a class="item-title" href="#/bill/${b.id}">${esc(b.label)}</a> ${badges(b.topics)}${extra}
    <div>${esc(b.title)}</div>${laLine(b.laDate, b.laText)}</li>`;
}
function watchButton(id) {
  const on = !!store.get("watch", {})[id];
  const row = cache._billIndex && cache._billIndex.get(id);
  return `<button type="button" class="watch small" data-watch="${esc(id)}" aria-pressed="${on}">${on ? "Watching" : "Watch"}<span class="sr"> ${esc(row ? row.label : id)}</span></button>`;
}
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-watch]");
  if (!btn) return;
  const id = btn.dataset.watch;
  const w = store.get("watch", {});
  if (w[id]) { delete w[id]; announce(`Removed from watch list`); }
  else { w[id] = { added: new Date().toISOString().slice(0, 10), seen: null }; announce(`Added to watch list`); }
  store.set("watch", w);
  document.querySelectorAll(`[data-watch="${CSS.escape(id)}"]`).forEach(b => {
    const on = !!w[id]; b.setAttribute("aria-pressed", on); b.firstChild.textContent = on ? "Watching" : "Watch";
  });
});

/* ---------- bill number parsing ---------- */
function parseBillNumber(q) {
  const m = /^\s*(h\.?\s*r\.?|s\.?|h\.?\s*j\.?\s*res\.?|s\.?\s*j\.?\s*res\.?|h\.?\s*res\.?|s\.?\s*res\.?|h\.?\s*con\.?\s*res\.?|s\.?\s*con\.?\s*res\.?)\s*(\d+)\s*$/i.exec(q || "");
  if (!m) return null;
  const t = m[1].toLowerCase().replace(/[.\s]/g, "");
  const map = { hr: "hr", s: "s", hjres: "hjres", sjres: "sjres", hres: "hres", sres: "sres", hconres: "hconres", sconres: "sconres" };
  return map[t] ? map[t] + m[2] : null;
}

/* ---------- Today ---------- */
async function viewHome() {
  const [meta, budget, hv, sv, fr, all] = await Promise.all([data("meta.json"), data("budget.json"), data("votes_house.json"), data("votes_senate.json"), data("fr.json"), bills()]);
  const watch = store.get("watch", {});
  const watched = Object.keys(watch).map(id => cache._billIndex.get(id)).filter(Boolean);
  const changed = watched.filter(b => !watch[b.id].seen || b.laDate > watch[b.id].seen);
  const latestDigest = meta.digests[0];
  const fy = budget.fy2027;
  const passedH = fy.rows.filter(r => r.house && r.house.stage >= 3).length;
  const reported = fy.rows.filter(r => (r.house && r.house.stage >= 2) || (r.senate && r.senate.stage >= 2)).length;
  const offshoreFr = fr.filter(d => d.topics.includes("offshore")).slice(0, 5);
  const recentLaws = all.filter(b => b.stage === 6 || /Became Public Law/.test(b.laText)).sort((a, b) => b.laDate.localeCompare(a.laDate)).slice(0, 5);
  page("Today", `
    <h1>Today</h1>
    <p class="lede">Federal budget, appropriations, legislative and energy-policy activity from official sources. Updated ${fmtDate(meta.built.slice(0, 10))}; latest congressional action on file is dated ${fmtDate(meta.latestAction)}.</p>
    <div class="grid">
      <section class="card" aria-labelledby="h-digest"><h2 id="h-digest">This morning's digest</h2>
        <p>${fmtDate(latestDigest.date)}: ${latestDigest.counts.budget} budget items, ${latestDigest.counts.votes} roll-call votes, ${latestDigest.counts.energy} energy bill actions, ${latestDigest.counts.fr} Federal Register documents.</p>
        <p><a class="button" href="#/digest/${latestDigest.date}">Read the digest</a></p></section>
      <section class="card" aria-labelledby="h-watch"><h2 id="h-watch">Your watch list</h2>
        ${watched.length ? `<p><span class="stat">${changed.length}</span> of ${watched.length} watched bills have new action since you last looked.</p><p><a href="#/watch">Open watch list</a></p>`
          : `<p>You are not watching any bills yet. Use the <strong>Watch</strong> button on any bill.</p><p><a href="#/budget">Start with appropriations</a></p>`}</section>
      <section class="card" aria-labelledby="h-fy"><h2 id="h-fy">FY ${fy.fy} appropriations</h2>
        <p><span class="stat">${reported}</span> of 12 regular bills reported in at least one chamber; <span class="stat">${passedH}</span> passed the House.</p>
        <p><a href="#/budget">Status of all 12 bills</a></p></section>
    </div>
    <h2>Latest floor votes</h2>
    <div class="grid">
      <section aria-labelledby="h-hv"><h3 id="h-hv">House</h3><ul class="plain">${hv.slice(0, 5).map(v => `<li><a href="#/vote/house/${v.key}">Roll ${v.roll}: ${esc(v.question)}</a> ${esc(v.legis)}<div class="meta">${fmtDate(houseDate(v.date))}. ${esc(v.result)}, ${v.yea}-${v.nay}</div></li>`).join("")}</ul></section>
      <section aria-labelledby="h-sv"><h3 id="h-sv">Senate</h3><ul class="plain">${sv.slice(0, 5).map(senateVoteItem).join("")}</ul></section>
    </div>
    <h2>Offshore and minerals: latest Federal Register documents</h2>
    <ul class="plain">${offshoreFr.map(frItem).join("")}</ul>
    <p><a href="#/energy">Energy and minerals view</a></p>
    <h2>Recently enacted</h2>
    <ul class="plain">${recentLaws.map(b => billItem(b)).join("")}</ul>`);
}
function senateVoteItem(v) {
  const q = v.pending ? esc(v.text) : `${esc(v.question)}${v.legis ? " " + esc(v.legis) : ""}`;
  const res = v.pending ? "" : `. ${esc(v.result)}, ${v.yea}-${v.nay}`;
  return `<li><a href="#/vote/senate/${v.key}">Vote ${esc(v.clerk_roll || v.roll)}: ${q}</a><div class="meta">${fmtDate(v.date)}${res}</div></li>`;
}
function frItem(d) {
  const flag = d.topics.includes("offshore") ? `<span class="badge o">Offshore and minerals</span>` : "";
  const c = d.comments ? ` Comments close ${fmtDate(d.comments)}.` : "";
  return `<li>${flag}<a class="item-title" href="${esc(d.url)}">${esc(d.title)}</a>
    <div class="meta">${esc(d.type)}, ${esc(d.agencies.slice(0, 2).join("; "))}. Published ${fmtDate(d.date)}.${c}</div></li>`;
}

/* ---------- Search ---------- */
function tokens(q) { return (q || "").toLowerCase().split(/[^a-z0-9.]+/).map(t => t.replace(/\.+$/, "")).filter(t => t.length > 1 || /\d/.test(t)); }
function score(text, toks) {
  const t = text.toLowerCase();
  let s = 0;
  for (const k of toks) { const i = t.indexOf(k); if (i < 0) return 0; s += i === 0 ? 3 : 1; }
  return s;
}
async function viewSearch(q) {
  const params = {
    q: q.get("q") || "", kind: q.get("kind") || "bills", chamber: q.get("chamber") || "", topic: q.get("topic") || "",
    stage: q.get("stage") || "", from: q.get("from") || "", to: q.get("to") || "", committee: q.get("committee") || "", sort: q.get("sort") || "rel",
  };
  const committees = await data("committees.json");
  const top = Object.entries(committees).filter(([k, v]) => !v.parent).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`;
  page(params.q ? `Search: ${params.q}` : "Search", `
    <h1>Search</h1>
    <p class="lede">Searches bill numbers, titles and latest actions for all ${"19,000+"} bills and resolutions of the 119th Congress, plus roll-call votes, members of Congress and Federal Register documents from energy, minerals and budget agencies.</p>
    <form class="filters" id="sform" role="search">
      <div class="f grow"><label for="sq">Words or bill number</label><input id="sq" name="q" type="search" value="${esc(params.q)}"></div>
      <div class="f"><label for="skind">Look in</label><select id="skind" name="kind">${opt("bills", "Bills and resolutions", params.kind)}${opt("fr", "Federal Register", params.kind)}${opt("votes", "Roll-call votes", params.kind)}${opt("members", "Members", params.kind)}</select></div>
      <div class="f"><label for="schamber">Chamber</label><select id="schamber" name="chamber">${opt("", "Both", params.chamber)}${opt("H", "House", params.chamber)}${opt("S", "Senate", params.chamber)}</select></div>
      <div class="f"><label for="stopic">Topic</label><select id="stopic" name="topic">${opt("", "Any", params.topic)}${opt("b", "Budget and appropriations", params.topic)}${opt("e", "Energy", params.topic)}${opt("o", "Offshore and minerals", params.topic)}</select></div>
      <div class="f"><label for="sstage">Furthest stage</label><select id="sstage" name="stage">${opt("", "Any", params.stage)}${STAGES.slice(2).map((s, i) => opt(String(i + 2), "At least: " + s, params.stage)).join("")}</select></div>
      <div class="f"><label for="scomm">Committee</label><select id="scomm" name="committee">${opt("", "Any", params.committee)}${top.map(([k, v]) => opt(k.toLowerCase() + "00", `${v.chamber === "senate" ? "Senate" : v.chamber === "house" ? "House" : "Joint"}: ${v.name.replace(/^(House|Senate) (Committee on )?/, "")}`, params.committee)).join("")}</select></div>
      <div class="f"><label for="sfrom">Latest action from</label><input id="sfrom" name="from" type="date" value="${esc(params.from)}"></div>
      <div class="f"><label for="sto">to</label><input id="sto" name="to" type="date" value="${esc(params.to)}"></div>
      <div class="f"><label for="ssort">Sort</label><select id="ssort" name="sort">${opt("rel", "Best match", params.sort)}${opt("new", "Newest action", params.sort)}</select></div>
      <div class="f"><button type="submit">Search</button></div>
    </form>
    <p class="small muted">Stage and committee filters apply to the ${"2,500"} bills tracked in full (appropriations, budget, energy and minerals, and every bill that has moved beyond introduction).</p>
    <div id="results" aria-live="off"></div>`);
  document.getElementById("sform").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const p = new URLSearchParams();
    for (const [k, v] of fd) if (v) p.set(k, v);
    location.hash = "#/search?" + p.toString();
  });
  const out = document.getElementById("results");
  const toks = tokens(params.q);
  let rows = [], render;
  if (params.kind === "bills") {
    const all = await bills();
    const direct = parseBillNumber(params.q);
    rows = all.filter(b => {
      if (params.chamber && b.chamber !== params.chamber) return false;
      if (params.topic && !b.topics.includes(params.topic)) return false;
      if (params.stage && b.stage < +params.stage) return false;
      if (params.committee && !b.committees.includes(params.committee)) return false;
      if (params.from && b.laDate < params.from) return false;
      if (params.to && b.laDate > params.to) return false;
      return true;
    });
    if (direct) rows = rows.filter(b => b.id === direct);
    else if (toks.length) rows = rows.map(b => [b, score(`${b.label} ${b.id} ${b.title} ${b.laText} ${b.policy}`, toks)]).filter(x => x[1]).sort((a, b) => params.sort === "new" ? b[0].laDate.localeCompare(a[0].laDate) : b[1] - a[1] || b[0].laDate.localeCompare(a[0].laDate)).map(x => x[0]);
    else rows.sort((a, b) => b.laDate.localeCompare(a.laDate));
    render = b => billItem(b, " " + watchButton(b.id));
  } else if (params.kind === "fr") {
    const fr = await data("fr.json");
    rows = fr.filter(d => (!params.topic || params.topic !== "o" || d.topics.includes("offshore")) && (!params.from || d.date >= params.from) && (!params.to || d.date <= params.to));
    if (toks.length) rows = rows.map(d => [d, score(`${d.title} ${d.abstract} ${d.agencies.join(" ")} ${d.action} ${d.rin.join(" ")} ${d.docket.join(" ")} ${d.id}`, toks)]).filter(x => x[1]).sort((a, b) => params.sort === "new" ? b[0].date.localeCompare(a[0].date) : b[1] - a[1]).map(x => x[0]);
    render = frItem;
  } else if (params.kind === "votes") {
    const [hv, sv] = await Promise.all([data("votes_house.json"), data("votes_senate.json")]);
    let all = [];
    if (params.chamber !== "S") all = all.concat(hv.map(v => ({ ch: "house", v, d: houseDate(v.date), text: `${v.legis} ${v.question} ${v.desc} ${v.result} roll ${v.roll}` })));
    if (params.chamber !== "H") all = all.concat(sv.map(v => ({ ch: "senate", v, d: v.date, text: `${v.legis || ""} ${v.question || ""} ${v.desc || ""} ${v.text || ""} ${v.result || ""} vote ${v.clerk_roll || v.roll}` })));
    rows = all.filter(x => (!params.from || x.d >= params.from) && (!params.to || x.d <= params.to));
    if (toks.length) rows = rows.map(x => [x, score(x.text, toks)]).filter(x => x[1]).map(x => x[0]);
    rows.sort((a, b) => b.d.localeCompare(a.d));
    render = x => x.ch === "house"
      ? `<li><a class="item-title" href="#/vote/house/${x.v.key}">House roll ${x.v.roll}: ${esc(x.v.question)} ${esc(x.v.legis)}</a><div>${esc(x.v.desc)}</div><div class="meta">${fmtDate(x.d)}. ${esc(x.v.result)}, ${x.v.yea}-${x.v.nay}</div></li>`
      : senateVoteItem(x.v);
  } else {
    const members = await data("members.json");
    rows = members.filter(m => !params.chamber || m.chamber[0] === params.chamber);
    if (toks.length) rows = rows.map(m => [m, score(`${m.name} ${m.state} ${m.party} ${m.committees.map(c => c.name).join(" ")}`, toks)]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    render = memberItem;
  }
  let shown = 0;
  const per = 25;
  out.innerHTML = `<h2 id="rcount">${rows.length.toLocaleString()} result${rows.length === 1 ? "" : "s"}</h2><ul class="plain" id="rlist"></ul><div class="pager"></div>`;
  const list = out.querySelector("#rlist"), pager = out.querySelector(".pager");
  function more() {
    const next = rows.slice(shown, shown + per);
    list.insertAdjacentHTML("beforeend", next.map(render).join(""));
    const firstNew = list.children[shown];
    shown += next.length;
    pager.innerHTML = shown < rows.length ? `<button type="button" id="more">Show ${Math.min(per, rows.length - shown)} more of ${(rows.length - shown).toLocaleString()} remaining</button>` : "";
    const b = document.getElementById("more");
    if (b) b.addEventListener("click", () => { more(); });
    return firstNew;
  }
  more();
  pager.addEventListener("click", e => { if (e.target.id === "more") { const li = list.children[shown - per]; if (li) { const a = li.querySelector("a"); if (a) a.focus(); } } });
  if (!rows.length) list.innerHTML = `<li class="empty">No results. Try fewer words or fewer filters.</li>`;
  announce(`${rows.length} results`);
}

/* ---------- Bill page ---------- */
async function viewBill(id, q) {
  const row = await billRow(id);
  if (!row) return page("Not found", `<h1>Bill not found</h1><p>No bill ${esc(id)} in the 119th Congress. <a href="#/search">Search</a></p>`);
  let rec = null;
  if (row.detail) { try { rec = await (await fetch(`data/bill/${id}.json`)).json(); } catch (e) { rec = null; } }
  const watch = store.get("watch", {});
  if (watch[id]) { watch[id].seen = row.laDate; store.set("watch", watch); }
  if (!rec) {
    return page(row.label, `
      <p class="meta">119th Congress · ${row.chamber === "H" ? "House" : "Senate"}</p>
      <h1>${esc(row.label)}: ${esc(row.title)}</h1>
      <div class="toolbar">${watchButton(id)} <a href="${congressUrl(row.type, row.number)}">Open on Congress.gov</a></div>
      <dl class="facts"><dt>Introduced</dt><dd>${fmtDate(row.introduced)}</dd><dt>Latest action</dt><dd>${fmtDate(row.laDate)}: ${esc(row.laText)}</dd></dl>
      <p class="notice">This bill has not moved beyond introduction and is outside the budget, appropriations and energy topics, so the tracker keeps its title and latest action. Watch it to be alerted to new action; full history is on Congress.gov.</p>`);
  }
  const sponsor = rec.sponsor[0];
  const stagesHtml = `<ol class="stages" aria-label="Progress">${STAGES.map((s, i) => `<li class="${i <= rec.stage ? "done" : ""}${i === rec.stage ? " current" : ""}">${i <= rec.stage ? `<span class="sr">Completed: </span>` : `<span class="sr">Not yet: </span>`}${s}${i === rec.stage ? `<span class="sr"> (current stage)</span>` : ""}</li>`).join("")}</ol>`;
  const versions = rec.versions.filter(v => v.local);
  const summary = rec.summaries[rec.summaries.length - 1];
  const hv = rec.actions.filter(a => a.v);
  page(row.label, `
    <p class="meta">119th Congress · ${esc(rec.chamber)} · ${badges(row.topics)}${rec.policy ? `<span class="badge plain">${esc(rec.policy)}</span>` : ""}</p>
    <h1>${esc(row.label)}: ${esc(rec.title)}</h1>
    <div class="toolbar">${watchButton(id)} <a href="${congressUrl(rec.type, rec.number)}">Congress.gov</a></div>
    ${stagesHtml}
    <dl class="facts">
      <dt>Sponsor</dt><dd>${sponsor ? `<a href="#/member/${sponsor.id}">${esc(sponsor.name)}</a>` : "None listed"}${rec.cosponsors ? `, with ${rec.cosponsors} cosponsor${rec.cosponsors === 1 ? "" : "s"}` : ""}</dd>
      <dt>Introduced</dt><dd>${fmtDate(rec.introduced)}</dd>
      <dt>Latest action</dt><dd>${fmtDate(rec.la.actionDate)}: ${esc(rec.la.text)}</dd>
      <dt>Committees</dt><dd>${rec.committees.map(c => `${esc(c.name)} (${esc(c.chamber)})${c.subs.length ? ": " + c.subs.map(s => esc(s.name)).join("; ") : ""}`).join("<br>") || "None"}</dd>
      ${rec.laws.length ? `<dt>Law</dt><dd>${rec.laws.map(l => `${esc(l.type)} ${esc(l.number)}`).join(", ")}</dd>` : ""}
      ${rec.reports.length ? `<dt>Committee reports</dt><dd>${rec.reports.map(r => esc(r.citation)).join(", ")}</dd>` : ""}
    </dl>
    <h2 id="summary">Summary</h2>
    ${summary ? `<p class="meta">Congressional Research Service summary of the version ${esc(summary.v.toLowerCase())}, ${fmtDate(summary.d)}.</p><div class="summary">${summary.html}</div>` : `<p class="muted">No CRS summary has been published yet.</p>`}
    ${rec.cbo.length ? `<h2>CBO cost estimates</h2><ul class="plain">${rec.cbo.map(c => `<li><a class="item-title" href="${esc(c.url)}">${esc(c.title)}</a><div class="meta">${fmtDate(c.date)}. ${esc(c.desc)}</div></li>`).join("")}</ul>` : ""}
    <h2 id="text">Text and version comparison</h2>
    ${rec.versions.length ? `<div class="table-wrap"><table><caption>Published text versions (${rec.versions.length})</caption><thead><tr><th scope="col">Version</th><th scope="col">Date</th><th scope="col">Formats</th></tr></thead><tbody>
      ${rec.versions.map(v => `<tr><td>${esc(v.type)}</td><td>${fmtDate(v.date) || "Not dated"}</td><td>${v.local ? `<a href="${esc(v.local)}">Plain text</a> · ` : ""}${v.htm ? `<a href="${esc(v.htm)}">Formatted text</a>` : ""}${v.pdf ? ` · <a href="${esc(v.pdf)}">PDF</a>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No text published yet.</p>`}
    ${versions.length >= 2 ? `
      <form class="filters" id="cmp">
        <div class="f"><label for="va">Compare from</label><select id="va">${versions.map((v, i) => `<option value="${i}"${i === versions.length - 2 ? " selected" : ""}>${esc(v.type)}${v.date ? ", " + fmtDate(v.date) : ""}</option>`).join("")}</select></div>
        <div class="f"><label for="vb">to</label><select id="vb">${versions.map((v, i) => `<option value="${i}"${i === versions.length - 1 ? " selected" : ""}>${esc(v.type)}${v.date ? ", " + fmtDate(v.date) : ""}</option>`).join("")}</select></div>
        <div class="f"><label class="check"><input type="checkbox" id="vonly" checked> Show only changed passages</label></div>
        <div class="f"><button type="submit">Compare versions</button></div>
      </form>
      <div id="diffout"></div>` : versions.length === 1 ? `<p class="muted">Only one version has been published, so there is nothing to compare yet.</p>` : ""}
    ${rec.amendments.length ? `<h2>Amendments (${rec.amendments.length})</h2><ul class="plain">${rec.amendments.map(a => `<li><span class="item-title">${esc(a.type)} ${esc(a.number)}</span> ${esc(a.purpose || a.desc)}${laLine(a.la.actionDate, a.la.text)}</li>`).join("")}</ul>` : ""}
    ${hv.length ? `<h2>Roll-call votes</h2><ul class="plain">${hv.map(a => a.v.map(v => `<li><a href="#/vote/${v.ch.toLowerCase()}/${v.ch === "House" ? (v.date || a.d).slice(0, 4) : v.sess}-${v.roll}">${esc(v.ch)} ${v.ch === "House" ? "roll" : "vote"} ${v.roll}</a>: ${esc(a.t)}<div class="meta">${fmtDate(a.d)}</div></li>`).join("")).join("")}</ul>` : ""}
    <h2>All actions (${rec.actions.length})</h2>
    <div class="table-wrap"><table><caption class="sr">Actions, newest first</caption><thead><tr><th scope="col">Date</th><th scope="col">Chamber</th><th scope="col">Action</th></tr></thead><tbody>
      ${rec.actions.map(a => `<tr><td>${fmtDate(a.d)}</td><td>${a.c === "H" ? "House" : a.c === "S" ? "Senate" : esc(a.k)}</td><td>${esc(a.t)}</td></tr>`).join("")}</tbody></table></div>
    ${rec.related.length ? `<h2>Related bills</h2><ul class="plain">${rec.related.map(r => `<li><a href="#/bill/${r.id}">${esc(r.id.toUpperCase())}</a> ${esc(r.title)} <span class="meta">(${esc(r.rel.join(", "))})</span>${laLine(r.la.actionDate, r.la.text)}</li>`).join("")}</ul>` : ""}
  `);
  const form = document.getElementById("cmp");
  if (form) {
    form.addEventListener("submit", e => { e.preventDefault(); compare(versions, +document.getElementById("va").value, +document.getElementById("vb").value, document.getElementById("vonly").checked); });
    if (q.get("compare")) compare(versions, versions.length - 2, versions.length - 1, true);
  }
}

/* ---------- version comparison ---------- */
function paragraphs(text) {
  // GPO text is hard-wrapped; rebuild paragraphs so a re-wrap is not reported as a change
  const body = text.replace(/\r/g, "").replace(/^[\s\S]*?<DOC>\s*/, "").replace(/<all>\s*$/, "");
  return body.split(/\n\s*\n+/).map(p => p.replace(/\s+/g, " ").trim()).filter(p => p && !/^_+$/.test(p));
}
let worker = null;
function diffParas(a, b) {
  return new Promise((resolve, reject) => {
    if (worker) worker.terminate();
    worker = new Worker("diffworker.js");
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("timeout")); }, 45000);
    worker.onmessage = e => { clearTimeout(timer); resolve(e.data); };
    worker.onerror = e => { clearTimeout(timer); reject(e); };
    worker.postMessage({ a, b });
  });
}
async function compare(versions, ia, ib, onlyChanges) {
  const out = document.getElementById("diffout");
  if (ia === ib) { out.innerHTML = `<p class="notice">Choose two different versions.</p>`; return; }
  const va = versions[ia], vb = versions[ib];
  out.innerHTML = `<p class="loading" role="status">Comparing ${esc(va.type)} with ${esc(vb.type)}…</p>`;
  try {
    const [ta, tb] = await Promise.all([fetch(va.local).then(r => r.text()), fetch(vb.local).then(r => r.text())]);
    const res = await diffParas(paragraphs(ta), paragraphs(tb));
    let html = "", added = 0, removed = 0, changed = 0, gap = 0, n = 0;
    const flush = () => { if (gap) { html += `<p class="gap">${gap} unchanged paragraph${gap === 1 ? "" : "s"}</p>`; gap = 0; } };
    for (const seg of res.segs) {
      if (seg.kind === "same") { if (onlyChanges) gap++; else html += `<p>${esc(seg.text)}</p>`; continue; }
      flush();
      n++;
      if (seg.kind === "add") { added++; html += `<p class="added" id="chg${n}"><span class="sr">Paragraph added: </span><ins>${esc(seg.text)}</ins></p>`; }
      else if (seg.kind === "del") { removed++; html += `<p class="removed" id="chg${n}"><span class="sr">Paragraph removed: </span><del>${esc(seg.text)}</del></p>`; }
      else {
        changed++;
        html += `<p class="changed" id="chg${n}"><span class="sr">Paragraph changed: </span>${seg.parts.map(p => p.added ? `<ins><span class="sr">[inserted] </span>${esc(p.value)}</ins>` : p.removed ? `<del><span class="sr">[deleted] </span>${esc(p.value)}</del>` : esc(p.value)).join("")}</p>`;
      }
    }
    flush();
    const total = added + removed + changed;
    out.innerHTML = `<h3 id="diffhead" tabindex="-1">${esc(va.type)} compared with ${esc(vb.type)}</h3>
      <p>${total ? `${changed} paragraph${changed === 1 ? "" : "s"} changed, ${added} added and ${removed} removed.` : "No differences in the text."}${res.coarse ? " The versions differ widely, so changes are shown paragraph by paragraph." : ""}</p>
      <p class="small legend-key">Key: <ins>inserted text</ins> <del>deleted text</del>. Screen readers announce each change.</p>
      ${total ? `<div class="toolbar"><button type="button" class="secondary small" id="nextchg">Next change</button> <span class="small muted" id="chgpos"></span></div>` : ""}
      <div class="diff">${html}</div>`;
    document.getElementById("diffhead").focus();
    announce(`${total} changes found`);
    let pos = 0;
    const nb = document.getElementById("nextchg");
    if (nb) nb.addEventListener("click", () => {
      pos = pos % n + 1;
      const el = document.getElementById("chg" + pos);
      el.setAttribute("tabindex", "-1"); el.focus(); el.scrollIntoView({ block: "center" });
      document.getElementById("chgpos").textContent = `Change ${pos} of ${n}`;
    });
  } catch (e) {
    out.innerHTML = `<p class="notice">The comparison could not be completed in the browser (${esc(e.message || "error")}). Try two closer versions.</p>`;
  }
}

/* ---------- watch list ---------- */
async function viewWatch() {
  await bills();
  const watch = store.get("watch", {});
  const items = Object.keys(watch).map(id => cache._billIndex.get(id)).filter(Boolean).sort((a, b) => b.laDate.localeCompare(a.laDate));
  page("Watch list", `
    <h1>Watch list</h1>
    <p class="lede">Bills you follow, newest action first. <strong>New</strong> marks action since you last opened the bill. Each watched bill is also an alert: see <a href="#/alerts">Alerts</a>.</p>
    ${items.length ? `<div class="table-wrap"><table><caption>${items.length} watched bill${items.length === 1 ? "" : "s"}</caption><thead><tr><th scope="col">Bill</th><th scope="col">Latest action</th><th scope="col">Stage</th><th scope="col"><span class="sr">Watch</span></th></tr></thead><tbody>
      ${items.map(b => { const isNew = !watch[b.id].seen || b.laDate > watch[b.id].seen; return `<tr><td><a href="#/bill/${b.id}">${esc(b.label)}</a> ${isNew ? `<span class="badge new">New</span>` : ""}<div class="small">${esc(b.title)}</div></td><td>${fmtDate(b.laDate)}: ${esc(b.laText)}</td><td>${b.stage >= 0 ? STAGES[b.stage] : "Introduced"}</td><td>${watchButton(b.id)}</td></tr>`; }).join("")}
      </tbody></table></div>
      <div class="toolbar"><button type="button" class="secondary" id="exportw">Download watch list (CSV)</button></div>`
      : `<p class="empty">No bills yet. Open any bill and press <strong>Watch</strong>, or add some suggestions:</p>
         <div class="toolbar"><button type="button" id="seed">Watch FY 2027 Interior and Energy and Water appropriations</button></div>`}`);
  const seed = document.getElementById("seed");
  if (seed) seed.addEventListener("click", async () => {
    const b = await data("budget.json");
    const w = store.get("watch", {});
    b.fy2027.rows.filter(r => /Interior|Energy and Water/.test(r.sub)).forEach(r => [r.house, r.senate].forEach(x => { if (x) w[x.id] = { added: new Date().toISOString().slice(0, 10), seen: null }; }));
    store.set("watch", w); viewWatch(); announce("Added to watch list");
  });
  const ex = document.getElementById("exportw");
  if (ex) ex.addEventListener("click", () => {
    const csv = [["Bill", "Title", "Latest action date", "Latest action", "Link"]].concat(items.map(b => [b.label, b.title, b.laDate, b.laText, congressUrl(b.type, b.number)]))
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "watch-list.csv"; a.click();
  });
}

/* ---------- alerts ---------- */
const ALERT_KINDS = { keyword: "Keyword or phrase", bill: "Bill number", committee: "Committee", member: "Member of Congress (as sponsor)" };
async function alertMatches(rules, feed) {
  await bills();
  const committees = await data("committees.json");
  const watch = Object.keys(store.get("watch", {}));
  const all = rules.concat(watch.map(id => ({ id: "w-" + id, kind: "bill", value: id, freq: "daily", watch: true })));
  const res = [];
  for (const e of feed) {
    const row = e.id ? cache._billIndex.get(e.id) : null;
    for (const r of all) {
      let hit = false;
      if (r.kind === "keyword") {
        const k = r.value.toLowerCase();
        hit = (e.t || "").toLowerCase().includes(k) || (row && row.title.toLowerCase().includes(k));
      } else if (r.kind === "bill") hit = e.id === r.value;
      else if (r.kind === "committee") {
        const name = ((committees[r.value.slice(0, 4).toUpperCase()] || {}).name || "").replace(/^(House|Senate) /, "");
        hit = (row && row.committees.includes(r.value)) || (name && (e.t || "").includes(name));
      } else if (r.kind === "member") hit = row && row.sponsor === r.value;
      if (hit) { res.push({ e, r, row }); break; }
    }
  }
  return res;
}
function eventLink(e, row) {
  if (e.k === "action" && row) return `<a href="#/bill/${row.id}">${esc(row.label)}</a> ${esc(row.title.slice(0, 140))}`;
  if (e.k === "vote") return `<a href="#/vote/${e.ch.toLowerCase()}/${e.key}">${esc(e.ch)} vote</a>`;
  if (e.k === "fr") return `<a href="https://www.federalregister.gov/d/${esc(e.id)}">Federal Register ${esc(e.id)}</a>`;
  if (e.k === "cbo") return `<a href="${esc(e.url)}">CBO</a>`;
  return "";
}
async function viewAlerts() {
  const [feed, committees, members] = await Promise.all([data("changes.json"), data("committees.json"), data("members.json")]);
  const rules = store.get("alerts", []);
  const lastCheck = store.get("alertsChecked", "");
  const top = Object.entries(committees).filter(([k, v]) => !v.parent).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const describe = r => r.kind === "committee" ? ((committees[r.value.slice(0, 4).toUpperCase()] || {}).name || r.value)
    : r.kind === "member" ? ((members.find(m => m.id === r.value) || {}).name || r.value) : r.value;
  const matches = await alertMatches(rules, feed);
  page("Alerts", `
    <h1>Alerts</h1>
    <p class="lede">Set alerts on keywords, bills, committees or members. Each alert is delivered by email immediately, in the daily digest or in a weekly summary. Watched bills are included automatically.</p>
    <p class="notice">In this demonstration your alerts are saved in this browser, and matching items are listed below rather than emailed. Subscribers' alerts are saved to their account and emailed.</p>
    <h2>Add an alert</h2>
    <form class="filters" id="aform">
      <div class="f"><label for="akind">Alert on</label><select id="akind">${Object.entries(ALERT_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div class="f grow" id="avaluewrap"><label for="avalue">Keyword or phrase</label><input id="avalue" type="text" required></div>
      <div class="f"><label for="afreq">Delivery</label><select id="afreq"><option value="immediate">Immediately</option><option value="daily" selected>Daily digest</option><option value="weekly">Weekly summary</option></select></div>
      <div class="f"><button type="submit">Add alert</button></div>
    </form>
    <h2>Your alerts (${rules.length})</h2>
    ${rules.length ? `<ul class="plain">${rules.map(r => `<li><strong>${esc(ALERT_KINDS[r.kind])}:</strong> ${esc(describe(r))} <span class="meta">· ${r.freq === "immediate" ? "Immediately" : r.freq === "daily" ? "Daily digest" : "Weekly summary"}</span> <button type="button" class="secondary small" data-del="${esc(r.id)}">Remove<span class="sr"> alert ${esc(describe(r))}</span></button></li>`).join("")}</ul>`
      : `<p class="empty">No alerts yet. Try a keyword such as <em>offshore</em>, <em>continuing appropriations</em> or <em>critical minerals</em>.</p>`}
    <h2>Matches in the last 45 days (${matches.length})</h2>
    ${matches.length ? `<div class="toolbar"><button type="button" class="secondary small" id="markread">Mark all as read</button> <button type="button" class="secondary small" id="preview">Preview as an alert email</button></div>
      <ul class="plain">${matches.slice(0, 200).map(({ e, r, row }) => `<li>${lastCheck && e.d > lastCheck ? `<span class="badge new">New</span>` : ""}${eventLink(e, row)}<div>${esc(e.t)}</div><div class="meta">${fmtDate(e.d)} · matched ${r.watch ? "watch list" : esc(ALERT_KINDS[r.kind].toLowerCase()) + " “" + esc(describe(r)) + "”"}</div></li>`).join("")}</ul>`
      : `<p class="empty">Nothing matched yet.</p>`}
    <div id="emailpreview"></div>`);
  const kind = document.getElementById("akind"), wrap = document.getElementById("avaluewrap");
  function valueField() {
    const k = kind.value;
    if (k === "committee") wrap.innerHTML = `<label for="avalue">Committee</label><select id="avalue">${top.map(([c, v]) => `<option value="${c.toLowerCase()}00">${esc((v.chamber === "senate" ? "Senate: " : v.chamber === "house" ? "House: " : "Joint: ") + v.name.replace(/^(House|Senate) (Committee on )?/, ""))}</option>`).join("")}</select>`;
    else if (k === "member") wrap.innerHTML = `<label for="avalue">Member</label><select id="avalue">${members.slice().sort((a, b) => a.last.localeCompare(b.last)).map(m => `<option value="${m.id}">${esc(m.last)}, ${esc(m.first)} (${esc(m.party[0])}-${esc(m.state)})</option>`).join("")}</select>`;
    else wrap.innerHTML = `<label for="avalue">${k === "bill" ? "Bill number, such as H.R. 9171" : "Keyword or phrase"}</label><input id="avalue" type="text" required>`;
  }
  kind.addEventListener("change", valueField);
  document.getElementById("aform").addEventListener("submit", e => {
    e.preventDefault();
    let v = document.getElementById("avalue").value.trim();
    if (!v) return;
    if (kind.value === "bill") { const id = parseBillNumber(v); if (!id || !cache._billIndex.get(id)) { announce("Bill number not recognized"); alert("That bill number is not in the 119th Congress. Use a form like H.R. 9171 or S. 2431."); return; } v = id; }
    const list = store.get("alerts", []);
    list.push({ id: Date.now().toString(36), kind: kind.value, value: v, freq: document.getElementById("afreq").value });
    store.set("alerts", list);
    viewAlerts().then(() => announce("Alert added"));
  });
  $main.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    store.set("alerts", store.get("alerts", []).filter(r => r.id !== b.dataset.del)); viewAlerts().then(() => announce("Alert removed"));
  }));
  const mr = document.getElementById("markread");
  if (mr) mr.addEventListener("click", () => { store.set("alertsChecked", feed.length ? feed[0].d : ""); viewAlerts().then(() => announce("Marked as read")); });
  const pv = document.getElementById("preview");
  if (pv) pv.addEventListener("click", () => {
    const el = document.getElementById("emailpreview");
    const recent = matches.slice(0, 20);
    el.innerHTML = `<h2 id="eph" tabindex="-1">Alert email preview</h2><div class="digest-frame"><div style="max-width:640px;padding:16px;font-family:Arial,sans-serif;">
      <p style="margin:0;color:#4a4f57;font-size:13px;">JAYANAS Bill Tracker alert</p><h3 style="color:#1f3a5f;margin:4px 0 10px;">${recent.length} new item${recent.length === 1 ? "" : "s"} match your alerts</h3>
      <ul>${recent.map(({ e, row }) => `<li style="margin-bottom:8px;">${eventLink(e, row)}<br><span style="color:#4a4f57;">${fmtDate(e.d)}: ${esc(e.t)}</span></li>`).join("")}</ul>
      <p style="font-size:13px;color:#4a4f57;">You receive this because of alerts set in your account. Change them on the Alerts page.</p></div></div>`;
    document.getElementById("eph").focus();
  });
}

/* ---------- digest ---------- */
async function viewDigest(date) {
  const meta = await data("meta.json");
  const d = date || meta.digests[0].date;
  const entry = meta.digests.find(x => x.date === d);
  if (!entry) return page("Digest", `<h1>Digest not found</h1><p><a href="#/digest">Latest digest</a></p>`);
  const html = await fetch(`digest/${d}.html`).then(r => r.text());
  const body = new DOMParser().parseFromString(html, "text/html").querySelector("main");
  body.querySelector("h1").outerHTML = "";
  page(`Daily digest ${d}`, `
    <h1>Daily digest: ${fmtDate(d)}</h1>
    <p class="lede">The email subscribers receive each business morning. It covers official actions dated ${entry.start === entry.end ? fmtDate(entry.start) : fmtDate(entry.start) + " to " + fmtDate(entry.end)}.</p>
    <div class="toolbar"><a class="button secondary" href="digest/${d}.html">Open the email version</a> <a class="button secondary" href="digest/${d}.txt">Plain-text version</a></div>
    <div class="digest-frame">${body.innerHTML}</div>
    <h2>Earlier digests</h2>
    <ul class="plain">${meta.digests.map(x => `<li><a href="#/digest/${x.date}"${x.date === d ? ' aria-current="page"' : ""}>${fmtDate(x.date)}</a> <span class="meta">${x.counts.budget} budget, ${x.counts.votes} votes, ${x.counts.energy} energy, ${x.counts.fr} Federal Register</span></li>`).join("")}</ul>`);
}

/* ---------- budget ---------- */
function stageCell(x) {
  if (!x) return `<td class="muted">No bill yet</td>`;
  return `<td><a href="#/bill/${x.id}">${esc(x.label)}</a><div><strong>${STAGES[x.stage] || ""}</strong></div><div class="small muted">${fmtDate(x.la.actionDate)}</div></td>`;
}
function approTable(t, caption) {
  return `<div class="table-wrap"><table><caption>${caption}</caption><thead><tr><th scope="col">Subcommittee bill</th><th scope="col">House bill</th><th scope="col">Senate bill</th></tr></thead><tbody>
    ${t.rows.map(r => `<tr><th scope="row">${esc(r.sub)}</th>${stageCell(r.house)}${stageCell(r.senate)}</tr>`).join("")}</tbody></table></div>`;
}
async function viewBudget() {
  const [b, all, feed] = await Promise.all([data("budget.json"), bills(), data("changes.json")]);
  const budgetIds = new Set(all.filter(x => x.topics.includes("b")).map(x => x.id));
  const seen = new Set();
  const recent = feed.filter(e => e.k === "action" && budgetIds.has(e.id) && !seen.has(e.id) && seen.add(e.id)).slice(0, 30);
  page("Budget and appropriations", `
    <h1>Budget and appropriations</h1>
    <p class="lede">Status of the regular appropriations bills, continuing resolutions and combined bills, budget action in Congress, CBO publications and the President's budget documents.</p>
    ${approTable(b.fy2027, "Fiscal year 2027 regular appropriations bills: furthest stage reached")}
    <h2>Continuing resolutions and combined bills, FY 2027</h2>
    <ul class="plain">${b.fy2027.combined.map(c => `<li><a class="item-title" href="#/bill/${c.id}">${esc(c.id.toUpperCase())}</a> ${esc(c.title)} <span class="badge plain">${STAGES[c.stage]}</span>${laLine(c.la.actionDate, c.la.text)}</li>`).join("") || `<li class="muted">None yet.</li>`}</ul>
    <h2>Recent action on budget and appropriations bills</h2>
    <ul class="plain">${recent.map(e => { const r = cache._billIndex.get(e.id); return `<li><a class="item-title" href="#/bill/${e.id}">${esc(r.label)}</a> ${esc(r.title)}${laLine(e.d, e.t)}</li>`; }).join("") || `<li class="muted">No action in the last 45 days.</li>`}</ul>
    <h2>Congressional Budget Office</h2>
    <ul class="plain">${b.cbo.slice(0, 20).map(c => `<li><a class="item-title" href="${esc(c.url)}">${esc(c.title)}</a><div class="meta">${fmtDate(c.date)}</div></li>`).join("")}</ul>
    <h2>President's budget documents, FY 2027</h2>
    <ul class="plain">${b.documents.filter(d => /2027/.test(d.id)).slice(0, 30).map(d => `<li><a href="${esc(d.url)}">${esc(d.title)}</a> <span class="meta">${fmtDate(d.date)}, GovInfo</span></li>`).join("")}</ul>
    <details><summary>Fiscal year 2026 appropriations</summary>${approTable(b.fy2026, "Fiscal year 2026 regular appropriations bills")}
      <ul class="plain">${b.fy2026.combined.map(c => `<li><a class="item-title" href="#/bill/${c.id}">${esc(c.id.toUpperCase())}</a> ${esc(c.title)} <span class="badge plain">${STAGES[c.stage]}</span>${laLine(c.la.actionDate, c.la.text)}</li>`).join("")}</ul></details>`);
}

/* ---------- energy ---------- */
async function viewEnergy(q) {
  const [all, fr] = await Promise.all([bills(), data("fr.json")]);
  const tab = q.get("tab") || "bills";
  const kw = store.get("energyKeywords", "");
  const kwList = kw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const kwHit = s => !kwList.length || kwList.some(k => s.toLowerCase().includes(k));
  const tabs = [["bills", "Legislation"], ["fr", "Federal Register"], ["committees", "Committee activity"]];
  let body = "";
  if (tab === "bills") {
    const list = all.filter(b => (b.topics.includes("e") || b.topics.includes("o")) && kwHit(b.title + " " + b.laText)).sort((a, b) => (q.get("offshore") ? (b.topics.includes("o") - a.topics.includes("o")) : 0) || b.laDate.localeCompare(a.laDate));
    body = `<p>${list.length} energy, minerals and public-lands bills, newest action first. Offshore and minerals items are flagged for MMA.</p>
      <div class="toolbar"><a href="#/energy?tab=bills${q.get("offshore") ? "" : "&offshore=1"}">${q.get("offshore") ? "Sort by date only" : "Put offshore and minerals first"}</a></div>
      <ul class="plain">${list.slice(0, 150).map(b => billItem(b, " " + watchButton(b.id))).join("")}</ul>${list.length > 150 ? `<p><a href="#/search?kind=bills&topic=e&sort=new">All ${list.length} in search</a></p>` : ""}`;
  } else if (tab === "fr") {
    const type = q.get("type") || "", agency = q.get("agency") || "", off = q.get("off") === "1", open = q.get("open") === "1";
    const today = new Date().toISOString().slice(0, 10);
    const agencies = [...new Set(fr.flatMap(d => d.agencies))].sort();
    const list = fr.filter(d => (!type || d.type === type) && (!agency || d.agencies.includes(agency)) && (!off || d.topics.includes("offshore")) && (!open || (d.comments && d.comments >= today)) && kwHit(d.title + " " + d.abstract));
    const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`;
    body = `<form class="filters" id="frf">
        <div class="f"><label for="frtype">Document type</label><select id="frtype" name="type">${opt("", "All", type)}${["Rule", "Proposed Rule", "Notice", "Presidential Document"].map(t => opt(t, t, type)).join("")}</select></div>
        <div class="f"><label for="fragency">Agency</label><select id="fragency" name="agency">${opt("", "All", agency)}${agencies.map(a => opt(a, a, agency)).join("")}</select></div>
        <div class="f"><label class="check"><input type="checkbox" name="off" value="1"${off ? " checked" : ""}> Offshore and minerals only</label></div>
        <div class="f"><label class="check"><input type="checkbox" name="open" value="1"${open ? " checked" : ""}> Comment period open</label></div>
        <div class="f"><button type="submit">Apply</button></div></form>
      <p>${list.length.toLocaleString()} documents in the last 12 months.</p><ul class="plain">${list.slice(0, 100).map(frItem).join("")}</ul>${list.length > 100 ? `<p class="muted">Showing the newest 100. Narrow the filters or use <a href="#/search?kind=fr">search</a>.</p>` : ""}`;
  } else {
    const comms = [["sseg00", "Senate Committee on Energy and Natural Resources"], ["hsii00", "House Committee on Natural Resources"], ["hsif00", "House Committee on Energy and Commerce"], ["sseg00|ssap00|hsap00", "Appropriations committees (energy and minerals bills)"]];
    body = comms.map(([code, name]) => {
      const codes = code.split("|");
      const list = all.filter(b => b.committees.some(c => codes.includes(c)) && (codes.length === 1 || b.topics.includes("e") || b.topics.includes("o")) && kwHit(b.title + " " + b.laText)).sort((a, b) => b.laDate.localeCompare(a.laDate)).slice(0, 12);
      return `<h2>${esc(name)}</h2><ul class="plain">${list.map(b => billItem(b)).join("") || `<li class="muted">No tracked bills.</li>`}</ul><p><a href="#/search?kind=bills&committee=${codes[0]}&sort=new">All bills referred to this committee</a></p>`;
    }).join("");
  }
  page("Energy and minerals", `
    <h1>Energy and minerals</h1>
    <p class="lede">Energy, offshore, minerals and public-lands legislation; rules and notices from Interior, MMA, BOEM, BSEE, BLM, USGS, Energy, FERC, NRC and PHMSA; and the committees that handle them.</p>
    <form class="filters" id="kwf"><div class="f grow"><label for="kw">Narrow with your own keywords (comma separated)</label><input id="kw" type="text" value="${esc(kw)}" placeholder="for example: sand, Gulf, lease sale, royalty"></div><div class="f"><button type="submit">Save keywords</button></div>${kw ? `<div class="f"><button type="button" class="secondary" id="kwclear">Clear</button></div>` : ""}</form>
    <nav aria-label="Energy views"><ul class="toolbar" style="list-style:none;padding:0;">${tabs.map(([k, l]) => `<li><a class="button${k === tab ? "" : " secondary"}" href="#/energy?tab=${k}"${k === tab ? ' aria-current="page"' : ""}>${l}</a></li>`).join("")}</ul></nav>
    ${body}`);
  document.getElementById("kwf").addEventListener("submit", e => { e.preventDefault(); store.set("energyKeywords", document.getElementById("kw").value); viewEnergy(q).then(() => announce("Keywords saved")); });
  const clr = document.getElementById("kwclear");
  if (clr) clr.addEventListener("click", () => { store.set("energyKeywords", ""); viewEnergy(q).then(() => announce("Keywords cleared")); });
  const frf = document.getElementById("frf");
  if (frf) frf.addEventListener("submit", e => { e.preventDefault(); const p = new URLSearchParams({ tab: "fr" }); for (const [k, v] of new FormData(frf)) if (v) p.set(k, v); location.hash = "#/energy?" + p; });
}

/* ---------- votes ---------- */
async function viewVotes(q) {
  const [hv, sv, meta] = await Promise.all([data("votes_house.json"), data("votes_senate.json"), data("meta.json")]);
  const ch = q.get("chamber") || "house";
  page("Roll-call votes", `
    <h1>Roll-call votes</h1>
    <p class="lede">Every recorded vote of the 119th Congress, with each member's position.</p>
    <nav aria-label="Chamber"><ul class="toolbar" style="list-style:none;padding:0;"><li><a class="button${ch === "house" ? "" : " secondary"}" href="#/votes?chamber=house"${ch === "house" ? ' aria-current="page"' : ""}>House (${hv.length})</a></li><li><a class="button${ch === "senate" ? "" : " secondary"}" href="#/votes?chamber=senate"${ch === "senate" ? ' aria-current="page"' : ""}>Senate (${sv.length})</a></li></ul></nav>
    ${ch === "senate" ? `<p class="notice">Senate tallies appear the same day from Congress.gov bill actions. Member-by-member Senate positions come from Voteview (UCLA), which compiles them from the official Senate record; the latest Senate vote with positions on file is dated ${fmtDate(meta.senateVoteviewLatest)}.</p>` : `<p class="small muted">Source: Office of the Clerk, U.S. House of Representatives.</p>`}
    <ul class="plain">${(ch === "house" ? hv.slice(0, 200).map(v => `<li><a class="item-title" href="#/vote/house/${v.key}">Roll ${v.roll} (${v.year}): ${esc(v.question)} ${esc(v.legis)}</a><div>${esc(v.desc)}</div><div class="meta">${fmtDate(houseDate(v.date))}. ${esc(v.result)}, ${v.yea}-${v.nay}${v.present ? `, ${v.present} present` : ""}</div></li>`) : sv.slice(0, 200).map(senateVoteItem)).join("")}</ul>
    <p class="muted">Showing the latest 200. Use <a href="#/search?kind=votes">search</a> for older votes.</p>`);
}
async function viewVote(ch, key) {
  const [list, pos, members] = await Promise.all([data(ch === "house" ? "votes_house.json" : "votes_senate.json"), data("positions.json"), data("members.json")]);
  const v = list.find(x => x.key === key);
  if (!v) return page("Vote", `<h1>Vote not found</h1><p>The vote may not be loaded yet. <a href="#/votes?chamber=${esc(ch)}">All votes</a></p>`);
  const P = pos[ch === "house" ? "House" : "Senate"];
  const str = P.rolls[key];
  const byId = new Map(members.map(m => [m.id, m]));
  const NAMES = { Y: "Yea", N: "Nay", P: "Present", X: "Not voting" };
  let rowsHtml = "";
  if (str) {
    const rows = P.members.map((id, i) => ({ id, p: str[i], m: byId.get(id) })).filter(r => r.p !== "-");
    rows.sort((a, b) => ((a.m && a.m.last) || a.id).localeCompare((b.m && b.m.last) || b.id));
    rowsHtml = `<h2>How each member voted</h2>
      <form class="filters" id="vf"><div class="f"><label for="vfp">Position</label><select id="vfp"><option value="">All</option><option value="Y">Yea</option><option value="N">Nay</option><option value="P">Present</option><option value="X">Not voting</option></select></div>
      <div class="f"><label for="vfparty">Party</label><select id="vfparty"><option value="">All</option><option>Republican</option><option>Democratic</option><option>Independent</option></select></div>
      <div class="f"><label for="vfs">State</label><input id="vfs" type="text" size="4" maxlength="2"></div></form>
      <div class="table-wrap"><table id="vt"><caption>Member positions</caption><thead><tr><th scope="col">Member</th><th scope="col">Party</th><th scope="col">State</th><th scope="col">Vote</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-p="${r.p}" data-party="${esc(r.m ? r.m.party : "")}" data-state="${esc(r.m ? r.m.state : "")}"><td>${r.m ? `<a href="#/member/${r.id}">${esc(r.m.name)}</a>` : esc(r.id)}</td><td>${esc(r.m ? r.m.party : "")}</td><td>${esc(r.m ? r.m.state + (r.m.district ? "-" + r.m.district : "") : "")}</td><td class="pos-${r.p}">${NAMES[r.p] || esc(r.p)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  const date = ch === "house" ? houseDate(v.date) : v.date;
  const official = ch === "house" ? `https://clerk.house.gov/Votes/${v.year}${String(v.roll).padStart(3, "0")}` : v.url;
  const bill = v.bill || (v.legis ? parseBillNumber(v.legis.replace(/^H RES/, "H.Res.").replace(/^H J RES/, "H.J.Res.").replace(/^S J RES/, "S.J.Res.")) : null);
  page(`${ch === "house" ? "House" : "Senate"} vote ${v.clerk_roll || v.roll}`, `
    <p class="meta">${ch === "house" ? "House of Representatives" : "Senate"} · ${fmtDate(date)}${v.time ? " · " + esc(v.time) : ""}</p>
    <h1>${ch === "house" ? "Roll" : "Vote"} ${esc(v.clerk_roll || v.roll)}: ${esc(v.question || "Recorded vote")}${v.legis ? " " + esc(v.legis) : ""}</h1>
    ${v.desc ? `<p class="lede">${esc(v.desc)}</p>` : ""}${v.text ? `<p class="lede">${esc(v.text)}</p>` : ""}
    <dl class="facts"><dt>Result</dt><dd>${esc(v.result || "")} ${v.yea != null ? `${v.yea} yea, ${v.nay} nay${v.present ? `, ${v.present} present` : ""}${v.nv ? `, ${v.nv} not voting` : ""}` : ""}</dd>
      ${bill ? `<dt>Measure</dt><dd><a href="#/bill/${bill}">${esc(bill.toUpperCase())}</a></dd>` : ""}
      ${official ? `<dt>Official record</dt><dd><a href="${esc(official)}">${ch === "house" ? "Office of the Clerk" : "Senate roll call"}</a></dd>` : ""}</dl>
    ${v.party && v.party.length ? `<div class="table-wrap"><table><caption>Totals by party</caption><thead><tr><th scope="col">Party</th><th scope="col" class="num">Yea</th><th scope="col" class="num">Nay</th><th scope="col" class="num">Present</th><th scope="col" class="num">Not voting</th></tr></thead><tbody>${v.party.map(p => `<tr><th scope="row">${esc(p.party)}</th><td class="num">${esc(p.yea)}</td><td class="num">${esc(p.nay)}</td><td class="num">${esc(p.present)}</td><td class="num">${esc(p.nv)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${rowsHtml || (ch === "senate" ? `<p class="notice">Member-by-member positions for this Senate vote are not on file yet. Voteview adds them periodically; the official Senate roll call is linked above.</p>` : "")}`);
  const vf = document.getElementById("vf");
  if (vf) vf.addEventListener("input", () => {
    const p = document.getElementById("vfp").value, party = document.getElementById("vfparty").value, st = document.getElementById("vfs").value.trim().toUpperCase();
    let n = 0;
    document.querySelectorAll("#vt tbody tr").forEach(tr => { const show = (!p || tr.dataset.p === p) && (!party || tr.dataset.party === party) && (!st || tr.dataset.state === st); tr.hidden = !show; if (show) n++; });
    announce(`${n} members shown`);
  });
}

/* ---------- members ---------- */
function memberItem(m) {
  return `<li><a class="item-title" href="#/member/${m.id}">${esc(m.name)}</a> <span class="meta">${esc(m.party)}, ${esc(m.state)}${m.district ? ", district " + m.district : ""} · ${m.chamber}</span>
    <div class="small">${m.committees.filter(c => !c.parent).map(c => esc(c.name.replace(/^(House|Senate) (Committee on )?/, ""))).join("; ")}</div></li>`;
}
async function viewMembers(q) {
  const members = await data("members.json");
  const ch = q.get("chamber") || "", st = (q.get("state") || "").toUpperCase(), party = q.get("party") || "", name = q.get("name") || "";
  const states = [...new Set(members.map(m => m.state))].sort();
  const list = members.filter(m => (!ch || m.chamber === ch) && (!st || m.state === st || m.state.toUpperCase() === st) && (!party || m.party === party) && (!name || m.name.toLowerCase().includes(name.toLowerCase())));
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`;
  page("Members of Congress", `
    <h1>Members of Congress</h1>
    <p class="lede">Profiles of all ${members.length} current members: party, state or district, terms of service, committee and subcommittee assignments, sponsored bills and voting record.</p>
    <form class="filters" id="mf">
      <div class="f grow"><label for="mname">Name</label><input id="mname" name="name" type="search" value="${esc(name)}"></div>
      <div class="f"><label for="mch">Chamber</label><select id="mch" name="chamber">${opt("", "Both", ch)}${opt("House", "House", ch)}${opt("Senate", "Senate", ch)}</select></div>
      <div class="f"><label for="mst">State</label><select id="mst" name="state">${opt("", "All", st)}${states.map(s => opt(s, s, st)).join("")}</select></div>
      <div class="f"><label for="mparty">Party</label><select id="mparty" name="party">${opt("", "All", party)}${["Republican", "Democratic", "Independent"].map(p => opt(p, p, party)).join("")}</select></div>
      <div class="f"><button type="submit">Show</button></div></form>
    <h2>${list.length} member${list.length === 1 ? "" : "s"}</h2>
    <ul class="plain">${list.map(memberItem).join("")}</ul>`);
  document.getElementById("mf").addEventListener("submit", e => { e.preventDefault(); const p = new URLSearchParams(); for (const [k, v] of new FormData(e.target)) if (v) p.set(k, v); location.hash = "#/members?" + p; });
}
async function viewMember(id) {
  const [members, pos, hv, sv] = await Promise.all([data("members.json"), data("positions.json"), data("votes_house.json"), data("votes_senate.json")]);
  const m = members.find(x => x.id === id);
  if (!m) return page("Member", `<h1>Member not found</h1><p><a href="#/members">All members</a></p>`);
  const P = pos[m.chamber];
  const idx = P.members.indexOf(id);
  const vlist = m.chamber === "House" ? hv : sv.filter(v => !v.pending);
  const NAMES = { Y: "Yea", N: "Nay", P: "Present", X: "Not voting" };
  let record = [], missed = 0, cast = 0;
  if (idx >= 0) for (const v of vlist) {
    const s = P.rolls[v.key]; if (!s) continue;
    const p = s[idx]; if (p === "-") continue;
    cast++; if (p === "X") missed++;
    if (record.length < 25) record.push({ v, p });
  }
  const top = m.committees.filter(c => !c.parent), subs = m.committees.filter(c => c.parent);
  page(m.name, `
    <div class="member-head">${m.photo ? `<img src="${esc(m.photo)}" alt="Official portrait of ${esc(m.name)}">` : ""}
      <div><p class="meta">${m.chamber === "Senate" ? `${esc(m.stateRank ? m.stateRank[0].toUpperCase() + m.stateRank.slice(1) + " senator" : "Senator")}` : "Representative"}</p>
      <h1>${esc(m.name)}</h1>
      <p class="lede">${esc(m.party)}, ${esc(m.state)}${m.district ? `, district ${m.district}` : m.chamber === "House" ? ", at large" : ""}${m.leadership.length ? ". " + esc(m.leadership.join("; ")) : ""}</p></div></div>
    <dl class="facts">
      ${m.born ? `<dt>Born</dt><dd>${esc(m.born)}</dd>` : ""}
      <dt>Service</dt><dd>${m.terms.map(t => `${esc(t.ch)} ${esc(t.start)}–${esc(t.end || "present")}`).filter((v, i, a) => a.indexOf(v) === i).slice(-8).join("<br>")}</dd>
      ${m.termEnd ? `<dt>Current term ends</dt><dd>${fmtDate(m.termEnd)}</dd>` : ""}
      ${m.office ? `<dt>Office</dt><dd>${esc(m.office)}${m.phone ? `, ${esc(m.phone)}` : ""}</dd>` : ""}
      ${m.web ? `<dt>Website</dt><dd><a href="${esc(m.web)}">${esc(m.web.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></dd>` : ""}
      <dt>Biography</dt><dd><a href="https://bioguide.congress.gov/search/bio/${esc(m.id)}">Biographical Directory of the U.S. Congress</a></dd>
      <dt>Legislation</dt><dd>${m.sponsoredCount} bills sponsored, ${m.cosponsoredCount} cosponsored, all Congresses</dd>
      ${cast ? `<dt>Votes this Congress</dt><dd>${cast} roll calls, missed ${missed} (${(100 * missed / cast).toFixed(1)}%)</dd>` : ""}
    </dl>
    <h2>Committee assignments</h2>
    ${top.length ? `<ul class="plain">${top.map(c => `<li><strong>${esc(c.name)}</strong>${c.title ? `, ${esc(c.title)}` : ""}${c.rank ? ` <span class="meta">(rank ${c.rank} on the ${c.side === "majority" ? "majority" : "minority"} side)</span>` : ""}
      ${subs.filter(s => s.parent === c.code).length ? `<ul>${subs.filter(s => s.parent === c.code).map(s => `<li>${esc(s.name)}${s.title ? `, ${esc(s.title)}` : ""}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>` : `<p class="muted">No committee assignments on file.</p>`}
    <h2>Recently sponsored, 119th Congress</h2>
    ${m.sponsored.length ? `<ul class="plain">${m.sponsored.map(s => `<li>${s.id ? `<a class="item-title" href="#/bill/${s.id}">${esc(billLabel(s.type, s.number))}</a>` : ""} ${esc(s.title)}${laLine(s.la.actionDate, s.la.text)}</li>`).join("")}</ul>` : `<p class="muted">None on file.</p>`}
    <h2>Recent votes</h2>
    ${record.length ? `<div class="table-wrap"><table><caption>Latest ${record.length} roll-call votes${m.chamber === "Senate" ? " with Senate positions on file (Voteview)" : ""}</caption><thead><tr><th scope="col">Date</th><th scope="col">Vote</th><th scope="col">Result</th><th scope="col">Position</th></tr></thead><tbody>
      ${record.map(({ v, p }) => `<tr><td>${fmtDate(m.chamber === "House" ? houseDate(v.date) : v.date)}</td><td><a href="#/vote/${m.chamber.toLowerCase()}/${v.key}">${esc(v.question)} ${esc(v.legis || "")}</a></td><td>${esc(v.result)}</td><td class="pos-${p}">${NAMES[p]}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No votes on file.</p>`}
    ${m.photoCredit ? `<p class="small muted">Portrait: ${esc(m.photoCredit.replace(/<[^>]+>/g, ""))}</p>` : ""}`);
}

/* ---------- activity and about ---------- */
async function viewActivity(q) {
  const [feed] = await Promise.all([data("changes.json"), bills()]);
  const kind = q.get("k") || "";
  const list = feed.filter(e => !kind || e.k === kind).slice(0, 300);
  page("Activity", `<h1>All activity</h1><p class="lede">Every dated action, vote, Federal Register document and CBO publication from the last 45 days, newest first.</p>
    <nav aria-label="Activity type"><ul class="toolbar" style="list-style:none;padding:0;">${[["", "All"], ["action", "Bill actions"], ["vote", "Votes"], ["fr", "Federal Register"], ["cbo", "CBO"]].map(([k, l]) => `<li><a class="button${k === kind ? "" : " secondary"}" href="#/activity${k ? "?k=" + k : ""}"${k === kind ? ' aria-current="page"' : ""}>${l}</a></li>`).join("")}</ul></nav>
    <ul class="plain">${list.map(e => `<li>${eventLink(e, e.id ? cache._billIndex.get(e.id) : null)}<div>${esc(e.t)}</div><div class="meta">${fmtDate(e.d)}</div></li>`).join("")}</ul>`);
}
async function viewAbout() {
  const meta = await data("meta.json");
  page("About", `
    <h1>About JAYANAS Bill Tracker</h1>
    <p class="lede">A federal budget and legislative information service built on official public sources, with tools to search, follow and compare legislation and to receive alerts and a daily digest.</p>
    <h2>Data on file</h2>
    <dl class="facts"><dt>Last refresh</dt><dd>${esc(meta.built.replace("T", " ").replace("+00:00", " UTC"))}</dd><dt>Bills and resolutions</dt><dd>${meta.bills.toLocaleString()} (119th Congress), ${meta.tracked.toLocaleString()} tracked in full</dd>
      <dt>Roll-call votes</dt><dd>${meta.houseVotes} House, ${meta.senateVotes} Senate</dd><dt>Members</dt><dd>${meta.members}</dd><dt>Federal Register</dt><dd>${meta.fr.toLocaleString()} documents, last 12 months</dd></dl>
    <h2>Sources</h2>
    <div class="table-wrap"><table><caption>Where each kind of information comes from</caption><thead><tr><th scope="col">Information</th><th scope="col">Source</th><th scope="col">Timing</th></tr></thead><tbody>
      <tr><td>Bills, status, actions, amendments, committees, cosponsors, CRS summaries, CBO cost estimates, text versions, members</td><td>Congress.gov API (Library of Congress)</td><td>Daily refresh; Congress.gov usually posts actions the same day</td></tr>
      <tr><td>House roll-call votes, member by member</td><td>Office of the Clerk, U.S. House of Representatives (roll-call XML)</td><td>Daily refresh; the Clerk posts votes the same day</td></tr>
      <tr><td>Senate roll-call results</td><td>Congress.gov bill actions (record vote number and tally)</td><td>Daily refresh</td></tr>
      <tr><td>Senate votes, member by member</td><td>Voteview, University of California, Los Angeles, compiled from the official Senate record</td><td>Periodic; latest on file ${fmtDate(meta.senateVoteviewLatest)}</td></tr>
      <tr><td>Committee and subcommittee assignments, member contact details</td><td>congress-legislators public-domain dataset, compiled from House and Senate rosters</td><td>Daily refresh</td></tr>
      <tr><td>Rules, proposed rules and notices</td><td>Federal Register API (Office of the Federal Register)</td><td>Daily, the morning of publication</td></tr>
      <tr><td>President's budget documents</td><td>GovInfo (Government Publishing Office)</td><td>As published</td></tr>
      <tr><td>CBO publications</td><td>Congressional Budget Office</td><td>Daily refresh</td></tr></tbody></table></div>
    <h2>Limitations</h2>
    <ul><li>JAYANAS Bill Tracker does not publish original news reporting. Coverage is of official actions, documents and votes, with Congressional Research Service summaries and CBO analysis, the same day they are published.</li>
      <li>Bills outside the budget, appropriations and energy topics that have not moved beyond introduction are kept as title and latest action; the full history is one click away on Congress.gov.</li>
      <li>Version comparison is available for tracked bills with two or more published text versions.</li></ul>
    <h2>Accessibility</h2>
    <p>This site is built to Section 508 and WCAG 2.1 level AA: it works with a keyboard alone, has a skip link, labelled form controls, table captions and headers, visible focus, text alternatives for images, color contrast of at least 4.5 to 1, and announcements of search results and changes for screen readers. Bill comparisons mark insertions and deletions in text as well as color. To report a barrier, email <a href="mailto:cnellore@jayanas.com">cnellore@jayanas.com</a>.</p>
    <h2>Network</h2>
    <p>The site is served over HTTPS on both IPv4 and IPv6.</p>
    <h2>Contact</h2>
    <p>JAYANAS LLC, 7852 S 193rd Ave, Gretna, NE 68028. <a href="mailto:cnellore@jayanas.com">cnellore@jayanas.com</a>, (479) 925-8777.</p>`);
}

/* ---------- router ---------- */
async function route() {
  const { parts, q } = parseHash();
  const [r, a, b] = parts;
  setNav(r || "");
  try {
    if (!r) await viewHome();
    else if (r === "search") await viewSearch(q);
    else if (r === "bill") await viewBill(a, q);
    else if (r === "watch") await viewWatch();
    else if (r === "alerts") await viewAlerts();
    else if (r === "digest") await viewDigest(a);
    else if (r === "budget") await viewBudget();
    else if (r === "energy") await viewEnergy(q);
    else if (r === "votes") await viewVotes(q);
    else if (r === "vote") await viewVote(a, b);
    else if (r === "members") await viewMembers(q);
    else if (r === "member") await viewMember(a);
    else if (r === "activity") await viewActivity(q);
    else if (r === "about") await viewAbout();
    else page("Not found", `<h1>Page not found</h1><p><a href="#/">Go to Today</a></p>`);
  } catch (e) {
    console.error(e);
    page("Error", `<h1>Something went wrong</h1><p>The data could not be loaded (${esc(e.message)}). Please reload the page.</p>`);
  }
}
document.getElementById("quickSearch").addEventListener("submit", e => {
  e.preventDefault();
  const v = document.getElementById("q0").value.trim();
  const id = parseBillNumber(v);
  location.hash = id ? `#/bill/${id}` : `#/search?q=${encodeURIComponent(v)}`;
});
window.addEventListener("hashchange", route);
data("meta.json").then(m => { document.getElementById("built").textContent = `Updated ${fmtDate(m.built.slice(0, 10))}.`; }).catch(() => {});
route();
