// Firestore REST, same documents and field names as Automation/src/vault/firestore.ts:
//   users/{uid}/vault/{serviceId}  -> serviceId, label, ciphertext, iv, salt, updatedAt
//   users/{uid}/vaultmeta/main     -> kdfSalt (one salt for the whole vault)
import { getConfig } from "./config.js";
import { idToken } from "./auth.js";

function base() {
  return `https://firestore.googleapis.com/v1/projects/${getConfig().projectId}/databases/(default)/documents`;
}

async function authHeaders(extra) {
  return { Authorization: `Bearer ${await idToken()}`, ...(extra || {}) };
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFsValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

export function fromFsValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ("mapValue" in v) {
    const out = {};
    const fields = v.mapValue.fields || {};
    for (const [k, val] of Object.entries(fields)) out[k] = fromFsValue(val);
    return out;
  }
  return null;
}

function docToItem(doc) {
  const f = doc.fields || {};
  const id = (doc.name || "").split("/").pop();
  if (!id) return null;
  return {
    serviceId: String(fromFsValue(f.serviceId) || id),
    label: String(fromFsValue(f.label) || ""),
    ciphertext: String(fromFsValue(f.ciphertext) || ""),
    iv: String(fromFsValue(f.iv) || ""),
    salt: String(fromFsValue(f.salt) || ""),
    updatedAt: String(fromFsValue(f.updatedAt) || ""),
    envelope: String(fromFsValue(f.envelope) || "server"),
  };
}

export async function listItems(uid) {
  const out = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const url =
      `${base()}/users/${encodeURIComponent(uid)}/vault?pageSize=300` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, { headers: await authHeaders() });
    if (res.status === 404) return out;
    if (!res.ok) throw new Error(`Firestore list failed: ${res.status}`);
    const data = await res.json();
    for (const doc of data.documents || []) {
      const item = docToItem(doc);
      if (item) out.push(item);
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

export async function saveItem(uid, item) {
  const url = `${base()}/users/${encodeURIComponent(uid)}/vault/${encodeURIComponent(item.serviceId)}`;
  const fields = {};
  for (const [k, v] of Object.entries(item)) fields[k] = toFsValue(v);
  const res = await fetch(url, {
    method: "PATCH",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`Firestore save failed: ${res.status} ${await res.text()}`);
  }
}

export async function deleteItem(uid, serviceId) {
  const url = `${base()}/users/${encodeURIComponent(uid)}/vault/${encodeURIComponent(serviceId)}`;
  const res = await fetch(url, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok && res.status !== 404) throw new Error(`Firestore delete failed: ${res.status}`);
}

export async function getMeta(uid) {
  const url = `${base()}/users/${encodeURIComponent(uid)}/vaultmeta/main`;
  const res = await fetch(url, { headers: await authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore meta read failed: ${res.status}`);
  const f = (await res.json()).fields || {};
  return {
    kdfSalt: String(fromFsValue(f.kdfSalt) || ""),
    createdAt: String(fromFsValue(f.createdAt) || ""),
  };
}

export async function saveMeta(uid, kdfSalt) {
  const url = `${base()}/users/${encodeURIComponent(uid)}/vaultmeta/main`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      fields: {
        kdfSalt: { stringValue: kdfSalt },
        createdAt: { stringValue: new Date().toISOString() },
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore meta write failed: ${res.status}`);
}
