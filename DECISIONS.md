# Decisions (where the PRD left room)

- **Sessions are readable by any signed-in user** (students must find the active session by form ID). This also exposes the roster to signed-in users. Acceptable for a school project; per PRD.
- **Teacher can update attempts** (rules): only so "End Quiz" can mark `in_progress` → `not_submitted`. The quiz is ended *first* so students can no longer overwrite.
- **Content script is a classic script**, so `lib/selectors.js` is a classic script exposing `globalThis.QS` (content scripts can't `import`).
- **Timestamps are stored as millisecond numbers**, not Firestore timestamps.
- **Form ID**: taken from `/forms/d/e/<ID>/viewform` (also `/forms/u/0/...` and `/forms/d/<ID>/viewform`). Editor links (`/forms/d/<id>/edit`) have a different ID than the viewer link, so they trigger a warning. `forms.gle` short links can't be resolved; use the full viewer link.
- **Only one active session per form** is allowed (Start Quiz refuses otherwise).
- **Page detection**: a hash of the visible question *headings* (local only, never sent) changes when the section changes; the "Page X of Y" progress label is used if present. Next/Back clicks only set the direction.
- **Scoring**: "unusually fast" rule needs ≥ 3 submissions; robust z needs ≥ 5 (per PRD). Rate metrics use a 60 s duration floor. MAD has floors so a perfectly uniform class doesn't produce infinite z.
- **Baseline confidence** = personal history count (0 Low, 1 Medium, ≥2 High), lowered from High to Medium when the class has < 5 submissions.
- **Personal history** uses up to the 15 most recent ended sessions of the same professor, matched by email.
- **A professor account used as a student** is not monitored (monitoring needs role = student in the popup).
- Stretch items S1 (CSV) and S2 (email) are **not built yet**, per PRD: only after the core acceptance test passes.
