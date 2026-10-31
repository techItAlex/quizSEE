# quizSEE — Human Setup Guide (for Alex)

Start this now. I'm coding while you do it. Do the steps in order. Everything is free (Spark plan, no credit card).

**Your extension ID (already generated, never changes):** `jijiajkafnoemaghockmnmikflkgidha`
**Your OAuth redirect URI:** `https://jijiajkafnoemaghockmnmikflkgidha.chromiumapp.org/`

I pre-filled `alexandercuison07@gmail.com` as the professor/teacher email in `config.js` and `firestore.rules`. If you want other emails to be professors, add them in both files (step F).

---

## A. Firebase project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. Click **Create a project** (or **Add project**). Name it `quizsee`. Click **Continue**.
3. Turn **Google Analytics OFF**. Click **Create project**, wait, then **Continue**.
   - You should see the project's overview page. The bottom-left should say **Spark** plan (free). Don't upgrade.
4. On the overview page click the **`</>`** (Web) icon. App nickname: `quizsee-web`. Leave "Firebase Hosting" unchecked. Click **Register app**.
5. You'll see a code block with `firebaseConfig`. Copy these two values:
   - `apiKey` → this is `FIREBASE_API_KEY`
   - `projectId` → this is `FIREBASE_PROJECT_ID`
6. Click **Continue to console**.

## B. Firebase Authentication
1. Left menu: **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → click **Google** → toggle **Enable**.
3. Set **Public-facing name** `quizSEE` and pick your email as **Support email**. Click **Save**.
   - You should see Google listed as **Enabled**.

## C. Firestore database
1. Left menu: **Build → Firestore Database** → **Create database**.
2. Choose edition **Standard** if asked. Location: pick the nearest (e.g. `asia-southeast1`). Click **Next**.
3. Choose **Start in production mode**. Click **Create**.
4. Open the **Rules** tab. Delete everything in the editor, paste the full contents of `firestore.rules` from this project folder, and click **Publish**.
   - You should see "Rules published" with a timestamp.

## D. Google Auth consent screen (same project)
1. Go to https://console.cloud.google.com. At the top, click the project picker and select **quizsee** (the same project you just made).
2. Search bar → type **Google Auth Platform** → open it. Click **Get started** if it shows.
3. App name `quizSEE`, User support email = yours. **Next**.
4. Audience: **External**. **Next**. Contact email = yours. **Next**. Agree, **Continue**, **Create**.
5. Left menu **Data Access** → **Add or remove scopes** → tick `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` → **Update** → **Save**.
6. Left menu **Audience**. Make sure **Publishing status** is **Testing** (leave it).
7. Under **Test users** click **Add users** and add **every Google account that will use quizSEE**: your professor account, your test student account(s). Click **Save**.
   - Known limit: Testing mode allows max 100 test users. Fine for the demo; a real class would need Google verification.

## E. OAuth Client ID
1. In Google Auth Platform → **Clients** → **Create client**.
2. Application type: **Web application**. Name: `quizSEE extension`.
3. Under **Authorized redirect URIs** → **Add URI** → paste exactly:
   `https://jijiajkafnoemaghockmnmikflkgidha.chromiumapp.org/`
   (keep the trailing slash). Leave "Authorized JavaScript origins" empty.
4. Click **Create**. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). → this is `GOOGLE_OAUTH_CLIENT_ID`.
   - It can take a few minutes for a new client to start working.

## F. Fill in `config.js`
Open `config.js` in this folder and replace the placeholders:
```js
FIREBASE_API_KEY: "AIza...",
FIREBASE_PROJECT_ID: "quizsee-xxxxx",
GOOGLE_OAUTH_CLIENT_ID: "123...apps.googleusercontent.com",
TEACHER_EMAILS: ["alexandercuison07@gmail.com"],
```
If you add more professor emails, add them in **`firestore.rules`** too (the `teacherEmails` list at the top), then re-publish the rules (step C.4).

## G. Load the extension in Chrome
1. Go to `chrome://extensions`. Turn on **Developer mode** (top right).
2. Click **Load unpacked** → select the `quizSEE` folder (the one containing `manifest.json`).
3. Check the card shows ID `jijiajkafnoemaghockmnmikflkgidha`. If it differs, tell me.
4. After any code or `config.js` change, click the **reload (circular arrow)** on the quizSEE card. Also refresh any open Google Form tab.
5. Tip: click the puzzle icon in Chrome → pin quizSEE.

## H. Test Google Form
1. Go to https://forms.google.com → create a blank form → in Settings turn on **Make this a quiz** (optional).
2. Make **at least 3 sections**: add questions (2–3 short ones), then **Add section** twice more, with questions in each. Next buttons appear automatically.
3. Click **Send** (paper-plane) → link tab → copy the **viewer link** (looks like `https://docs.google.com/forms/d/e/1FAIpQLS.../viewform`).
   - Make sure responses aren't limited to a particular org, so the test student account can open it.

## I. Two Chrome profiles
1. Chrome profile icon → **Add** → create a profile signed into your **test student Google account**. In it, repeat step G (load unpacked, same folder).
2. Your normal profile = professor.
3. Both accounts must be in the Test users list from step D.7.

## J. Run the acceptance test
When I finish coding, I'll post a `🧑 YOUR TURN` block with the exact test steps (also saved in README.md). Report what passes/fails.

## K. Stretch only (email results)
Don't do this until the core passes. Later: Google Cloud → APIs & Services → Library → enable **Gmail API**; add scope `https://www.googleapis.com/auth/gmail.send` in Data Access.

---

### 🧑 YOUR TURN — what I need from you right now
Finish A–E, fill `config.js` (F), then paste back to me:
1. Confirmation that the extension loads (G) and the ID shown.
2. **Do not paste secrets** — only tell me "config.js filled". The API key and client ID aren't secret, but you don't need to send them.
