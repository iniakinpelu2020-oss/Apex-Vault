// Project settings. These match the Firebase project the Automation vault
// backend (Automation/src/vault/firestore.ts) already writes to.
export const DEFAULTS = {
  apiKey: "AIzaSyAXSWi7f3tCMF_2cimrjnLo9j8BZb7Ckr0",
  projectId: "apexaiautomation",
  backend: "https://automation.iniakinpelu2020.workers.dev",
};

// Docs the scheduled runs in Automation decrypt with ENCRYPTION_SECRET.
// Entries this screen seals with a master password cannot be read by those runs.
export const CRON_IDS = ["gemini", "google_ai", "groq", "openrouter", "ai_settings"];

export function isCronReadable(serviceId) {
  const id = String(serviceId || "").toLowerCase();
  return CRON_IDS.includes(id) || id.startsWith("google_");
}

const KEY = "apex_vault_config";

export function getConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setConfig(patch) {
  const next = { ...getConfig(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: settings stay in memory for this visit */
  }
  return next;
}
