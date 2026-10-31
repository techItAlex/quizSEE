// All Google Forms DOM/text matching lives here. Classic script (content scripts
// can't be ES modules); exposes globalThis.QS. Every function must be safe:
// return a fallback instead of throwing.
(() => {
  const NEXT = /^(next|continue|siguiente|suivant|weiter|avançar|próxima|selanjutnya|berikutnya)$/i;
  const BACK = /^(back|previous|atrás|retour|zurück|voltar|kembali|sebelumnya)$/i;
  const SUBMIT = /^(submit|send|enviar|envoyer|senden|kirim)$/i;
  const DONE_TEXT = /(your response has been recorded|response has been recorded|tu respuesta se ha registrado|votre réponse a été enregistrée)/i;
  const ANOTHER = /(submit another response|enviar otra respuesta|envoyer une autre réponse)/i;

  const safe = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };

  // Form ID from a URL. Handles /forms/d/e/<id>/viewform, /forms/u/0/d/e/<id>/..., /forms/d/<id>/viewform.
  const parseFormUrl = (url) => safe(() => {
    const m = String(url).match(/\/forms\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const path = String(url);
    return { formId: m[2], isPublished: !!m[1], isEditor: /\/(edit|prefill)\b/.test(path) && !m[1] };
  }, null);

  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim();

  // Find the first button-like element matching a regex on its visible label.
  const buttons = () => safe(() => Array.from(document.querySelectorAll('[role="button"], button')), []);
  const findButton = (re) => safe(() => buttons().find((b) => re.test(label(b))), null);

  const kindOfClickTarget = (target) => safe(() => {
    const el = target && target.closest && target.closest('[role="button"], button');
    if (!el) return null;
    const l = label(el);
    if (NEXT.test(l)) return "next";
    if (BACK.test(l)) return "back";
    if (SUBMIT.test(l)) return "submit";
    return null;
  }, null);

  const isConfirmationPage = () => safe(() => {
    if (/\/formResponse/.test(location.pathname)) return true;
    const text = document.body ? document.body.innerText : "";
    if (DONE_TEXT.test(text)) return true;
    return Array.from(document.querySelectorAll("a")).some((a) => ANOTHER.test(label(a)));
  }, false);

  // Signature of the visible question set (headings only, local use, never sent).
  const pageSignature = () => safe(() => {
    const items = Array.from(document.querySelectorAll('[role="listitem"]')).filter((i) => i.offsetParent !== null);
    const heads = items.map((i) => { const h = i.querySelector('[role="heading"]'); return h ? h.textContent.trim() : ""; });
    let s = heads.length + "|" + heads.join("¦");
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  }, "");

  // "Page 2 of 3" -> 1 (zero-based), or null.
  const pageIndexFromText = () => safe(() => {
    const re = /(?:page|section|página|seite)\s*(\d+)\s*(?:of|de|von|\/)\s*(\d+)/i;
    const el = document.querySelector('[role="progressbar"]');
    let m = ((el && (el.getAttribute("aria-label") || el.textContent)) || "").match(re);
    if (!m) m = (document.body ? document.body.innerText : "").match(re); // "Page 2 of 3" label next to the bar
    return m ? parseInt(m[1], 10) - 1 : null;
  }, null);

  globalThis.QS = { parseFormUrl, findButton, kindOfClickTarget, isConfirmationPage, pageSignature, pageIndexFromText, NEXT, BACK, SUBMIT };
})();
