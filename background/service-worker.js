// Owns auth tokens and all student-side Firestore writes. Queue lives in chrome.storage.local
// so it survives service-worker restarts and offline periods.
import { getAuth, signIn, signOut } from "../lib/auth.js";
import { getDoc, setDoc, queryEq, FsError } from "../lib/firestore.js";

const PENDING = "pending"; // { [sessionId]: attempt }

chrome.alarms.create("flush", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "flush") flush().catch(() => {}); });

const blankAttempt = () => ({
  status: "in_progress", reopens: 0, tabSwitches: 0, awayMs: 0, blurs: 0, blurMs: 0,
  copies: 0, pastes: 0, cuts: 0, rightClicks: 0, idleMs: 0, inputEvents: 0,
  pageChanges: 0, pageTimes: {}, events: [],
});

let flushing = null;
function flush() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

// Returns true if the server rejected writes for a session (ended / no permission).
async function doFlush() {
  const a = await getAuth();
  const pending = (await chrome.storage.local.get(PENDING))[PENDING] || {};
  if (!a) return false;
  let stopped = false;
  for (const [sid, att] of Object.entries(pending)) {
    try {
      await setDoc(`sessions/${sid}/attempts/${a.uid}`, att);
      const now = (await chrome.storage.local.get(PENDING))[PENDING] || {};
      if (now[sid] === undefined || JSON.stringify(now[sid]) === JSON.stringify(att)) delete now[sid];
      await chrome.storage.local.set({ [PENDING]: now });
    } catch (e) {
      if (e instanceof FsError && (e.status === 403 || e.status === 404)) {
        const now = (await chrome.storage.local.get(PENDING))[PENDING] || {};
        delete now[sid];
        await chrome.storage.local.set({ [PENDING]: now });
        stopped = true;
      } // otherwise (offline etc.) keep queued and retry on next alarm
    }
  }
  return stopped;
}

async function handleInit({ formId, confirmation }) {
  const a = await getAuth();
  if (!a || a.role !== "student") return { active: false };
  await flush().catch(() => {});
  const [s] = await queryEq("sessions", { formId, status: "active" }, 1);
  if (!s) return { active: false };
  const path = `sessions/${s.id}/attempts/${a.uid}`;
  const now = Date.now();
  let att = await getDoc(path);
  if (!att) {
    const email = a.email.toLowerCase();
    att = {
      ...blankAttempt(), studentEmail: email, studentName: a.name,
      onRoster: (s.roster || []).some((r) => String(r.email).toLowerCase() === email),
      startedAt: now, lastSeen: now,
    };
    await setDoc(path, att);
  } else if (att.status !== "in_progress") {
    return { active: true, finished: true };
  } else if (!confirmation) {
    att.reopens = (att.reopens || 0) + 1;
    att.lastSeen = now;
    await setDoc(path, att);
  }
  delete att.id;
  return { active: true, sessionId: s.id, title: s.title, attempt: att };
}

async function handleMessage(m) {
  switch (m.type) {
    case "signIn": {
      try {
        const a = await signIn(m.role);
        try {
          await setDoc(`users/${a.uid}`, { email: a.email, name: a.name, role: m.role, lastLoginAt: Date.now() });
        } catch (e) {
          await signOut();
          throw new Error(m.role === "teacher" ? "This account is not allowed as a professor." : "Could not save your profile: " + e.message);
        }
        return { ok: true };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    }
    case "signOut":
      await signOut();
      return { ok: true };
    case "init":
      return handleInit(m);
    case "update": {
      const pending = (await chrome.storage.local.get(PENDING))[PENDING] || {};
      pending[m.sessionId] = m.attempt;
      await chrome.storage.local.set({ [PENDING]: pending });
      const stop = await flush();
      return { ok: true, stop };
    }
  }
  return { error: "unknown message" };
}

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  handleMessage(m).then(send, (e) => send({ error: String(e && e.message || e) }));
  return true;
});
