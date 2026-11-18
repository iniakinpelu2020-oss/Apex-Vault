import { getConfig, setConfig, isCronReadable } from "./config.js";
import { currentSession, signIn, signOut, idToken } from "./auth.js";
import { deriveKey, encryptWith, decryptWith, randomB64 } from "./crypto.js";
import { listItems, saveItem, deleteItem, getMeta, saveMeta } from "./firestore.js";
import { detectDelimiter, parseCsv, guessMapping, rowsToRecords } from "./csv.js";
import { generate, strength, slug } from "./gen.js";
import { $, el, setView, toast, showError, fmtDate, setStatus, renderEntries } from "./ui.js";

const state = {
  session: null,
  key: null,
  saltB64: "",
  items: [],
  newVault: false,
  csv: null,
  genTarget: null,
  idleTimer: null,
};

/* ---------- helpers ---------- */

function clearKey() {
  state.key = null;
}

function armIdleLock() {
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    if (state.key) {
      clearKey();
      toast("Locked after 5 minutes idle", 3000);
      goLock();
    }
  }, 5 * 60 * 1000);
}

async function copyText(text, what) {
  if (!text) return toast(`No ${what} stored`);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return toast("Clipboard blocked by the browser");
  }
  toast(`${what} copied — clearing in 30s`);
  setTimeout(async () => {
    try {
      const now = await navigator.clipboard.readText();
      if (now === text) await navigator.clipboard.writeText("");
    } catch {
      /* clipboard read needs permission; leaving it is acceptable */
    }
  }, 30000);
}

function decryptAll() {
  const jobs = state.items.map(async (item) => {
    if (!item.ciphertext || !item.iv) {
      item.error = "missing ciphertext";
      return;
    }
    try {
      item.data = await decryptWith(state.key, { ciphertext: item.ciphertext, iv: item.iv });
      item.error = "";
    } catch {
      item.error = "decrypt failed";
    }
  });
  return Promise.all(jobs);
}

function visibleItems() {
  const term = $("search").value.trim().toLowerCase();
  const sorted = [...state.items].sort((a, b) =>
    (a.label || a.serviceId).localeCompare(b.label || b.serviceId),
  );
  if (!term) return sorted;
  return sorted.filter((i) => {
    const hay = [i.label, i.serviceId, i.data && i.data.username, i.data && i.data.url]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(term);
  });
}

function paint() {
  const items = visibleItems();
  renderEntries(items, {
    copy: (item, field) => copyText(item.data ? item.data[field] : "", field),
    edit: (item) => openEntry(item),
    remove: (item) => removeEntry(item),
  });
  const locked = state.items.filter((i) => i.error).length;
  setStatus(
    `${state.items.length} entr${state.items.length === 1 ? "y" : "ies"} sealed with your master password` +
      (locked ? ` · ${locked} unreadable` : ""),
  );
}

/* ---------- views ---------- */

function goAuth() {
  setView("auth");
  showError("auth-error", "");
}

async function goLock() {
  setView("lock");
  showError("unlock-error", "");
  const meta = await getMeta(state.session.uid).catch(() => null);
  const fromItems = state.items.find((i) => i.salt);
  state.saltB64 = (meta && meta.kdfSalt) || (fromItems ? fromItems.salt : "");
  state.newVault = !state.saltB64;
  $("lock-title").textContent = state.newVault ? "Create master password" : "Unlock";
  $("lock-hint").textContent = state.newVault
    ? "There is no recovery. If you forget this, the entries cannot be opened again."
    : "Enter your master password. It is never sent anywhere.";
  $("confirm-wrap").hidden = !state.newVault;
  $("unlock-submit").textContent = state.newVault ? "Create vault" : "Unlock";
  $("unlock-pass").value = "";
  $("unlock-confirm").value = "";
  $("unlock-pass").focus();
}

async function loadVault() {
  setStatus("Loading…");
  try {
    state.items = await listItems(state.session.uid);
  } catch (err) {
    state.items = [];
    setStatus("");
    toast(err.message || "Could not load the vault", 4200);
  }
}

function showVault() {
  setView("vault");
  paint();
  armIdleLock();
}

/* ---------- unlock ---------- */

$("form-unlock").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("unlock-pass").value;
  showError("unlock-error", "");
  if (password.length < 8) return showError("unlock-error", "Use at least 8 characters.");
  if (state.newVault && password !== $("unlock-confirm").value) {
    return showError("unlock-error", "The two passwords do not match.");
  }

  $("unlock-submit").disabled = true;
  try {
    const salt = state.newVault ? randomB64(16) : state.saltB64;
    const key = await deriveKey(password, salt);

    if (state.items.length) {
      state.key = key;
      await decryptAll();
      if (state.items.every((i) => i.error)) throw new Error("wrong-password");
    }
    state.key = key;
    state.saltB64 = salt;

    if (state.newVault) {
      await saveMeta(state.session.uid, salt);
      state.newVault = false;
      toast("Vault created — keep that password safe", 3200);
    }
    showVault();
  } catch (err) {
    clearKey();
    showError(
      "unlock-error",
      err.message === "wrong-password" ? "Wrong master password." : err.message || "Could not unlock.",
    );
  } finally {
    $("unlock-submit").disabled = false;
  }
});

$("btn-signout").addEventListener("click", () => {
  signOut();
  clearKey();
  state.items = [];
  state.saltB64 = "";
  goAuth();
});

/* ---------- sign in ---------- */

$("form-auth").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("auth-error", "");
  const button = $("auth-submit");
  button.disabled = true;
  try {
    state.session = await signIn($("auth-email").value.trim(), $("auth-pass").value);
    $("auth-pass").value = "";
    await loadVault();
    await goLock();
  } catch (err) {
    showError("auth-error", err.message || "Sign-in failed");
  } finally {
    button.disabled = false;
  }
});

/* ---------- toolbar ---------- */

$("search").addEventListener("input", paint);
$("btn-refresh").addEventListener("click", async () => {
  await loadVault();
  await decryptAll();
  paint();
  toast("Synced");
});
$("btn-lock").addEventListener("click", () => {
  clearKey();
  goLock();
});
$("btn-add").addEventListener("click", () => openEntry(null));
$("btn-generate").addEventListener("click", () => openGenerator(null));

/* ---------- entry editor ---------- */

let editing = null;
let idTouched = false;

function openEntry(item) {
  editing = item || null;
  idTouched = Boolean(item);
  $("entry-title").textContent = item ? "Edit entry" : "New entry";
  $("f-label").value = item ? item.label : "";
  $("f-serviceid").value = item ? item.serviceId : "";
  const data = (item && item.data) || {};
  $("f-username").value = data.username || "";
  $("f-password").value = data.password || "";
  $("f-url").value = data.url || "";
  $("f-notes").value = data.notes || "";
  $("f-password").type = "password";
  showError("entry-error", "");
  updateEntryWarn();
  $("dlg-entry").showModal();
  $("f-label").focus();
}

function updateEntryWarn() {
  const id = $("f-serviceid").value.trim();
  const warn = $("entry-warn");
  if (isCronReadable(id)) {
    warn.textContent =
      "Scheduled runs in Automation decrypt this id with ENCRYPTION_SECRET. " +
      "Saving it here seals it with your master password instead, so those runs will fail to read it.";
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }
}

$("f-label").addEventListener("input", () => {
  if (!idTouched) $("f-serviceid").value = slug($("f-label").value, "");
  updateEntryWarn();
});
$("f-serviceid").addEventListener("input", () => {
  idTouched = true;
  updateEntryWarn();
});
$("f-reveal").addEventListener("click", () => {
  const input = $("f-password");
  input.type = input.type === "password" ? "text" : "password";
});
$("f-dice").addEventListener("click", () => {
  $("f-password").value = generate();
  $("f-password").type = "text";
  toast("Generated a 20-character password");
});
$("entry-cancel").addEventListener("click", () => $("dlg-entry").close());

$("form-entry").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("entry-error", "");
  const serviceId = slug($("f-serviceid").value, "");
  if (!serviceId) return showError("entry-error", "Give the entry a service id.");

  const exists = state.items.find((i) => i.serviceId === serviceId && i !== editing);
  if (exists) return showError("entry-error", "That service id is already used by another entry.");

  if (isCronReadable(serviceId) && !exists) {
    const ok = confirm(
      `"${serviceId}" is an id the Automation cron path reads. Entries saved here are sealed with your master password, so scheduled runs will not be able to decrypt it.\n\nSave anyway?`,
    );
    if (!ok) return;
  }

  const button = $("entry-save");
  button.disabled = true;
  try {
    const secretData = {
      username: $("f-username").value.trim(),
      password: $("f-password").value,
      url: $("f-url").value.trim(),
      notes: $("f-notes").value.trim(),
    };
    const enc = await encryptWith(state.key, secretData);
    const item = {
      serviceId,
      label: $("f-label").value.trim() || serviceId,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      salt: state.saltB64,
      updatedAt: new Date().toISOString(),
      envelope: "master",
    };
    await saveItem(state.session.uid, item);
    if (editing) Object.assign(editing, item, { data: secretData, error: "" });
    else state.items.push({ ...item, data: secretData, error: "" });
    $("dlg-entry").close();
    paint();
    toast(editing ? "Entry updated" : "Entry saved");
  } catch (err) {
    showError("entry-error", err.message || "Could not save");
  } finally {
    button.disabled = false;
  }
});

async function removeEntry(item) {
  if (!confirm(`Delete "${item.label || item.serviceId}"? This cannot be undone.`)) return;
  try {
    await deleteItem(state.session.uid, item.serviceId);
    state.items = state.items.filter((i) => i !== item);
    paint();
    toast("Deleted");
  } catch (err) {
    toast(err.message || "Could not delete", 4000);
  }
}

/* ---------- generator ---------- */

function renderGenerator() {
  const options = {
    length: Number($("gen-length").value),
    upper: $("gen-upper").checked,
    lower: $("gen-lower").checked,
    digits: $("gen-digits").checked,
    symbols: $("gen-symbols").checked,
  };
  const value = generate(options);
  $("gen-out").textContent = value;
  const s = strength(value);
  $("gen-strength").textContent = `${s.score} bits · ${s.label}`;
  return value;
}

function openGenerator(target) {
  state.genTarget = target;
  $("dlg-gen").showModal();
  renderGenerator();
}

$("gen-length").addEventListener("input", () => {
  $("gen-len-val").textContent = $("gen-length").value;
  renderGenerator();
});
for (const id of ["gen-upper", "gen-lower", "gen-digits", "gen-symbols"]) {
  $(id).addEventListener("change", renderGenerator);
}
$("gen-refresh").addEventListener("click", renderGenerator);
$("gen-copy").addEventListener("click", () => copyText($("gen-out").textContent, "Password"));
$("gen-close").addEventListener("click", () => $("dlg-gen").close());
$("btn-generate").addEventListener("click", () => openGenerator(null));

/* ---------- CSV import ---------- */

function fillSelect(select, headers, selected) {
  select.textContent = "";
  select.append(el("option", { value: "", text: "— none —" }));
  for (const header of headers) {
    select.append(el("option", { value: header, text: header }));
  }
  select.value = headers.includes(selected) ? selected : "";
}

$("btn-import").addEventListener("click", () => {
  state.csv = null;
  $("csv-file").value = "";
  $("csv-summary").textContent = "Choose a CSV export to begin.";
  $("csv-progress").hidden = true;
  $("import-run").disabled = true;
  showError("csv-error", "");
  for (const id of ["map-label", "map-username", "map-password", "map-url", "map-notes"]) {
    fillSelect($(id), [], "");
  }
  $("dlg-import").showModal();
});

$("csv-file").addEventListener("change", async (event) => {
  showError("csv-error", "");
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const rows = parseCsv(text, detectDelimiter(text));
    if (rows.length < 2) throw new Error("That file has no data rows.");
    const headers = rows[0].map((h) => String(h).trim());
    const mapping = guessMapping(headers);
    fillSelect($("map-label"), headers, mapping.label);
    fillSelect($("map-username"), headers, mapping.username);
    fillSelect($("map-password"), headers, mapping.password);
    fillSelect($("map-url"), headers, mapping.url);
    fillSelect($("map-notes"), headers, mapping.notes);
    state.csv = { rows, headers };
    const preview = rowsToRecords(rows, mapping).records;
    $("csv-summary").textContent = `${rows.length - 1} row(s) found · ${preview.length} usable · ${headers.length} columns`;
    $("import-run").disabled = preview.length === 0;
  } catch (err) {
    state.csv = null;
    $("import-run").disabled = true;
    showError("csv-error", err.message || "Could not read that file.");
  }
});

$("import-cancel").addEventListener("click", () => $("dlg-import").close());

$("import-run").addEventListener("click", async () => {
  if (!state.csv) return;
  showError("csv-error", "");
  const mapping = {
    label: $("map-label").value,
    username: $("map-username").value,
    password: $("map-password").value,
    url: $("map-url").value,
    notes: $("map-notes").value,
  };
  if (!mapping.password) return showError("csv-error", "Pick the password column first.");

  const { records } = rowsToRecords(state.csv.rows, mapping);
  if (!records.length) return showError("csv-error", "No usable rows with that mapping.");

  const button = $("import-run");
  button.disabled = true;
  $("csv-progress").hidden = false;
  $("csv-progress").value = 0;

  let ok = 0;
  let failed = 0;
  const taken = new Set(state.items.map((i) => i.serviceId));

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    let base = slug(record.label, `entry-${i + 1}`);
    let serviceId = base;
    let n = 2;
    while (taken.has(serviceId)) serviceId = `${base}-${n++}`;
    taken.add(serviceId);

    try {
      const enc = await encryptWith(state.key, {
        username: record.username,
        password: record.password,
        url: record.url,
        notes: record.notes,
      });
      const item = {
        serviceId,
        label: record.label || serviceId,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        salt: state.saltB64,
        updatedAt: new Date().toISOString(),
        envelope: "master",
      };
      await saveItem(state.session.uid, item);
      state.items.push({
        ...item,
        data: { username: record.username, password: record.password, url: record.url, notes: record.notes },
        error: "",
      });
      ok++;
    } catch {
      failed++;
    }
    $("csv-progress").value = Math.round(((i + 1) / records.length) * 100);
    $("csv-summary").textContent = `Importing ${i + 1} of ${records.length}…`;
  }

  $("csv-summary").textContent = `Imported ${ok} entr${ok === 1 ? "y" : "ies"}` + (failed ? ` · ${failed} failed` : "");
  button.disabled = false;
  paint();
  toast(`${ok} imported${failed ? `, ${failed} failed` : ""}`, 3200);
});

/* ---------- settings ---------- */

function openSettings() {
  const cfg = getConfig();
  $("s-apikey").value = cfg.apiKey;
  $("s-project").value = cfg.projectId;
  $("s-backend").value = cfg.backend;
  showError("settings-error", "");
  $("dlg-settings").showModal();
}

$("btn-config").addEventListener("click", openSettings);
$("btn-settings").addEventListener("click", openSettings);
$("settings-cancel").addEventListener("click", () => $("dlg-settings").close());
$("settings-save").addEventListener("click", () => {
  const apiKey = $("s-apikey").value.trim();
  const projectId = $("s-project").value.trim();
  const backend = $("s-backend").value.trim();
  if (!apiKey || !projectId) return showError("settings-error", "API key and project id are required.");
  setConfig({ apiKey, projectId, backend });
  $("dlg-settings").close();
  toast("Settings saved");
});

/* ---------- boot ---------- */

async function boot() {
  state.session = currentSession();
  if (!state.session) return goAuth();
  try {
    await idToken();
  } catch {
    goAuth();
    return;
  }
  await loadVault();
  await goLock();
  $("auth-email").value = state.session.email || "";
  $("btn-signout").textContent = `Sign out (${state.session.email || "account"})`;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.key) armIdleLock();
});
document.addEventListener("click", () => {
  if (state.key) armIdleLock();
});

boot();
