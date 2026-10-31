import { getAuth, signOut } from "../lib/auth.js";
import { getDoc, addDoc, updateDoc, listDocs, queryEq } from "../lib/firestore.js";
import { assess, classBaseline, personalBaseline, metrics, T } from "../lib/scoring.js";
import { isConfigured } from "../config.js";

const root = document.getElementById("root");
const panel = document.getElementById("panel");
const scrim = document.getElementById("scrim");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDur = (ms) => { if (ms == null || isNaN(ms)) return "—"; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fmtTime = (t) => (t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const initials = (n) => String(n || "?").replace(/,/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const chip = (text, kind) => `<span class="chip ${kind}"><i></i>${esc(text)}</span>`;
const RISK_KIND = { Low: "ok", Medium: "warn", High: "bad" };
const STATUS_KIND = { draft: "mute", active: "ok", ended: "blue" };
const STATUS_LABEL = { draft: "Draft", active: "Active", ended: "Ended" };
const LIVE_STALE_MS = 60000;

const ICON = {
  eye: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#2438c9"/><ellipse cx="16" cy="16" rx="11.8" ry="7" fill="#fff"/><circle cx="16" cy="16" r="4.8" fill="#12172b"/><circle cx="14.5" cy="14.5" r="1.45" fill="#ffd83d"/></svg>`,
  check: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#ddf3ea"/><path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="#0b7a55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cross: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#fbe3e7"/><path d="M6.8 6.8l6.4 6.4M13.2 6.8l-6.4 6.4" stroke="#b3243a" stroke-width="2" stroke-linecap="round"/></svg>`,
  google: `<svg class="gmark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`,
};

let auth, timer = null;
const ui = { tab: "live", fStatus: "all", fRisk: "all", sort: "name", selected: null, ctx: null };
const histCache = {}; // sessionId -> { email -> [history entries] }
let app = null;

/* ================= timeline strip (shared by sample report + detail panel) ================= */
function timeline(a) {
  const start = a.startedAt || 0;
  const end = a.submittedAt || a.lastSeen || start;
  const total = Math.max(1, end - start);
  const pct = (t) => Math.min(100, Math.max(0, ((t - start) / total) * 100));
  const ev = a.events || [];
  const bounds = [start, ...ev.filter((e) => e.type === "page_change").map((e) => e.t).sort((x, y) => x - y), end];
  const pages = bounds.slice(0, -1).map((b, i) => {
    const l = pct(b), w = pct(bounds[i + 1]) - l;
    return `<div class="tl-page" style="left:${l}%;width:${w}%"><span>P${i + 1}</span></div>`;
  }).join("");
  const span = (cls, e, label) => {
    const d = e.durationMs || 0;
    return `<div class="${cls}" style="left:${pct(e.t - d)}%;width:${(d / total) * 100}%" title="${label} ${fmtDur(d)}"></div>`;
  };
  const away = ev.filter((e) => e.type === "tab_hidden").map((e) => span("tl-away", e, "Left the tab")).join("");
  const blur = ev.filter((e) => e.type === "blur").map((e) => span("tl-blur", e, "Window unfocused")).join("");
  const dots = ev.filter((e) => ["copy", "cut", "paste"].includes(e.type))
    .map((e) => `<div class="tl-dot ${e.type === "paste" ? "paste" : ""}" style="left:${pct(e.t)}%" title="${e.type}"></div>`).join("");
  return `<div class="tl"><div class="tl-track">${pages}${blur}${away}${dots}</div>
    <div class="tl-axis"><span>0:00</span><span>${fmtDur(total)}</span></div>
    <div class="tl-legend"><span><i class="k-away"></i>Left the tab</span><span><i class="k-paste"></i>Paste</span><span><i class="k-copy"></i>Copy or cut</span><span><i class="k-page"></i>Page</span></div></div>`;
}

/* ================= shell ================= */
function topbar() {
  return `<header class="topbar"><a class="brand" href="#/">${ICON.eye}<span>quizSEE</span></a>
    <div class="user"><div class="who"><b>${esc(auth.name)}</b><span class="small muted">${esc(auth.email)}</span></div>
    <div class="avatar" aria-hidden="true">${esc(initials(auth.name))}</div>
    <button class="btn ghost" id="so">Sign out</button></div></header>`;
}
function mountShell() {
  root.innerHTML = topbar() + `<main class="page" id="app"></main>`;
  app = document.getElementById("app");
  document.getElementById("so").onclick = async () => { await signOut(); location.hash = ""; location.reload(); };
}

/* ================= landing (signed out) ================= */
const SAMPLE = (() => {
  const m = 60000, s0 = 1700000000000;
  return {
    status: "submitted", startedAt: s0, submittedAt: s0 + 18 * m, tabSwitches: 3, awayMs: 135000, idleMs: 40000, pastes: 0,
    events: [
      { type: "page_change", t: s0 + 6.2 * m }, { type: "page_change", t: s0 + 12.7 * m },
      { type: "tab_hidden", t: s0 + 4.6 * m, durationMs: 50000 }, { type: "tab_hidden", t: s0 + 9.3 * m, durationMs: 45000 },
      { type: "tab_hidden", t: s0 + 15.7 * m, durationMs: 40000 },
      { type: "copy", t: s0 + 2.1 * m }, { type: "copy", t: s0 + 7.4 * m },
    ],
  };
})();

function renderLanding(error) {
  const sample = assess(SAMPLE, null, personalBaseline([]));
  const yes = ["When you start and submit", "Tab switches and how long you were away", "Window focus changes", "Copy, cut, paste and right-click counts, never the contents", "Idle time and the number of answers typed", "Which page you are on, and time per page"];
  const no = ["Your answers", "The text of any question", "Screenshots, webcam or screen recording", "What you do in other tabs, including their titles and links", "Anything outside an active quiz session"];
  const li = (icon, t) => `<li>${icon}<span>${esc(t)}</span></li>`;
  root.innerHTML = `<div class="landing">
    <nav class="nav"><a class="brand" href="#/">${ICON.eye}<span>quizSEE</span></a></nav>
    <section class="hero">
      <div>
        <h1>See how the quiz was taken.</h1>
        <p class="lede">quizSEE tracks tab switches, time away and paste activity during a Google Forms quiz, then gives the professor a clear report. Students are told up front, and answers are never recorded.</p>
        <div class="signin">
          <h2>Choose how you will use quizSEE</h2>
          ${!isConfigured() ? `<div class="notice err">quizSEE isn't configured yet. Fill in config.js using HUMAN_SETUP.md, then reload the extension.</div>` : ""}
          ${error ? `<div class="notice err" role="alert">${esc(error)}</div>` : ""}
          <div class="roles" role="radiogroup" aria-label="Role">
            <label class="role"><input type="radio" name="role" value="student" checked><span class="face"><span><b>Student</b><small>Take a quiz on Google Forms. You can see exactly what is recorded.</small></span></span></label>
            <label class="role"><input type="radio" name="role" value="teacher"><span class="face"><span><b>Professor</b><small>Create sessions and review results. Only approved accounts can sign in as a professor.</small></span></span></label>
          </div>
          <button class="btn block" id="go">${ICON.google}Continue with Google</button>
          <p class="fine">You'll pick your Google account in a separate window.</p>
        </div>
      </div>
      <div class="specimen reveal" aria-label="Sample report">
        <div class="tag"><div class="who"><div class="avatar">MS</div><div><b>Maria Santos</b><span>Midterm quiz, 18:00 minutes</span></div></div>${chip(sample.level + " risk", RISK_KIND[sample.level])}</div>
        ${timeline(SAMPLE)}
        <div class="kpis"><div><b>${sample.focus}</b><span>Focus score</span></div><div><b>${SAMPLE.tabSwitches}</b><span>Tab switches</span></div><div><b>${fmtDur(SAMPLE.awayMs)}</b><span>Time away</span></div></div>
        <p class="small muted">${esc(sample.reasons.join("; "))}.</p>
        <div class="seen">${ICON.eye}<span>This is the notice every student sees on the form: <b>"This quiz is being monitored by quizSEE."</b></span></div>
        <p class="sample" style="margin-top:12px">Sample report with made-up data.</p>
      </div>
    </section>
    <section class="promise">
      <h2>Students know what is recorded, and what is not.</h2>
      <div class="cols">
        <div class="col"><h3>What quizSEE records</h3><ul>${yes.map((t) => li(ICON.check, t)).join("")}</ul></div>
        <div class="col"><h3>What it never records</h3><ul>${no.map((t) => li(ICON.cross, t)).join("")}</ul></div>
      </div>
    </section>
    <p class="foot">Risk levels are indicators for the professor to review, not proof of cheating.</p>
  </div>`;
  const go = document.getElementById("go");
  go.onclick = async () => {
    go.disabled = true; go.lastChild.textContent = "Waiting for Google…";
    const role = document.querySelector('input[name="role"]:checked').value;
    const r = await chrome.runtime.sendMessage({ type: "signIn", role });
    if (r && r.error) renderLanding(r.error); else location.reload();
  };
}

/* ================= student (signed in) ================= */
function renderStudent() {
  const first = String(auth.name).replace(/,/g, " ").trim().split(/\s+/)[0];
  const yes = ["When you start and submit", "Tab switches and time away from the quiz", "Copy, cut, paste and right-click counts", "Idle time, and which page you are on"];
  const no = ["Your answers or the questions", "Screenshots, webcam or screen recording", "What you do in other tabs"];
  const li = (icon, t) => `<li>${icon}<span>${esc(t)}</span></li>`;
  root.innerHTML = topbar() + `<main class="page">
    <div class="pagehead"><div><h1>You're signed in, ${esc(first)}.</h1><p class="muted">Open your quiz in Google Forms and answer as usual.</p></div></div>
    <div class="notice watch" style="max-width:720px;margin-bottom:22px">⚠️ You are being monitored. While you take a quiz on Google Forms, quizSEE records tab switches, time away from the quiz, copy/paste activity, and when you start and submit. It does not record your answers or what you do in other tabs.</div>
    <div class="promise" style="padding:0;margin:0"><div class="cols" style="margin-top:0">
      <div class="col"><h3>Recorded during a quiz</h3><ul>${yes.map((t) => li(ICON.check, t)).join("")}</ul></div>
      <div class="col"><h3>Never recorded</h3><ul>${no.map((t) => li(ICON.cross, t)).join("")}</ul></div>
    </div></div>
    <p class="footnote">Monitoring starts only when your professor has started a session for that exact form. You will see a blue notice at the top of the form.</p>
  </main>`;
  document.getElementById("so").onclick = async () => { await signOut(); location.reload(); };
}

/* ================= routing (professor) ================= */
async function route() {
  clearInterval(timer); timer = null;
  hidePanel(); ui.selected = null;
  const h = location.hash.replace(/^#\/?/, "");
  try {
    if (h === "new") return await viewForm();
    if (h.startsWith("edit/")) return await viewForm(h.slice(5));
    if (h.startsWith("s/")) return await viewSession(h.slice(2));
    return await viewSessions();
  } catch (e) { app.innerHTML = `<div class="notice err">Something went wrong: ${esc(e.message)}</div>`; }
}

/* ---------- sessions list ---------- */
async function viewSessions() {
  app.innerHTML = `<p class="muted">Loading sessions…</p>`;
  const list = (await queryEq("sessions", { teacherUid: auth.uid }, 200)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  app.innerHTML = `<div class="pagehead"><div><h1>Sessions</h1><p class="muted">One session per quiz. Start it when students begin.</p></div><a class="btn" href="#/new">New session</a></div>
    ${list.length ? `<div class="rows">${list.map((s) => `<a class="row" href="#/s/${esc(s.id)}">
        <div><h3>${esc(s.title)}</h3><div class="sub">${(s.roster || []).length} students on the roster</div></div>
        <div class="date small muted">${fmtTime(s.createdAt)}</div>${chip(STATUS_LABEL[s.status] || s.status, STATUS_KIND[s.status] || "mute")}</a>`).join("")}</div>`
      : `<div class="empty"><h2>No sessions yet</h2><p>Create a session for your Google Form, add the class roster, then start it when students begin the quiz.</p><a class="btn" href="#/new">Create your first session</a></div>`}`;
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
  app.innerHTML = `<a class="crumb" href="#/">← Sessions</a>
    <div class="pagehead"><div><h1>${id ? "Edit session" : "New session"}</h1></div></div>
    <div class="formcard"><div id="msg"></div>
      <div class="field"><label for="title">Title</label><input type="text" id="title" value="${esc(s.title)}" placeholder="Midterm quiz 1"></div>
      <div class="field"><label for="url">Google Form link</label><input type="text" id="url" value="${esc(s.formUrl)}" placeholder="https://docs.google.com/forms/d/e/…/viewform">
        <div class="hint">Use the link students open (the responder link), not the editor link.</div></div>
      <div class="field"><label for="roster">Class roster</label><textarea id="roster" rows="9" placeholder="maria@school.edu, Maria Santos">${esc((s.roster || []).map((r) => `${r.email}, ${r.name}`).join("\n"))}</textarea>
        <div class="hint"><span id="count"></span> One student per line as <span class="mono">email, full name</span>.</div></div>
      <div class="actions"><button class="btn" id="save">Save session</button>
        <button class="btn ghost" id="pick" type="button">Import CSV</button><input type="file" id="csv" accept=".csv,.txt" hidden>
        <a class="btn ghost" href="#/">Cancel</a></div></div>`;
  const msg = (t) => (document.getElementById("msg").innerHTML = `<div class="notice err" role="alert" style="margin-bottom:18px">${esc(t)}</div>`);
  const ta = document.getElementById("roster");
  const count = () => (document.getElementById("count").textContent = `${parseRoster(ta.value).length} students found.`);
  ta.oninput = count; count();
  document.getElementById("pick").onclick = () => document.getElementById("csv").click();
  document.getElementById("csv").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + (await f.text()); count();
  };
  document.getElementById("save").onclick = async (e) => {
    const title = document.getElementById("title").value.trim();
    const formUrl = document.getElementById("url").value.trim();
    const roster = parseRoster(ta.value);
    const f = parseFormLink(formUrl);
    if (!title) return msg("Add a title for this session.");
    if (!f) return msg("That link has no form ID. Paste the responder link: https://docs.google.com/forms/d/e/<ID>/viewform");
    if (f.editor && !confirm("This looks like an editor link. Students open the responder link, which has a different ID, so monitoring may not match. Save anyway?")) return;
    e.target.disabled = true;
    try {
      let sid = id;
      if (id) await updateDoc(`sessions/${id}`, { title, formUrl, formId: f.formId, roster });
      else sid = (await addDoc("sessions", { teacherUid: auth.uid, teacherEmail: auth.email, title, formUrl, formId: f.formId, status: "draft", createdAt: Date.now(), roster })).id;
      location.hash = "#/s/" + sid;
    } catch (err) { e.target.disabled = false; msg("Couldn't save the session: " + err.message); }
  };
}

/* ---------- session detail ---------- */
async function viewSession(id) {
  const load = async () => {
    const [session, attempts] = await Promise.all([getDoc(`sessions/${id}`), listDocs(`sessions/${id}/attempts`)]);
    return { session, attempts };
  };
  app.innerHTML = `<p class="muted">Loading session…</p>`;
  let data = await load();
  if (!data.session) { app.innerHTML = `<div class="notice err">Session not found.</div>`; return; }
  if (data.session.status === "ended") ui.tab = "results"; else if (data.session.status === "active" && !ui.tab) ui.tab = "live";
  let last = "";
  const draw = (force) => {
    const sig = JSON.stringify(data);
    if (!force && sig === last && ui.tab !== "live") return;
    last = sig;
    return renderSession(id, data);
  };
  await draw(true);
  timer = setInterval(async () => {
    try { data = await load(); await draw(); } catch (e) { console.warn(e); }
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
  if (!a) return ["Not started yet", "mute"];
  if (a.status === "submitted") return ["Submitted", "ok"];
  if (a.status === "not_submitted") return ["Started – not submitted", "bad"];
  return now - (a.lastSeen || 0) > LIVE_STALE_MS ? ["Possibly disconnected", "warn"] : ["Answering", "blue"];
}
function resultStatus(r) {
  const a = r.attempt;
  if (!a) return ["Absent", "mute"];
  if (a.status === "submitted") return ["Submitted", "ok"];
  return ["Started – not submitted", "bad"];
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

async function renderSession(id, { session, attempts }) {
  const now = Date.now();
  const rows = buildRows(session, attempts);
  const st = session.status;
  const scroll = window.scrollY;
  const head = `<a class="crumb" href="#/">← Sessions</a>
    <div class="pagehead"><div>
      <div class="titleline"><h1>${esc(session.title)}</h1>${chip(STATUS_LABEL[st] || st, STATUS_KIND[st] || "mute")}</div>
      <div class="meta"><span>${(session.roster || []).length} on the roster</span><span>${session.startedAt ? "Started " + fmtTime(session.startedAt) : "Not started"}</span>${session.endedAt ? `<span>Ended ${fmtTime(session.endedAt)}</span>` : ""}<span class="mono small" title="Google Form ID">${esc((session.formId || "").slice(0, 18))}…</span></div>
    </div><div class="actions">
      ${st === "draft" ? `<a class="btn ghost" href="#/edit/${esc(id)}">Edit</a><button class="btn" id="start">Start quiz</button>` : ""}
      ${st === "active" ? `<button class="btn danger" id="end">End quiz</button>` : ""}</div></div>`;

  if (st === "draft") {
    app.innerHTML = head + `<div class="empty"><h2>Ready when you are</h2><p>Students are only monitored after you start the quiz. Start it just before they open the form.</p></div>`;
  } else {
    app.innerHTML = head + `<div class="tabs" role="tablist"><button class="tab" role="tab" data-t="live" aria-selected="${ui.tab === "live"}">Live</button><button class="tab" role="tab" data-t="results" aria-selected="${ui.tab === "results"}">Results</button></div><div id="body"></div>`;
    app.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { ui.tab = t.dataset.t; renderSession(id, { session, attempts }); }));
    const body = document.getElementById("body");
    body.innerHTML = ui.tab === "live" ? liveHtml(rows, now) : await resultsHtml(session, attempts, rows);
    body.querySelectorAll("[data-sel]").forEach((el) => (el.onclick = () => { ui.selected = el.dataset.sel; showPanel(rows); }));
    ["fStatus", "fRisk", "sort"].forEach((k) => { const el = body.querySelector("#" + k); if (el) el.onchange = () => { ui[k] = el.value; renderSession(id, { session, attempts }); }; });
    window.scrollTo(0, scroll);
  }
  if (ui.selected) showPanel(rows);

  const start = document.getElementById("start"), end = document.getElementById("end");
  if (start) start.onclick = async () => {
    start.disabled = true;
    try {
      const clash = (await queryEq("sessions", { formId: session.formId, status: "active" }, 5)).filter((s) => s.id !== id);
      if (clash.length) { alert(`"${clash[0].title}" is already active for this form. End it before starting another.`); start.disabled = false; return; }
      await updateDoc(`sessions/${id}`, { status: "active", startedAt: Date.now() });
      location.reload();
    } catch (e) { alert("Couldn't start the quiz: " + e.message); start.disabled = false; }
  };
  if (end) end.onclick = async () => {
    if (!confirm("End this quiz? Students still answering will be marked as not submitted.")) return;
    end.disabled = true;
    try {
      await updateDoc(`sessions/${id}`, { status: "ended", endedAt: Date.now() }); // end first so students can't overwrite
      for (const a of attempts.filter((x) => x.status === "in_progress")) await updateDoc(`sessions/${id}/attempts/${a.id}`, { status: "not_submitted" });
      ui.tab = "results"; location.reload();
    } catch (e) { alert("Couldn't end the quiz: " + e.message); end.disabled = false; }
  };
}

function personCell(r) {
  return `<div class="person"><div class="avatar" aria-hidden="true">${esc(initials(r.name))}</div><div><b>${esc(r.name)}</b><span>${esc(r.email)}${r.onRoster ? "" : " · not on roster"}</span></div></div>`;
}

function liveHtml(rows, now) {
  const c = { answering: 0, submitted: 0, notStarted: 0, disc: 0 };
  rows.forEach((r) => {
    const [s] = liveStatus(r, now);
    if (s === "Answering") c.answering++; else if (s === "Submitted") c.submitted++;
    else if (s === "Not started yet") c.notStarted++; else if (s === "Possibly disconnected") c.disc++;
  });
  const exp = rows.filter((r) => r.onRoster).length;
  const cell = (n, l, hot) => `<div class="${hot && n ? "hot" : ""}"><b>${n}</b><span>${l}</span></div>`;
  return `<div class="ledger">${cell(exp, "Expected")}${cell(c.answering, "Answering now")}${cell(c.submitted, "Submitted")}${cell(c.notStarted, "Not started yet")}${cell(c.disc, "Possibly disconnected", true)}</div>
    <div class="tablewrap"><table><thead><tr><th>Student</th><th>Status</th><th>Last seen</th><th>Tab switches</th></tr></thead><tbody>
    ${rows.map((r) => { const [s, k] = liveStatus(r, now); const a = r.attempt;
      return `<tr><td>${personCell(r)}</td><td>${chip(s, k)}</td><td class="muted">${a ? Math.max(0, Math.round((now - a.lastSeen) / 1000)) + "s ago" : "—"}</td><td><span class="num">${a ? a.tabSwitches || 0 : "—"}</span></td></tr>`; }).join("")}
    </tbody></table></div><p class="footnote">Updates every 5 seconds.</p>`;
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
  ui.ctx = { cls, out };
  const sub = rows.filter((r) => r.attempt && r.attempt.status === "submitted");
  const notSub = rows.filter((r) => r.attempt && r.attempt.status !== "submitted");
  const absent = rows.filter((r) => !r.attempt);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgTime = avg(sub.map((r) => out.get(r.email).metrics.duration));
  const avgSw = avg(sub.map((r) => r.attempt.tabSwitches || 0));
  const flagged = [...out.values()].filter((o) => o.level !== "Low").length;
  const cell = (n, l, hot) => `<div class="${hot && n ? "hot" : ""}"><b>${n}</b><span>${l}</span></div>`;

  let list = rows.filter((r) => {
    const [s] = resultStatus(r);
    if (ui.fStatus !== "all" && s !== ui.fStatus) return false;
    if (ui.fRisk !== "all") { const o = out.get(r.email); if (!o || o.level !== ui.fRisk) return false; }
    return true;
  });
  const key = { name: (r) => r.name.toLowerCase(), risk: (r) => -(out.get(r.email)?.points ?? -1), focus: (r) => out.get(r.email)?.focus ?? 999, switches: (r) => -(r.attempt?.tabSwitches ?? -1) }[ui.sort];
  list = list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
  const sel = (id, label, opts, cur) => `<label>${label}<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;

  return `<div class="ledger">${cell(sub.length, "Submitted")}${cell(notSub.length, "Started, not submitted")}${cell(absent.length, "Absent")}
    ${cell(fmtDur(avgTime), "Average time taken")}${cell(avgSw == null ? "—" : avgSw.toFixed(1), "Average tab switches")}${cell(flagged, "Flagged for review", true)}</div>
    <div class="notice info">Risk levels are indicators for the professor to review, not proof of cheating.</div>
    <div class="toolbar">
      ${sel("fStatus", "Status", [["all", "All"], ["Submitted", "Submitted"], ["Started – not submitted", "Started, not submitted"], ["Absent", "Absent"]], ui.fStatus)}
      ${sel("fRisk", "Risk", [["all", "All"], ["Low", "Low"], ["Medium", "Medium"], ["High", "High"]], ui.fRisk)}
      ${sel("sort", "Sort by", [["name", "Name"], ["risk", "Risk, highest first"], ["focus", "Focus, lowest first"], ["switches", "Tab switches"]], ui.sort)}</div>
    <div class="tablewrap"><table><thead><tr><th>Student</th><th>Status</th><th>Started</th><th>Submitted</th><th>Time taken</th><th>Tab switches</th><th>Focus</th><th>Integrity</th><th>Baseline</th></tr></thead><tbody>
    ${list.map((r) => { const [s, k] = resultStatus(r); const a = r.attempt, o = out.get(r.email);
      if (!a) return `<tr><td>${personCell(r)}</td><td>${chip(s, k)}</td><td colspan="7" class="soft">No attempt recorded</td></tr>`;
      return `<tr class="click" data-sel="${esc(r.email)}" tabindex="0"><td>${personCell(r)}</td><td>${chip(s, k)}</td><td class="soft">${fmtTime(a.startedAt)}</td><td class="soft">${fmtTime(a.submittedAt)}</td>
      <td><span class="num">${a.status === "submitted" ? fmtDur(o.metrics.duration) : "—"}</span></td>
      <td><span class="num">${a.tabSwitches || 0}</span><div class="soft">${fmtDur(a.awayMs || 0)} away</div></td>
      <td><span class="num">${o.focus}</span><div class="focusbar"><i style="width:${o.focus}%"></i></div></td>
      <td>${chip(o.level + " risk", RISK_KIND[o.level])}<div class="reasons">${esc(o.reasons.slice(0, 3).join("; "))}</div></td><td class="soft">${o.confidence}</td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="footnote">Select a student to see their timeline and how they compare with the class.</p>`;
}

/* ---------- detail drawer ---------- */
function hidePanel() { panel.hidden = true; scrim.hidden = true; panel.classList.remove("open"); }
scrim.onclick = () => { ui.selected = null; hidePanel(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { ui.selected = null; hidePanel(); } if (e.key === "Enter" && e.target.matches && e.target.matches("tr.click")) e.target.click(); });

function showPanel(rows) {
  const r = rows.find((x) => x.email === ui.selected);
  if (!r || !r.attempt || !ui.ctx) { hidePanel(); return; }
  const a = r.attempt, o = ui.ctx.out.get(r.email), cls = ui.ctx.cls, m = o.metrics, pb = o.pb;
  const t0 = a.startedAt || 0;
  const label = { start_or_resume: "Started or resumed", tab_hidden: "Left the tab", blur: "Window lost focus", copy: "Copy", cut: "Cut", paste: "Paste", contextmenu: "Right-click", page_change: "Changed page", submit: "Submitted" };
  const pages = Object.entries(a.pageTimes || {}).sort((x, y) => x[0] - y[0]);
  const maxPage = Math.max(1, ...pages.map(([, ms]) => ms));
  const pct = (v) => Math.round(v * 100) + "%";
  const keep = panel.scrollTop;
  const wasHidden = panel.hidden;
  const [st, sk] = resultStatus(r);
  panel.innerHTML = `<div class="drawerhead"><div class="person">${`<div class="avatar" aria-hidden="true">${esc(initials(r.name))}</div>`}<div><b>${esc(r.name)}</b><span>${esc(r.email)}</span></div></div><button class="btn ghost" id="close">Close</button></div>
    <div class="verdict">${chip(o.level + " risk", RISK_KIND[o.level])}${chip(st, sk)}<span class="soft">Baseline confidence: ${o.confidence}</span></div>
    <div class="sect"><div class="verdict"><div class="big">${o.focus}<small> / 100 focus</small></div></div>
      <h3 style="margin-top:14px">Why this rating</h3><ul class="bullets">${o.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${o.notes.map((n) => `<p class="soft" style="margin-top:8px">${esc(n)}</p>`).join("")}</div>
    <div class="sect"><h3>How the attempt went</h3>${timeline(a)}</div>
    <div class="sect"><h3>Activity</h3><div class="facts">
      <div><b>${a.tabSwitches || 0}</b><span>Tab switches (${fmtDur(a.awayMs || 0)} away, longest ${fmtDur(m.longestAway)})</span></div>
      <div><b>${a.copies || 0} / ${a.cuts || 0} / ${a.pastes || 0}</b><span>Copy / cut / paste</span></div>
      <div><b>${a.blurs || 0}</b><span>Window unfocused (${fmtDur(a.blurMs || 0)})</span></div>
      <div><b>${fmtDur(a.idleMs || 0)}</b><span>Idle (${pct(m.idleRatio)})</span></div>
      <div><b>${a.pageChanges || 0}</b><span>Page changes</span></div>
      <div><b>${a.reopens || 0}</b><span>Times reopened</span></div></div></div>
    <div class="sect"><h3>Time per page</h3>${pages.length ? `<div class="bars">${pages.map(([i, ms]) => `<div class="bar"><span>Page ${+i + 1}</span><i style="width:${(ms / maxPage) * 100}%"></i><span class="mono">${fmtDur(ms)}</span></div>`).join("")}</div>` : `<span class="soft">No page data recorded.</span>`}</div>
    <div class="sect"><h3>Compared with the class</h3><table class="cmp"><thead><tr><th></th><th>This student</th><th>Class median</th></tr></thead><tbody>
      <tr><td>Time taken</td><td>${fmtDur(m.duration)}</td><td>${cls.n ? fmtDur(cls.duration.med) : "—"}</td></tr>
      <tr><td>Switches per 10 min</td><td>${m.switchesPer10Min.toFixed(1)}</td><td>${cls.n ? cls.switchesPer10Min.med.toFixed(1) : "—"}</td></tr>
      <tr><td>Time away</td><td>${pct(m.awayRatio)}</td><td>${cls.n ? pct(cls.awayRatio.med) : "—"}</td></tr></tbody></table>
      <p class="soft" style="margin-top:8px">${cls.n} submission(s) in this class${cls.useZ ? "." : `. Statistical comparison needs ${T.MIN_CLASS_FOR_Z}.`}</p>
      <h3 style="margin-top:16px">Their own history</h3>${pb && pb.n ? `<p>${pb.n} earlier session(s): ${pb.switchesPer10Min.mean.toFixed(1)} switches per 10 min on average, ${pct(pb.awayRatio.mean)} of time away.</p>` : `<p class="soft">No earlier sessions yet.</p>`}</div>
    <div class="sect"><h3>Event log</h3><ul class="events">${(a.events || []).map((e) => `<li><span class="mono">+${fmtDur(e.t - t0)}</span><span>${e.type === "page_change" ? `Moved to page ${e.page + 1}` : esc(label[e.type] || e.type) + (e.durationMs != null ? ` for ${fmtDur(e.durationMs)}` : "") + (e.page != null && e.type !== "submit" ? ` on page ${e.page + 1}` : "")}</span></li>`).join("")}</ul></div>`;
  panel.hidden = false; scrim.hidden = false;
  if (wasHidden) { panel.classList.remove("open"); void panel.offsetWidth; panel.classList.add("open"); }
  panel.scrollTop = keep;
  document.getElementById("close").onclick = () => { ui.selected = null; hidePanel(); };
}

/* ================= boot ================= */
(async () => {
  auth = await getAuth();
  if (!auth) return renderLanding();
  if (auth.role !== "teacher") return renderStudent();
  mountShell();
  window.addEventListener("hashchange", route);
  route();
})();
