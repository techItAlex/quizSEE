// Runs on Google Forms. Records behavior counters only: never answers, question text or other tabs.
// Everything is wrapped so a failure here can never break the student's quiz.
(() => {
  const QS = globalThis.QS;
  if (!QS || window.top !== window) return;

  const HEARTBEAT_MS = 15000, IDLE_MS = 60000, TICK_MS = 5000, MAX_EVENTS = 300;
  const send = (m) => new Promise((res) => {
    try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r); }); } catch { res(null); }
  });
  const guard = (fn) => (...a) => { try { return fn(...a); } catch (e) { console.debug("[quizSEE]", e); } };

  async function main() {
    const info = QS.parseFormUrl(location.href);
    if (!info) return;
    const confirmation = QS.isConfirmationPage();
    const res = await send({ type: "init", formId: info.formId, confirmation });
    if (!res || !res.active || res.finished) return;

    const S = res.attempt;
    const sessionId = res.sessionId;
    let stopped = false, submitted = false, hb, tick;
    let page = QS.pageIndexFromText() ?? 0;
    let pageStart = document.hidden ? null : Date.now();
    let hiddenAt = null, blurAt = null, blurTimer = null;
    let lastActivity = Date.now();
    let lastNavClick = { kind: null, t: 0 };
    let sig = QS.pageSignature();
    let sigTimer = null;

    const event = (type, extra) => {
      S.events.push({ type, t: Date.now(), ...extra });
      if (S.events.length > MAX_EVENTS) S.events.splice(0, S.events.length - MAX_EVENTS);
    };
    const accruePage = () => {
      if (pageStart != null) {
        S.pageTimes[page] = (S.pageTimes[page] || 0) + (Date.now() - pageStart);
        pageStart = document.hidden ? null : Date.now();
      }
    };

    async function flush() {
      if (stopped) return;
      accruePage();
      S.lastSeen = Date.now();
      const r = await send({ type: "update", sessionId, attempt: S });
      if (r && r.stop) stop();
    }
    function stop() {
      stopped = true;
      clearInterval(hb); clearInterval(tick);
      const b = document.getElementById("quizsee-banner"); if (b) b.remove();
    }

    // Banner (always visible to the student while monitored).
    if (!confirmation) {
      const b = document.createElement("div");
      b.id = "quizsee-banner";
      b.textContent = "This quiz is being monitored by quizSEE.";
      document.documentElement.appendChild(b);
    }

    async function markSubmitted() {
      if (submitted || stopped) return;
      submitted = true;
      accruePage();
      S.status = "submitted";
      S.submittedAt = Date.now();
      event("submit");
      await flush();
      stop();
    }

    if (confirmation) { await markSubmitted(); return; }

    event("start_or_resume", { page });
    flush();

    // Tab switches
    document.addEventListener("visibilitychange", guard(() => {
      if (stopped) return;
      if (document.hidden) {
        clearTimeout(blurTimer); blurAt = null;
        accruePage(); pageStart = null;
        hiddenAt = Date.now();
        S.tabSwitches++;
        flush();
      } else {
        const dur = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = null;
        S.awayMs += dur;
        event("tab_hidden", { durationMs: dur, page });
        pageStart = Date.now();
        lastActivity = Date.now();
        flush();
      }
    }));

    // Window blur while tab stays visible (counted separately from tab switches).
    window.addEventListener("blur", guard(() => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => { if (!document.hidden && !stopped) blurAt = Date.now(); }, 300);
    }));
    window.addEventListener("focus", guard(() => {
      clearTimeout(blurTimer);
      if (blurAt && !document.hidden) {
        const dur = Date.now() - blurAt;
        S.blurs++; S.blurMs += dur;
        event("blur", { durationMs: dur, page });
      }
      blurAt = null;
    }));

    // Copy / cut / paste / right-click (no content stored)
    const count = (name, field) => document.addEventListener(name, guard(() => {
      if (stopped) return;
      S[field]++; event(name, { page });
    }), true);
    count("copy", "copies"); count("cut", "cuts"); count("paste", "pastes"); count("contextmenu", "rightClicks");

    // Activity / idle
    const touch = guard(() => { lastActivity = Date.now(); });
    ["mousemove", "keydown", "scroll", "click", "input", "touchstart"].forEach((n) => document.addEventListener(n, touch, true));
    const onInput = guard(() => { if (!stopped) S.inputEvents++; });
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);

    // Page / section changes
    const pageChanged = guard(() => {
      if (stopped || submitted) return;
      if (QS.isConfirmationPage()) { markSubmitted(); return; }
      const s = QS.pageSignature();
      const fromText = QS.pageIndexFromText();
      if (s === sig && (fromText == null || fromText === page)) return;
      sig = s;
      accruePage();
      const recent = Date.now() - lastNavClick.t < 4000;
      page = fromText != null ? fromText : Math.max(0, page + (recent && lastNavClick.kind === "back" ? -1 : 1));
      S.pageChanges++;
      event("page_change", { page });
      flush();
    });
    document.addEventListener("click", guard((e) => {
      const kind = QS.kindOfClickTarget(e.target);
      if (!kind) return;
      lastNavClick = { kind, t: Date.now() };
      if (kind === "submit") flush(); // best-effort save before the page navigates
      else setTimeout(guard(pageChanged), 900); // re-check after the form has re-rendered
    }), true);
    new MutationObserver(() => { clearTimeout(sigTimer); sigTimer = setTimeout(pageChanged, 400); })
      .observe(document.body, { childList: true, subtree: true });

    window.addEventListener("pagehide", guard(() => { if (!submitted) flush(); }));

    hb = setInterval(guard(flush), HEARTBEAT_MS);
    tick = setInterval(guard(() => {
      if (stopped || document.hidden || blurAt) return;
      if (Date.now() - lastActivity > IDLE_MS) S.idleMs += TICK_MS;
    }), TICK_MS);
  }

  main().catch((e) => console.debug("[quizSEE]", e));
})();
