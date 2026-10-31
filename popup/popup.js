import { getAuth } from "../lib/auth.js";
import { isConfigured } from "../config.js";

const root = document.getElementById("root");
const msg = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function render(error) {
  const a = await getAuth();
  const err = error ? `<div class="err">${esc(error)}</div>` : "";
  if (!isConfigured()) {
    root.innerHTML = `<div class="err">quizSEE is not configured yet. Fill in config.js (see HUMAN_SETUP.md), then reload the extension.</div>`;
    return;
  }
  if (!a) {
    root.innerHTML = `${err}
      <p>Sign in with Google and choose how you will use quizSEE.</p>
      <label><input type="radio" name="role" value="student" checked> Student</label>
      <label><input type="radio" name="role" value="teacher"> Professor</label>
      <button id="signin">Sign in with Google</button>`;
    document.getElementById("signin").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Signing in…";
      const role = document.querySelector('input[name="role"]:checked').value;
      const r = await msg({ type: "signIn", role });
      render(r && r.error);
    };
    return;
  }
  const isT = a.role === "teacher";
  root.innerHTML = `${err}
    <div><strong>${esc(a.name)}</strong><br><span class="muted">${esc(a.email)}</span><br>Role: <strong>${isT ? "Professor" : "Student"}</strong></div>
    ${isT
      ? `<button id="dash">Open Dashboard</button>`
      : `<div class="warn">⚠️ You are being monitored. While you take a quiz on Google Forms, quizSEE records tab switches, time away from the quiz, copy/paste activity, and when you start and submit. It does not record your answers or what you do in other tabs.</div>`}
    <button id="out" class="secondary">Sign out</button>`;
  const d = document.getElementById("dash");
  if (d) d.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
  document.getElementById("out").onclick = async () => { await msg({ type: "signOut" }); render(); };
}
render();
