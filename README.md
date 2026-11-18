# Apex Vault

The screen the vault never had. Static files, no build step, no dependencies.
Everything you save is encrypted in the browser with your master password
before it leaves the tab.

**Status:** unlock, entries, CSV import, generator, on-device storage and optional
account sync all implemented. It can run with no account and no network, or talk to
the same Firestore documents as `Automation/src/vault/`.

## Two ways to run it

| Mode | Where entries live | What it needs |
| --- | --- | --- |
| **On this device** (“Use on this device”) | IndexedDB in this browser, ciphertext only | Nothing. No account, no network, works offline |
| **Account sync** (email + password) | Firestore `users/{uid}/vault/{serviceId}` | A Firebase account in the configured project |

The on-device path is the default the store promises, and it needs no setup at all:
open the page, press “Use on this device”, choose a master password and start. The
same AES-GCM envelope is used in both modes, so an entry is ciphertext either way.
`js/local.js` mirrors the five calls in `js/firestore.js` and `js/app.js` picks a
backend at boot, which is why neither mode is a special case in the UI.

Device mode keeps one vault per browser: uninstalling the app or clearing site data
destroys it, and there is no recovery. Sync mode is for carrying entries between
devices, and it is the only mode where the salt lives on a server.

## How it connects to the existing backend

| Piece | Where it comes from |
| --- | --- |
| Sign-in | Firebase Auth REST (`identitytoolkit`), same project as the backend |
| Storage | Firestore REST, `users/{uid}/vault/{serviceId}` |
| Field names | `serviceId, label, ciphertext, iv, salt, updatedAt` - identical to `firestore.ts` |
| Crypto | PBKDF2-SHA256, 100 000 iterations to AES-GCM 256, 16-byte salt, 12-byte IV, base64 - the same format as `crypto.ts` |

The salt is generated once per vault and kept in `users/{uid}/vaultmeta/main`
so any browser can unlock the same entries. Each entry stores that salt in its
own `salt` field, which is why the documents still look exactly like the ones
`firestore.ts` writes.

## The one real difference from the backend

`Automation` encrypts with `env.ENCRYPTION_SECRET` - the server holds the key.
This screen encrypts with your master password instead, so the server (and
anyone who reads the database) cannot decrypt anything. That is the point of a
master password, but it has a consequence:

> Entry ids the scheduled runs read (`gemini`, `google_ai`, `groq`,
> `openrouter`, `ai_settings`, anything starting with `google_`) are decrypted
> by `getVaultCredential()` using `ENCRYPTION_SECRET`. Entries saved here for
> those ids are sealed with your master password, so a cron run will fail to
> read them. The screen warns and asks for confirmation before you save one.

Keeping both consumers happy needs a second envelope in the document, written
through `POST /api/vault`. That is a backend change and is not made here.

## Firebase setup

1. **Sign-in provider:** Firebase console, Authentication, enable Email/Password.
2. **Rules** - merge into your existing rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/vault/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /users/{uid}/vaultmeta/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

3. **Authorised domains** - add the Pages domain under Authentication, Settings.
4. **Project settings** - the gear in the app. Defaults are `apexaiautomation`
   and the public web API key. If sign-in says *API key not valid*, the key
   belongs to another project; copy the right one from Project settings.

## Features

- Unlock with a master password; the key lives in memory only and is dropped
  after 5 minutes idle, on Lock, and on tab close.
- Add, edit and delete entries with username, password, URL and notes.
- Copy username or password; the clipboard is wiped 30 seconds later.
- Password generator, 12-64 characters, all four character sets, rejection
  sampled, with a strength readout.
- CSV import for Chrome, Bitwarden, LastPass and 1Password exports, with column
  mapping, collision-safe ids and per-row progress. Encrypted before writing.
- Search across labels, ids, usernames and URLs.
- Works with no account and no network (device mode), or syncs to Firestore.
- Installs as a PWA; the service worker caches the shell and never the data.

## Deploying to Cloudflare Pages

Upload the folder as-is - no build command, no output directory.
