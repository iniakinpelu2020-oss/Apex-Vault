// Firebase Auth over the REST API: no SDK, no build step, works from a static page.
import { getConfig } from "./config.js";

const KEY = "apex_vault_session";

function store(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function currentSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s || !s.refreshToken) return null;
    return s;
  } catch {
    return null;
  }
}

export function signOut() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

async function readError(res) {
  let code = "";
  try {
    const data = await res.json();
    code = (data && data.error && data.error.message) || "";
  } catch {
    /* ignore */
  }
  const map = {
    EMAIL_NOT_FOUND: "No account with that email.",
    INVALID_PASSWORD: "Wrong password.",
    INVALID_LOGIN_CREDENTIALS: "Email or password is incorrect.",
    INVALID_EMAIL: "That email address is not valid.",
    USER_DISABLED: "That account is disabled.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Try again later.",
    API_KEY_INVALID: "That API key is not valid for this project.",
  };
  return new Error(map[code] || code || "Sign-in failed (" + res.status + ")");
}

export async function signIn(email, password) {
  const { apiKey } = getConfig();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  const session = {
    uid: data.localId,
    email: data.email,
    refreshToken: data.refreshToken,
    idToken: data.idToken,
    expiresAt: Date.now() + (Number(data.expiresIn) || 3600) * 1000,
  };
  store(session);
  return session;
}

async function refresh(session) {
  const { apiKey } = getConfig();
  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
      }),
    },
  );
  if (!res.ok) {
    signOut();
    throw new Error("Session expired. Sign in again.");
  }
  const data = await res.json();
  const next = {
    ...session,
    idToken: data.id_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  store(next);
  return next;
}

/** Returns a usable ID token, refreshing it when it is within a minute of expiry. */
export async function idToken() {
  let session = currentSession();
  if (!session) throw new Error("Not signed in");
  if (Date.now() > session.expiresAt - 60000) session = await refresh(session);
  return session.idToken;
}
