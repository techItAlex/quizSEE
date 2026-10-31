import { getAuth } from "../lib/auth.js";
import { isConfigured } from "../config.js";

const root = document.getElementById("root");
const msg = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initials = (n) => String(n).replace(/,/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const openPage = () => { chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") }); window.close(); };

async function render() {
  const a = await getAuth();
  if (!isConfigured()) {
    root.innerHTML = `<div class="notice err">quizSEE isn't configured yet. Fill in config.js (see HUMAN_SETUP.md), then reload the extension.</div>`;
    return;
  }
  if (!a) {
    root.innerHTML = `<h2>See how the quiz was taken</h2>
      <p class="muted small">Sign in as a student or a professor to get started.</p>
      <div class="stack"><button class="btn block" id="open">Open sign-in page</button></div>`;
    document.getElementById("open").onclick = openPage;
    return;
  }
  const isT = a.role === "teacher";
  root.innerHTML = `<div class="me"><div class="avatar" aria-hidden="true">${esc(initials(a.name))}</div>
      <div><b>${esc(a.name)}</b><span class="small muted">${esc(a.email)}</span></div></div>
    <span class="chip blue"><i></i>${isT ? "Professor" : "Student"}</span>
    ${isT ? "" : `<div class="notice watch" style="margin-top:14px">⚠️ You are being monitored. While you take a quiz on Google Forms, quizSEE records tab switches, time away from the quiz, copy/paste activity, and when you start and submit. It does not record your answers or what you do in other tabs.</div>`}
    <div class="stack">
      ${isT ? `<button class="btn block" id="dash">Open dashboard</button>` : ""}
      <button class="btn ghost block" id="out">Sign out</button></div>`;
  const d = document.getElementById("dash");
  if (d) d.onclick = openPage;
  document.getElementById("out").onclick = async () => { await msg({ type: "signOut" }); render(); };
}
render();
