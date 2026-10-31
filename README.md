# quizSEE

**See how the quiz was taken.** quizSEE is a Chrome extension (Manifest V3) that watches *behavior* while students answer a **Google Forms** quiz, then gives the professor a live view and a results dashboard: who took the quiz, how focused they were, and how likely it is that something is worth a closer look.

It is transparent by design. Students are told they are monitored, a banner stays on the form, and quizSEE never records answers.

- **Extension:** vanilla JavaScript, no build step, no frameworks.
- **Backend:** Firebase Auth (Google sign-in) and Cloud Firestore on the free Spark plan, called through the REST APIs with no SDK.
- **Scoring:** simple, rule-based and explainable. Every rating shows its reasons.

---

## Who does what

| Role | What they do | What they need from the admin |
| --- | --- | --- |
| **Student** | Install the extension, sign in as Student, then open the quiz. | Their Google account added as a test user (see below). |
| **Professor** | Sign in as Professor, create a session for the Google Form, start and end it, review results. | Their Google account added as a test user **and** added to the professor allowlist. |
| **Admin** | Sets up Firebase and Google Cloud once, keeps the two lists up to date, shares the extension. | None. |

---

## For students

1. **Install the extension.** Your professor or admin will give you the quizSEE folder. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the folder. Pin quizSEE with the puzzle icon.
2. **Sign in once.** Click the quizSEE icon, then **Open sign-in page**. Choose **Student** and click **Continue with Google**. If Google says the app is unverified, click **Advanced**, then **Go to quizSEE**. This is normal while the app is in testing.
3. **Check what is recorded.** You will see the full list of what quizSEE records and what it never records.
4. **Take the quiz as usual.** Open the quiz link your professor gave you. When monitoring is on, a blue notice appears at the top of the form: *"This quiz is being monitored by quizSEE."*
5. **Stay on the quiz page.** Switching tabs, being away and pasting are counted. A few tab switches are normal and don't mean anything on their own.
6. **Submit.** Submitting stops the monitoring. If the page reloads mid-quiz, your attempt resumes and your start time does not reset.

**If the blue notice does not appear:** make sure you signed in as **Student**, the professor has started the quiz, and you opened the exact quiz link. Then refresh the form page. If it still doesn't show, tell your professor.

**What is recorded:** when you start and submit, tab switches and time away, window focus changes, copy, cut, paste and right-click *counts* (never the contents), idle time, how many answers you typed, and which page you are on.
**What is never recorded:** your answers, the question text, screenshots, webcam or screen recording, and anything you do in other tabs.

---

## For professors

### One-time setup
1. **Ask the admin** to add you (see the checklist below). You need both: *test user* and *professor allowlist*.
2. **Install the extension** with the same three steps as above (`chrome://extensions`, **Developer mode**, **Load unpacked**).
3. Click the quizSEE icon, then **Open sign-in page**. Choose **Professor** and click **Continue with Google**. If your account is not on the allowlist, quizSEE says *"This account is not allowed as a professor."* Contact the admin.

### Running a quiz
1. **Prepare the Google Form.** Publish it so that anyone with the link can respond, and turn off *Limit to 1 response*. Copy the **responder link**. It looks like `https://docs.google.com/forms/d/e/<ID>/viewform`. Don't use the editor link.
2. **Create a session.** In the dashboard, click **New session**. Enter a title, paste the responder link, and add the roster, one student per line as `email, full name`. You can also import a CSV. Click **Save session**.
3. **Tell students to install and sign in first.** Ask them to sign in as **Student** *before* quiz day.
4. **Start the quiz.** Click **Start quiz** right before students open the form. Only one session can be active per form.
5. **Watch live.** The **Live** tab shows how many are expected, answering, submitted, not started and possibly disconnected (no signal for over 60 seconds). It updates every 5 seconds.
6. **End the quiz.** Click **End quiz**. Anyone still answering is marked *Started, not submitted*.
7. **Review results.** The **Results** tab shows status, start and submit times, time taken, tab switches, focus score and integrity rating for each student. Students on the roster who never opened the form show as *Absent*. Click a student to see their timeline, time per page, comparison with the class and event log.

### Reading the ratings
- **Focus score (0–100)** drops with frequent tab switches, a large share of time away, and idle time.
- **Integrity rating (Low, Medium, High risk)** adds up simple rules, and always shows the reasons (for example, "7 tab switches, 18% of time away, 2 pastes").
- **Baseline confidence** says how much history the rating can lean on. It is Low until the class has 5 submissions or the student has past sessions with you.
- **These are indicators for you to review, not proof of cheating.** A student may have a legitimate reason to leave a tab. Use the timeline to start a conversation, not to decide guilt.

### What to ask the admin for
Send the admin a message like this:

> Hi, please add **your-name@school.edu** to quizSEE.
> 1. Add the account as a **test user** in Google Cloud.
> 2. Add it to the **professor allowlist** in `config.js` and `firestore.rules`, and publish the rules.
> 3. Send me the extension folder and the install steps.
>
> For my class, please also add these student accounts as test users: *(list of emails)*.

---

## For the admin

You set quizSEE up once and then keep two lists current.

### Initial setup
Follow **[HUMAN_SETUP.md](HUMAN_SETUP.md)**. In short:
1. Create a Firebase project on the free Spark plan, add a web app, and copy the **API key** and **project ID**.
2. Enable **Google** sign-in in Firebase Authentication.
3. Create a Firestore database in production mode and publish `firestore.rules`.
4. In Google Cloud (same project), set up the Google Auth Platform consent screen as **External** in **Testing** mode with the scopes `openid`, `email` and `profile`.
5. Create a **Web application** OAuth client with the redirect URI `https://jijiajkafnoemaghockmnmikflkgidha.chromiumapp.org/` and copy the **Client ID**.
6. Put the three values in `config.js`, then load the folder as an unpacked extension.

The extension ID never changes, because the public key is in `manifest.json`.

### Adding a person (every time)
**Every student and every professor** has to be added as a **test user** while the app is in Testing mode:
- Google Cloud Console, **Google Auth Platform**, **Audience**, **Test users**, **Add users**.

**Professors only** also have to be on the allowlist, in **both** places:
1. `config.js`: add the email to `TEACHER_EMAILS`.
2. `firestore.rules`: add the email to the list inside `isTeacher()`. Then paste the rules into Firebase, **Firestore Database**, **Rules**, and click **Publish**.
3. Reload the extension in `chrome://extensions` and send the updated folder to the professor.

If the two lists disagree, a professor may be able to sign in but not save sessions.

### Sharing the extension
Zip the project folder and send it. The recipient follows the install steps above. Do not share `.env` files or private keys (the `.gitignore` already excludes them).

### Troubleshooting
| Symptom | Likely cause |
| --- | --- |
| "Access blocked" or "not a test user" when signing in | The account is missing from **Test users**. |
| `redirect_uri_mismatch` | The OAuth client redirect URI doesn't exactly match the one above, including the trailing slash. |
| "This account is not allowed as a professor." | The email isn't in `TEACHER_EMAILS` or in `firestore.rules`. |
| "Couldn't save the session" | The rules weren't published, or the allowlists differ. |
| Student sees no blue notice | No active session for that form, student signed in as Professor, or the link has a different form ID. |
| Page times or page changes look wrong | Google Forms changed its layout. Update `lib/selectors.js`. |

---

## How it works

- A **content script** runs on Google Forms pages and counts behavior. It sends a snapshot every 15 seconds and immediately on important events.
- A **service worker** owns the sign-in tokens and all Firestore writes. It queues writes in `chrome.storage.local` and retries when the student is offline.
- The **dashboard** is an extension page that polls Firestore every 5 seconds and computes scores in the browser from the stored data.
- Each student writes only their own attempt document. Firestore rules allow it only while the session is active.

### Project layout
```
manifest.json               config.js                firestore.rules
background/service-worker.js
content/forms-monitor.js    content/banner.css
lib/auth.js  lib/firestore.js  lib/scoring.js  lib/selectors.js
popup/        dashboard/    assets/ (styles, fonts)   icons/
HUMAN_SETUP.md  DECISIONS.md
```

`lib/scoring.js` has every threshold as a constant at the top, so rules are easy to tune. `lib/selectors.js` holds all Google Forms selectors.

## Known limitations
- Google sign-in in **Testing mode** allows at most **100 test users**. A real class would need Google's app verification.
- Scores are rule-based **indicators for review, not proof of cheating**.
- Google Forms changes its page structure from time to time. If page or submit detection breaks, update `lib/selectors.js`.
- Attempts are saved about every 15 seconds, so very short events right before a tab closes can be lost.
- The professor allowlist lives in two places, `config.js` and `firestore.rules`, and both must be kept in sync.
- Sessions, including the roster, can be read by any signed-in user (needed so students can find the active session). Acceptable for a school project.

## Privacy
Collected only while a session for that exact form is active: start and submit times, tab switches and time away, window focus changes, copy, cut, paste and right-click counts (never contents), idle time, number of answers typed, page changes and time per page.
Never collected: answers, question text, screenshots, webcam, screen recording, or other tabs' URLs and titles.
