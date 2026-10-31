// Minimal Firestore REST client. Numbers/strings/bools/arrays/maps only (timestamps are stored as ms numbers).
import { CONFIG } from "../config.js";
import { getToken } from "./auth.js";

const ROOT = () => `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: encFields(v) } };
}
export function encFields(o) {
  const f = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f[k] = enc(v);
  return f;
}
export function dec(v) {
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) return decFields(v.mapValue.fields || {});
  return null;
}
export function decFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f)) o[k] = dec(v);
  return o;
}
const fromDoc = (d) => ({ id: d.name.split("/").pop(), ...decFields(d.fields || {}) });

export class FsError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function call(method, url, body) {
  const token = await getToken();
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404 && method === "GET") return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new FsError(r.status, (j.error && j.error.message) || `HTTP ${r.status}`);
  return j;
}

export async function getDoc(path) {
  const j = await call("GET", `${ROOT()}/${path}`);
  return j ? fromDoc(j) : null;
}

// Create or fully replace a document.
export async function setDoc(path, data) {
  return fromDoc(await call("PATCH", `${ROOT()}/${path}`, { fields: encFields(data) }));
}

// Merge only the given fields into an existing document.
export async function updateDoc(path, data) {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  return fromDoc(await call("PATCH", `${ROOT()}/${path}?${mask}&currentDocument.exists=true`, { fields: encFields(data) }));
}

// Create with auto ID in a top-level collection; returns the doc.
export async function addDoc(collection, data) {
  return fromDoc(await call("POST", `${ROOT()}/${collection}`, { fields: encFields(data) }));
}

export async function listDocs(collectionPath) {
  const out = [];
  let pageToken = "";
  do {
    const j = await call("GET", `${ROOT()}/${collectionPath}?pageSize=300${pageToken ? "&pageToken=" + pageToken : ""}`);
    if (!j) break;
    (j.documents || []).forEach((d) => out.push(fromDoc(d)));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

// Query a top-level collection with equality filters: { field: value }.
export async function queryEq(collectionId, filters, limit = 100) {
  const fs = Object.entries(filters).map(([f, v]) => ({
    fieldFilter: { field: { fieldPath: f }, op: "EQUAL", value: enc(v) },
  }));
  const where = fs.length === 1 ? fs[0] : { compositeFilter: { op: "AND", filters: fs } };
  const j = await call("POST", `${ROOT()}:runQuery`, {
    structuredQuery: { from: [{ collectionId }], where, limit },
  });
  return (j || []).filter((x) => x.document).map((x) => fromDoc(x.document));
}
