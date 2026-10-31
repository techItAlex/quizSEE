# quizSEE

Chrome extension (Manifest V3) that monitors student behavior during a **Google Forms** quiz and shows the professor a live view and a results dashboard. Backend: Firebase Auth + Firestore (free Spark plan) via REST. No build step.

## Setup
Follow **HUMAN_SETUP.md** (Firebase, Google OAuth client, `config.js`, load unpacked). Extension ID is fixed by the `key` in `manifest.json`: `jijiajkafnoemaghockmnmikflkgidha`.

## What is collected (and what is not)
Collected, only while a quiz session for that form is active: start/submit times, tab switches and time away, window blur, copy/cut/paste/right-click **counts** (never contents), idle time, number of input events, page/section changes and time per page, heartbeats.
**Never collected:** answers, question text, screenshots, webcam, other tabs' URLs or titles. Students see a banner on the form and a warning in the popup.

## Layout
`background/service-worker.js` (auth + Firestore writes + offline queue) · `content/forms-monitor.js` (tracking) · `lib/selectors.js` (all Google Forms selectors) · `lib/scoring.js` (tunable constants at top) · `dashboard/` (professor UI) · `popup/` · `firestore.rules`.

## Known limitations
- Google OAuth in Testing mode allows max 100 test users; a real class needs Google app verification.
- Scores are rule-based **indicators for review, not proof of cheating**.
- Google Forms' DOM changes; if page/submit detection breaks, update `lib/selectors.js`.
- Students' attempts are written ~every 15 s; very short events right before closing the tab may be lost.
- Professor allowlist lives in two places: `config.js` and `firestore.rules`.

## Acceptance test
See the `YOUR TURN` block delivered with the build (steps 1–7 of the PRD, Section 10).
