import { getAuth, signOut } from "../lib/auth.js";
import { getDoc, addDoc, updateDoc, listDocs, queryEq } from "../lib/firestore.js";
import { assess, classBaseline, personalBaseline, metrics, median, T } from "../lib/scoring.js";

const app = document.getElementById("app");
const panel = document.getElementById("panel");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDur = (ms) => { if (ms == null || isNaN(ms)) return "—"; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fmtTime = (t) => (t ? new Date(t).toLocaleString() : "—");
const chip = (text, color) => `<span class="chip ${color}">${esc(text)}</span>`;
const RISK_COLOR = { Low: "green", Medium: "yellow", High: "red" };
const LIVE_STALE_MS = 60000;

let auth, timer = null;
const ui = { tab: "live", fStatus: "all", fRisk: "all", sort: "name", selected: null };
const histCache = {}; // sessionId -> { email -> [history entries] }

/* ---------- routing ---------- */
async function route() {
  clearInterval(timer); timer = null;
  panel.hidden = true; ui.selected = null;
  const h = location.hash.replace(/^#\/?/, "");
  try {
    if (h === "new") return viewForm();
    if (h.startsWith("edit/")) return viewForm(h.slice(5));
    if (h.startsWith("s/")) return viewSession(h.slice(2));
    return viewSessions();
  } catch (e) { app.innerHTML = `<div class="err">Error: ${esc(e.message)}</div>`; }
}

/* ---------- sessions list ---------- */
async function viewSessions() {
  app.innerHTML = "Loading…";
  const list = (await queryEq("sessions", { teacherUid: auth.uid }, 200)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const statusChip = (s) => chip(s, s === "active" ? "green" : s === "draft" ? "gray" : "yellow");
  app.innerHTML = `<div class="bar"><h2 class="grow">Sessions</h2><a class="btn" href="#/new">New Session</a></div>
    ${list.length ? `<div class="table-wrap"><table><tr><th>Title</th><th>Form</th><th>Status</th><th>Created</th></tr>
    ${list.map((s) => `<tr class="click" data-id="${esc(s.id)}"><td>${esc(s.title)}</td><td class="mut">${esc((s.formId || "").slice(0, 14))}…</td><td>${statusChip(s.status)}</td><td>${fmtTime(s.createdAt)}</td></tr>`).join("")}
    </table></div>` : `<p>No sessions yet. Click <b>New Session</b>.</p>`}`;
  app.querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => (location.hash = "#/s/" + tr.dataset.id)));
}

/* ---------- new / edit session ---------- */
export function parseFormLink(url) {
  const m = String(url).match(/\/forms\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]+)/);
  return m ? { formId: m[2], editor: !m[1] && /\/edit/.test(url) } : null;
}
export function parseRoster(text) {
  const out = [], seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(",");
    const email = (i < 0 ? line : line.slice(0, i)).trim().replace(/^"|"$/g, "").toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: (i < 0 ? "" : line.slice(i + 1)).trim().replace(/^"|"$/g, "") || email });
  }
  return out;
}

async function viewForm(id) {
  let s = { title: "", formUrl: "", roster: [] };
  if (id) {
    s = await getDoc(`sessions/${id}`);
    if (!s || s.status !== "draft") { location.hash = "#/s/" + id; return; }
  }
  app.innerHTML = `<h2>${id ? "Edit" : "New"} Session</h2><div id="msg"></div>
    <label>Title</label><input type="text" id="title" value="${esc(s.title)}" placeholder="e.g. Midterm Quiz 1">
    <label>Google Form link (viewer link)</label><input type="text" id="url" value="${esc(s.formUrl)}" placeholder="https://docs.google.com/forms/d/e/…/viewform">
    <label>Roster — one student per line: <code>email, full name</code></label>
    <textarea id="roster" rows="8">${esc((s.roster || []).map((r) => `${r.email}, ${r.name}`).join("\n"))}</textarea>
    <div class="bar"><input type="file" id="csv" accept=".csv,.txt"><span class="mut">Optional CSV import (email,name per row)</span></div>
    <div class="bar"><button id="save">Save</button><a class="btn sec" href="#/">Cancel</a></div>`;
  const msg = (t) => (document.getElementById("msg").innerHTML = `<div class="err">${esc(t)}</div>`);
  document.getElementById("csv").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const ta = document.getElementById("roster");
    ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + (await f.text());
  };
  document.getElementById("save").onclick = async (e) => {
    const title = document.getElementById("title").value.trim();
    const formUrl = document.getElementById("url").value.trim();
    const roster = parseRoster(document.getElementById("roster").value);
    const f = parseFormLink(formUrl);
    if (!title) return msg("Please enter a title.");
    if (!f) return msg("Could not find a form ID in that link. Use the viewer link: https://docs.google.com/forms/d/e/<ID>/viewform");
    if (f.editor && !confirm("This looks like an editor link. Students open the viewer link, whose ID is different, so monitoring may not match. Save anyway?")) return;
    e.target.disabled = true;
    try {
      let sid = id;
      if (id) await updateDoc(`sessions/${id}`, { title, formUrl, formId: f.formId, roster });
      else sid = (await addDoc("sessions", { teacherUid: auth.uid, teacherEmail: auth.email, title, formUrl, formId: f.formId, status: "draft", createdAt: Date.now(), roster })).id;
      location.hash = "#/s/" + sid;
    } catch (err) { e.target.disabled = false; msg("Save failed: " + err.message); }
  };
}

/* ---------- session detail ---------- */
async function viewSession(id) {
  const load = async () => {
    const [session, attempts] = await Promise.all([getDoc(`sessions/${id}`), listDocs(`sessions/${id}/attempts`)]);
    return { session, attempts };
  };
  let data = await load();
  if (!data.session) { app.innerHTML = `<div class="err">Session not found.</div>`; return; }
  if (data.session.status === "ended") ui.tab = "results"; else if (data.session.status === "active") ui.tab = ui.tab || "live";

  const draw = () => renderSession(id, data, async () => { data = await load(); draw(); });
  draw();
  timer = setInterval(async () => {
    try { data = await load(); draw(); } catch (e) { console.warn(e); }
  }, 5000);
}

// One row per roster student, plus anyone attending who is not on the roster.
function buildRows(session, attempts) {
  const byEmail = new Map(attempts.map((a) => [String(a.studentEmail).toLowerCase(), a]));
  const rows = (session.roster || []).map((r) => ({ email: r.email, name: r.name, attempt: byEmail.get(r.email) || null, onRoster: true }));
  const rostered = new Set(rows.map((r) => r.email));
  attempts.filter((a) => !rostered.has(String(a.studentEmail).toLowerCase()))
    .forEach((a) => rows.push({ email: a.studentEmail, name: a.studentName || a.studentEmail, attempt: a, onRoster: false }));
  return rows;
}

function liveStatus(r, now) {
  const a = r.attempt;
  if (!a) return ["Not started yet", "gray"];
  if (a.status === "submitted") return ["Submitted", "green"];
  if (a.status === "not_submitted") return ["Started – not submitted", "red"];
  return now - (a.lastSeen || 0) > LIVE_STALE_MS ? ["Possibly disconnected", "yellow"] : ["Answering", "green"];
}
function resultStatus(r) {
  const a = r.attempt;
  if (!a) return ["Absent", "gray"];
  if (a.status === "submitted") return ["Submitted", "green"];
  return ["Started – not submitted", "red"];
}

async function getHistory(session) {
  if (histCache[session.id]) return histCache[session.id];
  const map = {};
  try {
    const all = (await queryEq("sessions", { teacherUid: auth.uid, status: "ended" }, 100))
      .filter((s) => s.id !== session.id).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, 15);
    for (const s of all) {
      const atts = await listDocs(`sessions/${s.id}/attempts`);
      const cls = classBaseline(atts);
      for (const a of atts.filter((x) => x.status === "submitted")) {
        const m = metrics(a);
        (map[String(a.studentEmail).toLowerCase()] ||= []).push({
          switchesPer10Min: m.switchesPer10Min, awayRatio: m.awayRatio,
          durRatio: cls.duration.med > 0 ? m.duration / cls.duration.med : 1,
        });
      }
    }
  } catch (e) { console.warn("history failed", e); }
  return (histCache[session.id] = map);
}

async function renderSession(id, { session, attempts }, refresh) {
  const now = Date.now();
  const rows = buildRows(session, attempts);
  const st = session.status;
  const head = `<div class="bar"><a href="#/">← Sessions</a></div>
    <div class="bar"><h2 class="grow">${esc(session.title)} ${chip(st, st === "active" ? "green" : st === "draft" ? "gray" : "yellow")}</h2>
    ${st === "draft" ? `<a class="btn sec" href="#/edit/${esc(id)}">Edit</a><button id="start">Start Quiz</button>` : ""}
    ${st === "active" ? `<button id="end" class="danger">End Quiz</button>` : ""}</div>
    <div class="mut">Form ID: ${esc(session.formId)} · Roster: ${(session.roster || []).length}</div>`;
  if (st === "draft") {
    app.innerHTML = head + `<p>This session is a draft. Click <b>Start Quiz</b> when students should begin.</p>`;
  } else {
    app.innerHTML = head + `<div class="tabs"><div class="tab ${ui.tab === "live" ? "on" : ""}" data-t="live">Live</div><div class="tab ${ui.tab === "results" ? "on" : ""}" data-t="results">Results</div></div><div id="body"></div>`;
    app.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { ui.tab = t.dataset.t; renderSession(id, { session, attempts }, refresh); }));
    const body = document.getElementById("body");
    if (ui.tab === "live") body.innerHTML = liveHtml(rows, now);
    else body.innerHTML = await resultsHtml(session, attempts, rows);
    body.querySelectorAll("[data-sel]").forEach((el) => (el.onclick = () => { ui.selected = el.dataset.sel; showPanel(session, attempts, rows); }));
    ["fStatus", "fRisk", "sort"].forEach((k) => { const el = body.querySelector("#" + k); if (el) el.onchange = () => { ui[k] = el.value; renderSession(id, { session, attempts }, refresh); }; });
  }
  if (ui.selected) showPanel(session, attempts, rows);

  const start = document.getElementById("start"), end = document.getElementById("end");
  if (start) start.onclick = async () => {
    start.disabled = true;
    try {
      const clash = (await queryEq("sessions", { formId: session.formId, status: "active" }, 5)).filter((s) => s.id !== id);
      if (clash.length) { alert(`Another session ("${clash[0].title}") is already active for this form. End it first.`); start.disabled = false; return; }
      await updateDoc(`sessions/${id}`, { status: "active", startedAt: Date.now() });
      location.reload();
    } catch (e) { alert("Could not start: " + e.message); start.disabled = false; }
  };
  if (end) end.onclick = async () => {
    if (!confirm("End this quiz? Students still answering will be marked 'not submitted'.")) return;
    end.disabled = true;
    try {
      await updateDoc(`sessions/${id}`, { status: "ended", endedAt: Date.now() }); // end first so students can't overwrite
      for (const a of attempts.filter((x) => x.status === "in_progress")) await updateDoc(`sessions/${id}/attempts/${a.id}`, { status: "not_submitted" });
      ui.tab = "results"; location.reload();
    } catch (e) { alert("Could not end: " + e.message); end.disabled = false; }
  };
}

function liveHtml(rows, now) {
  const c = { answering: 0, submitted: 0, notStarted: 0, disc: 0 };
  rows.forEach((r) => {
    const [s] = liveStatus(r, now);
    if (s === "Answering") c.answering++; else if (s === "Submitted") c.submitted++;
    else if (s === "Not started yet") c.notStarted++; else if (s === "Possibly disconnected") c.disc++;
  });
  const exp = rows.filter((r) => r.onRoster).length;
  const card = (n, l) => `<div class="card"><b>${n}</b><span>${l}</span></div>`;
  return `<div class="cards">${card(exp, "Expected")}${card(c.answering, "Answering now")}${card(c.submitted, "Submitted")}${card(c.notStarted, "Not started yet")}${card(c.disc, "Possibly disconnected")}</div>
    <div class="table-wrap"><table><tr><th>Student</th><th>Status</th><th>Last seen</th><th>Tab switches</th></tr>
    ${rows.map((r) => { const [s, col] = liveStatus(r, now); const a = r.attempt;
      return `<tr><td>${esc(r.name)}<div class="mut">${esc(r.email)}${r.onRoster ? "" : " · not on roster"}</div></td><td>${chip(s, col)}</td>
      <td>${a ? Math.max(0, Math.round((now - a.lastSeen) / 1000)) + "s ago" : "—"}</td><td>${a ? a.tabSwitches || 0 : "—"}</td></tr>`; }).join("")}
    </table></div><p class="mut">Refreshes every 5 seconds.</p>`;
}

async function computeAll(session, attempts, rows) {
  const hist = await getHistory(session);
  const cls = classBaseline(attempts);
  const out = new Map();
  for (const r of rows) {
    if (!r.attempt) continue;
    const pb = personalBaseline(hist[String(r.email).toLowerCase()] || []);
    out.set(r.email, { ...assess(r.attempt, cls, pb), pb });
  }
  return { cls, out };
}

async function resultsHtml(session, attempts, rows) {
  const { cls, out } = await computeAll(session, attempts, rows);
  ui._ctx = { cls, out };
  const sub = rows.filter((r) => r.attempt && r.attempt.status === "submitted");
  const notSub = rows.filter((r) => r.attempt && r.attempt.status !== "submitted");
  const absent = rows.filter((r) => !r.attempt);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgTime = avg(sub.map((r) => out.get(r.email).metrics.duration));
  const avgSw = avg(sub.map((r) => r.attempt.tabSwitches || 0));
  const flagged = [...out.values()].filter((o) => o.level !== "Low").length;
  const card = (n, l) => `<div class="card"><b>${n}</b><span>${l}</span></div>`;

  let list = rows.filter((r) => {
    const [s] = resultStatus(r);
    if (ui.fStatus !== "all" && s !== ui.fStatus) return false;
    if (ui.fRisk !== "all") { const o = out.get(r.email); if (!o || o.level !== ui.fRisk) return false; }
    return true;
  });
  const key = { name: (r) => r.name.toLowerCase(), risk: (r) => -(out.get(r.email)?.points ?? -1), focus: (r) => out.get(r.email)?.focus ?? 999, switches: (r) => -(r.attempt?.tabSwitches ?? -1) }[ui.sort];
  list = list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;

  return `<div class="note">Risk levels are indicators for the professor to review, not proof of cheating.</div>
    <div class="cards">${card(sub.length, "Submitted")}${card(notSub.length, "Not submitted (started)")}${card(absent.length, "Absent")}
    ${card(fmtDur(avgTime), "Avg time taken")}${card(avgSw == null ? "—" : avgSw.toFixed(1), "Avg tab switches")}${card(flagged, "Flagged for review")}</div>
    <div class="bar">Status ${sel("fStatus", [["all", "All"], ["Submitted", "Submitted"], ["Started – not submitted", "Started – not submitted"], ["Absent", "Absent"]], ui.fStatus)}
    Risk ${sel("fRisk", [["all", "All"], ["Low", "Low"], ["Medium", "Medium"], ["High", "High"]], ui.fRisk)}
    Sort ${sel("sort", [["name", "Name"], ["risk", "Risk (high first)"], ["focus", "Focus (low first)"], ["switches", "Tab switches"]], ui.sort)}</div>
    <div class="table-wrap"><table><tr><th>Student</th><th>Status</th><th>Started</th><th>Submitted</th><th>Time taken</th><th>Tab switches</th><th>Focus</th><th>Integrity</th><th>Baseline</th></tr>
    ${list.map((r) => { const [s, col] = resultStatus(r); const a = r.attempt, o = out.get(r.email);
      if (!a) return `<tr><td>${esc(r.name)}<div class="mut">${esc(r.email)}</div></td><td>${chip(s, col)}</td><td colspan="6" class="mut">No attempt recorded</td></tr>`;
      return `<tr class="click" data-sel="${esc(r.email)}"><td>${esc(r.name)}<div class="mut">${esc(r.email)}${r.onRoster ? "" : " · not on roster"}</div></td>
      <td>${chip(s, col)}</td><td>${fmtTime(a.startedAt)}</td><td>${fmtTime(a.submittedAt)}</td>
      <td>${a.status === "submitted" ? fmtDur(o.metrics.duration) : "—"}</td>
      <td>${a.tabSwitches || 0}<div class="mut">${fmtDur(a.awayMs || 0)} away</div></td><td>${o.focus}</td>
      <td>${chip(o.level + " risk", RISK_COLOR[o.level])}<div class="mut">${esc(o.reasons.slice(0, 3).join("; "))}</div></td><td>${o.confidence}</td></tr>`; }).join("")}
    </table></div>`;
}

function showPanel(session, attempts, rows) {
  const r = rows.find((x) => x.email === ui.selected);
  if (!r || !r.attempt || !ui._ctx) { panel.hidden = true; return; }
  const a = r.attempt, o = ui._ctx.out.get(r.email), cls = ui._ctx.cls, m = o.metrics, pb = o.pb;
  const t0 = a.startedAt || 0;
  const label = { start_or_resume: "Started / resumed", tab_hidden: "Left the tab", blur: "Window lost focus", copy: "Copy", cut: "Cut", paste: "Paste", contextmenu: "Right-click", page_change: "Changed page", submit: "Submitted" };
  const pages = Object.entries(a.pageTimes || {}).sort((x, y) => x[0] - y[0]);
  const pct = (v) => Math.round(v * 100) + "%";
  panel.hidden = false;
  panel.innerHTML = `<div class="bar"><h3 class="grow" style="margin:0">${esc(r.name)}</h3><button class="sec" id="close">Close</button></div>
    <div class="mut">${esc(r.email)}</div>
    <p>${chip(o.level + " risk", RISK_COLOR[o.level])} Focus <b>${o.focus}</b>/100 · Baseline confidence ${o.confidence}</p>
    <h3>Reasons</h3><ul>${o.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${o.notes.map((n) => `<div class="mut">${esc(n)}</div>`).join("")}
    <h3>Counts</h3><table>
      <tr><td>Tab switches</td><td>${a.tabSwitches || 0} (${fmtDur(a.awayMs || 0)} away, longest ${fmtDur(m.longestAway)})</td></tr>
      <tr><td>Window blurs</td><td>${a.blurs || 0} (${fmtDur(a.blurMs || 0)})</td></tr>
      <tr><td>Copy / cut / paste</td><td>${a.copies || 0} / ${a.cuts || 0} / ${a.pastes || 0}</td></tr>
      <tr><td>Right-clicks</td><td>${a.rightClicks || 0}</td></tr>
      <tr><td>Idle time</td><td>${fmtDur(a.idleMs || 0)} (${pct(m.idleRatio)})</td></tr>
      <tr><td>Answer activity events</td><td>${a.inputEvents || 0}</td></tr>
      <tr><td>Page changes</td><td>${a.pageChanges || 0}</td></tr>
      <tr><td>Times reopened</td><td>${a.reopens || 0}</td></tr></table>
    <h3>Time per page</h3>${pages.length ? `<table>${pages.map(([i, ms]) => `<tr><td>Page ${+i + 1}</td><td>${fmtDur(ms)}</td></tr>`).join("")}</table>` : `<span class="mut">No page data.</span>`}
    <h3>Compared with class</h3><table><tr><th></th><th>This student</th><th>Class median</th></tr>
      <tr><td>Time taken</td><td>${fmtDur(m.duration)}</td><td>${cls.n ? fmtDur(cls.duration.med) : "—"}</td></tr>
      <tr><td>Switches / 10 min</td><td>${m.switchesPer10Min.toFixed(1)}</td><td>${cls.n ? cls.switchesPer10Min.med.toFixed(1) : "—"}</td></tr>
      <tr><td>Time away</td><td>${pct(m.awayRatio)}</td><td>${cls.n ? pct(cls.awayRatio.med) : "—"}</td></tr></table>
    <div class="mut">Class baseline: ${cls.n} submission(s)${cls.useZ ? "" : ` (needs ${T.MIN_CLASS_FOR_Z} for statistical comparison)`}.</div>
    <h3>Own history</h3>${pb && pb.n ? `<div>${pb.n} earlier session(s): avg ${pb.switchesPer10Min.mean.toFixed(1)} switches/10 min, ${pct(pb.awayRatio.mean)} away.</div>` : `<span class="mut">No history yet.</span>`}
    <h3>Timeline</h3><table>${(a.events || []).map((e) => `<tr><td>+${fmtDur(e.t - t0)}</td><td>${esc(label[e.type] || e.type)}${e.durationMs != null ? ` (${fmtDur(e.durationMs)})` : ""}${e.page != null ? ` · page ${e.page + 1}` : ""}</td></tr>`).join("")}</table>`;
  document.getElementById("close").onclick = () => { ui.selected = null; panel.hidden = true; };
}

/* ---------- boot ---------- */
(async () => {
  auth = await getAuth();
  const who = document.getElementById("who");
  if (!auth || auth.role !== "teacher") {
    app.innerHTML = `<div class="err">You are not signed in as a Professor. Click the quizSEE toolbar icon, choose <b>Professor</b>, and sign in; then reload this page.</div>`;
    return;
  }
  who.innerHTML = `${esc(auth.email)} · <a href="#" id="so">Sign out</a>`;
  document.getElementById("so").onclick = async (e) => { e.preventDefault(); await signOut(); location.reload(); };
  window.addEventListener("hashchange", route);
  route();
})();
