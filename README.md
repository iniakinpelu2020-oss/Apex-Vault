# Apex Vault

Encrypted passwords and 2FA codes, stored under your own account.

**Status: the crypto and storage half exists inside `Automation`. There is no interface.**

## What already exists

`Automation/src/vault/` contains:

- `crypto.ts` — AES-GCM encryption with a key derived (PBKDF2) from your master password.
- `firestore.ts` — per-user storage, so one account cannot read another's records.
- `offline.ts` — encrypted copies of your keys, so a scheduled run that loses its token
  still works.
- `oauth.ts` — the Google popup flow.
- `index.ts` — the routes that tie them together.

## What is missing

- A screen. Right now the vault is an API and nothing else.
- Import from Chrome, Bitwarden or a CSV, or you will not switch.
- A recovery phrase. If you forget the master password, the data is gone — by design, and
  with no exceptions.
- 2FA code generation (TOTP), which is a small, well-specified algorithm.

## The constraint that shapes it

Firestore's free 1 GiB is enormously more than a password vault needs. The real risk is
not storage. It is losing the key, so a recovery path matters more than any feature.

## What you need to do

1. Nothing new. This uses the same Firebase project as `Apex-Auth`.
2. Decide the master-password policy now, because changing it later means re-encrypting
   every record.

## First three steps

1. A list-and-copy screen over the existing routes.
2. CSV import, with a dry-run preview.
3. A printed recovery phrase, generated at setup and shown exactly once.
