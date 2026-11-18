// On-device vault store, the local twin of firestore.js.
//
// Same five calls and the same encrypted envelope (ciphertext, iv, salt), so
// app.js does not care which backend it is talking to. Nothing here touches the
// network or needs an account: entries live in IndexedDB in this browser, sealed
// with the master password, and the salt is stored beside them in `meta`.
//
// One vault per device. The uid argument is accepted so the call sites match the
// Firestore API, and ignored on purpose: two "accounts" on one device would share
// the same key anyway.

const DB_NAME = "apex-vault";
const DB_VERSION = 1;
const ITEMS = "items";
const META = "meta";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("This browser blocks local storage, so the vault cannot save anything."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEMS)) {
        db.createObjectStore(ITEMS, { keyPath: "serviceId" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local storage."));
  });
  return dbPromise;
}

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local storage write failed."));
  });
}

async function store(name, mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error("Local storage transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Local storage transaction aborted."));
    result = run(transaction.objectStore(name));
  });
}

/** Reads every entry back. Decryption happens in app.js, not here. */
export async function listItems() {
  const rows = await done((await openDb()).transaction(ITEMS, "readonly").objectStore(ITEMS).getAll());
  return (rows || [])
    .filter((row) => row && row.serviceId)
    .map((row) => ({
      serviceId: String(row.serviceId),
      label: String(row.label || ""),
      ciphertext: String(row.ciphertext || ""),
      iv: String(row.iv || ""),
      salt: String(row.salt || ""),
      updatedAt: String(row.updatedAt || ""),
      envelope: "device",
    }));
}

export async function saveItem(_uid, item) {
  if (!item || !item.serviceId) throw new Error("An entry needs a service id.");
  const record = {
    serviceId: String(item.serviceId),
    label: String(item.label || item.serviceId),
    ciphertext: String(item.ciphertext || ""),
    iv: String(item.iv || ""),
    salt: String(item.salt || ""),
    updatedAt: String(item.updatedAt || new Date().toISOString()),
    envelope: "device",
  };
  await store(ITEMS, "readwrite", (objectStore) => objectStore.put(record));
}

export async function deleteItem(_uid, serviceId) {
  await store(ITEMS, "readwrite", (objectStore) => objectStore.delete(String(serviceId)));
}

export async function getMeta() {
  const row = await done((await openDb()).transaction(META, "readonly").objectStore(META).get("main"));
  if (!row || !row.kdfSalt) return null;
  return { kdfSalt: String(row.kdfSalt), createdAt: String(row.createdAt || "") };
}

export async function saveMeta(_uid, kdfSalt) {
  const existing = await getMeta();
  await store(META, "readwrite", (objectStore) =>
    objectStore.put({
      id: "main",
      kdfSalt: String(kdfSalt),
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
    }),
  );
}

/** Number of entries stored on this device, without opening them. */
export async function countItems() {
  try {
    return (await listItems()).length;
  } catch {
    return 0;
  }
}
