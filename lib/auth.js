// Google sign-in -> Firebase Auth via REST. State lives in chrome.storage.local ("auth").
import { CONFIG, isConfigured } from "../config.js";

const KEY = "auth";
const IDT = "https://identitytoolkit.googleapis.com/v1";

export const isTeacherEmail = (email) =>
  CONFIG.TEACHER_EMAILS.map((e) => e.toLowerCase()).includes(String(email).toLowerCase());

export async function getAuth() {
  const o = await chrome.storage.local.get(KEY);
  return o[KEY] || null;
}
const setAuth = (a) => chrome.storage.local.set({ [KEY]: a });

export async function signOut() {
  await chrome.storage.local.remove(KEY);
}

const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// role: "student" | "teacher". Throws Error with a user-readable message.
export async function signIn(role) {
  if (!isConfigured()) throw new Error("config.js still has placeholders. See HUMAN_SETUP.md.");
  const redirect = chrome.identity.getRedirectURL();
  const nonce = rand();
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: CONFIG.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "token id_token",
    scope: "openid email profile",
    nonce,
    prompt: "select_account",
  });
  let resp;
  try {
    resp = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    throw new Error("Sign-in was cancelled or failed: " + (e.message || e));
  }
  const p = new URLSearchParams(new URL(resp).hash.slice(1));
  const idToken = p.get("id_token");
  if (!idToken) throw new Error("Google did not return an id_token.");
  try {
    const claims = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.nonce !== nonce) throw new Error("nonce mismatch");
  } catch (e) {
    throw new Error("Sign-in response could not be verified.");
  }

  const r = await fetch(`${IDT}/accounts:signInWithIdp?key=${CONFIG.FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: `id_token=${idToken}&providerId=google.com`,
      requestUri: redirect,
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Firebase sign-in failed: " + (j.error && j.error.message));

  const email = (j.email || "").toLowerCase();
  if (role === "teacher" && !isTeacherEmail(email)) {
    throw new Error("This account is not allowed as a professor.");
  }
  await setAuth({
    uid: j.localId, email, name: j.displayName || email, role,
    idToken: j.idToken, refreshToken: j.refreshToken,
    expiresAt: Date.now() + parseInt(j.expiresIn, 10) * 1000,
  });
  return getAuth();
}

// Returns a valid ID token, refreshing silently when it is about to expire.
export async function getToken() {
  const a = await getAuth();
  if (!a) throw new Error("Not signed in");
  if (a.expiresAt - Date.now() > 60000) return a.idToken;
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CONFIG.FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.refreshToken }),
  });
  const j = await r.json();
  if (!r.ok) {
    if (r.status === 400) await signOut(); // refresh token revoked
    throw new Error("Token refresh failed");
  }
  const cur = (await getAuth()) || a;
  await setAuth({ ...cur, idToken: j.id_token, refreshToken: j.refresh_token, expiresAt: Date.now() + parseInt(j.expires_in, 10) * 1000 });
  return j.id_token;
}
