# PDPA Compliance — PII Column-Level Encryption

**Phase 3 SP4 — Strict-mode runbook**

This document describes how customer PII is encrypted at rest in BESTCHOICE,
how to operate the strict-mode + backfill workflow, and what to do if the
encryption key is lost. It is the source of truth for the PII-encryption
infrastructure delivered in PR `feat/p3-sp4-pii-encryption`.

---

## 1. What PII is encrypted

| Column | Encrypted | Hashed (lookup) | Notes |
| --- | --- | --- | --- |
| `customers.national_id` | ✓ `national_id_encrypted` | ✓ `national_id_hash` (UNIQUE) | 13-digit Thai ID; hash powers dedup + lookup |
| `customers.phone` | ✓ `phone_encrypted` | ✓ `phone_hash` (indexed) | Hash powers `?phone=` search endpoint |
| `customers.phone_secondary` | ✓ `phone_secondary_encrypted` | — | Not searched by exact match |
| `customers.email` | ✓ `email_encrypted` | — | Case-insensitive search uses plaintext column |
| `customers.address_id_card` | ✓ `address_id_card_encrypted` | — | Free text; no exact-match lookup |
| `customers.address_current` | ✓ `address_current_encrypted` | — | Free text |
| `customers.address_work` | ✓ `address_work_encrypted` | — | Free text |
| `customers.guardian_national_id` | ✓ `guardian_national_id_encrypted` | — | Guardian (อายุ 17-19) |
| `customers.guardian_phone` | ✓ `guardian_phone_encrypted` | — | Guardian |
| `customers.guardian_address` | ✓ `guardian_address_encrypted` | — | Guardian |
| `customers.references` (JSON) | ✓ `references_encrypted` | — | Per-element encryption of firstName/lastName/phone/nationalId/address |
| `trade_ins.transfer_account_number` | ✓ `transfer_account_number_encrypted` | — | Phase 2 (PR #743) |
| `trade_ins.transfer_account_name` | ✓ `transfer_account_name_encrypted` | — | Phase 2 (PR #743) |

### Algorithms

| Purpose | Algorithm | Implementation |
| --- | --- | --- |
| Confidentiality + integrity (column encryption) | AES-256-GCM with random 12-byte IV + 16-byte auth tag | `apps/api/src/utils/crypto.util.ts:encryptPII` |
| Deterministic lookup hash | HMAC-SHA-256 | `apps/api/src/utils/pii.util.ts:hashPII` |
| Reference JSON encryption | Per-field AES-256-GCM | `apps/api/src/utils/pii.util.ts:encryptReferencesJson` |

Wire format: `<iv-hex(24)>:<authTag-hex(32)>:<ciphertext-hex>`. Decryption
verifies the auth tag — wrong key or tampered ciphertext throws an
exception (we do NOT silently return the input — that would render
ciphertext as the user's phone number).

The hash is keyed by `PII_HASH_SALT` (≥32 chars) so two databases that share
a `PII_ENCRYPTION_KEY` but differ in salt cannot cross-correlate plaintext
identities.

> **DEEP review C1 migration note** — a brief earlier draft of `crypto.util.ts`
> used AES-256-CBC (no auth tag). The `isEncrypted` format check now requires
> 3 colon-separated parts (iv:tag:ciphertext), so any column that still holds
> CBC-format data after this PR ships will fail `isEncrypted`, fall back to
> its legacy plaintext column, and need to be re-encrypted by the next
> backfill pass. For the Customer 11 PII columns this is automatic via the
> backfill cron. For trade-in `transfer_account_*` columns (Phase 2 PR #743),
> any rows written between Phase 2 merge and Phase 3 SP4 deploy will need a
> one-off re-encrypt — `apps/api/src/cli/encrypt-customer-pii.cli.ts` does NOT
> cover trade-in. Verify with:
> ```sql
> SELECT COUNT(*) FROM trade_ins
> WHERE transfer_account_number_encrypted IS NOT NULL
>   AND transfer_account_number_encrypted NOT LIKE '%:%:%';
> ```
> If 0, no action needed. If > 0, schedule a trade-in re-encrypt CLI before
> enabling PDPA strict mode.

---

## 2. Key management

### Environment variables (production)

| Var | Purpose | How to generate |
| --- | --- | --- |
| `PII_ENCRYPTION_KEY` | AES-256-GCM key, hex-encoded | `openssl rand -hex 32` (64 chars) |
| `PII_HASH_SALT` | HMAC-SHA-256 salt | `openssl rand -hex 32` (64 chars) — anything ≥32 chars is accepted |
| `PDPA_STRICT_MODE` | Optional fallback when `system_config` is unreachable | `'true'` / `'1'` to enable |

Both are validated at boot — see `apps/api/src/utils/env-validation.ts`.
A missing or malformed key crashes the API on startup in production.

> **DEEP review C2 note** — `encryptPII` will now THROW if called with a
> missing or too-short key. The previous "silent passthrough" path wrote
> literal plaintext into the `*_encrypted` columns, which the strict-mode
> `isEncrypted` check happily accepted. This affects `CustomerPiiService.
> encryptCustomerFields` — any code path that writes Customer PII without
> setting `PII_ENCRYPTION_KEY` (>=32 chars) will fail at request time
> rather than silently corrupting data.

Generate once and store in **Secret Manager** (GCP) or your secret backend.
**Never** commit `.env` files. **Never** print these values to logs.

### Rotation procedure (annual)

1. Generate the new key:

   ```bash
   openssl rand -hex 32
   ```

2. Store the new value alongside the current one as
   `PII_ENCRYPTION_KEY_NEXT` in Secret Manager. Do **not** deploy yet.

3. Pause writes briefly (set `READ_ONLY_MODE=true` if you have it) or run
   during the lowest-traffic window.

4. Run a custom re-encryption job (see "Future work" — not in SP4 scope):
   for each customer row, decrypt with the old key then re-encrypt with
   the new key, in-place.

5. Verify counts:

   ```sql
   SELECT COUNT(*) FROM customers WHERE national_id_encrypted IS NOT NULL;
   ```

6. Swap the variables: `PII_ENCRYPTION_KEY` ← `PII_ENCRYPTION_KEY_NEXT`,
   restart all pods.

7. Decommission the old key after 30 days of stable operation.

The salt does NOT rotate — rotating it invalidates every `*_hash` column
and breaks dedup. If you must rotate the salt (e.g. compromise), plan a
full hash-recompute migration first.

---

## 3. Transition from legacy plaintext

The legacy plaintext columns (`customers.national_id`, `customers.phone`,
etc.) still exist for backward compatibility during the rolling-deploy
window. The plan is:

| Phase | What's true | Reads | Writes |
| --- | --- | --- | --- |
| **Phase 2** (PR #743, merged) | Encrypted columns added (nullable) | Plaintext only | Plaintext only |
| **Phase 3** (merged) | Dual-write live; non-strict reads prefer encrypted, fall back to plaintext | Both | Both |
| **Phase 3 SP4** (this PR) | Backfill + strict-mode toggle available | Both (strict rejects null encrypted) | Both |
| **Phase 6.6** (future) | Plaintext columns dropped via migration | Encrypted only | Encrypted only |

### Going from Phase 3 → strict (production checklist)

1. **Confirm env vars** — Settings → PDPA → both badges must show "ตั้งค่าแล้ว".

2. **Run backfill** — either:
   * UI: Settings → PDPA → "เริ่ม Backfill". Polls every 3s, shows live
     progress.
   * CLI (recommended for large datasets):

     ```bash
     CONFIRM_BACKFILL=YES_I_AM_SURE \
     EXPECTED_DB_NAME=bestchoice_prod \
     PII_ENCRYPTION_KEY=$PII_ENCRYPTION_KEY \
     PII_HASH_SALT=$PII_HASH_SALT \
     ALLOW_PROD_BACKFILL=YES_I_AM_SURE \
     npm --prefix apps/api run backfill:encrypt-pii
     ```

   Idempotent — re-running skips already-encrypted rows.

3. **Verify** — Settings → PDPA → `plaintextCount` shows 0, badge says
   "พร้อมเปิด Strict Mode".

4. **Enable strict mode** — toggle "เปิดใช้งาน Strict Mode". The
   `ConfirmDialog` requires explicit confirmation because the setting
   immediately starts rejecting reads of un-backfilled rows.

5. **Smoke test** — open one customer detail page, run a customer search,
   and create a new customer to confirm encrypted+plaintext columns are
   written.

If something breaks, toggle Strict Mode OFF — the system falls back to
the Phase 3 behaviour (encrypted preferred, plaintext fallback).

### Backfill performance

| Row count | Batch size | Estimated duration |
| --- | --- | --- |
| 1,000 | 100 | < 10 s |
| 10,000 | 100 | 1–2 min |
| 50,000 | 100 | 5–10 min |
| 100,000+ | 200 | 10–25 min |

Override the batch size via `PDPA_BACKFILL_BATCH_SIZE=200`. The cap is 1000 —
larger batches stress connection pooling without further speedup.

Backfill is protected by a PostgreSQL advisory lock keyed
`pdpa-backfill`, so CLI + UI button + cron firing simultaneously cannot
double-run.

### Cursor-race retry (W9)

If a concurrent writer inserts a new customer between two batches, the
cursor-based loop can skip past the new row. The backfill detects this
by running a final `count()` after the main loop completes — if
remaining > 0, it runs one additional pass over the unencrypted tail.
After 2 passes, if remaining is still > 0, the run is marked
`COMPLETED_WITH_RACE` (visible in the `errorMessage` column of
`PdpaBackfillRun`) and the operator is recommended to re-run during a
maintenance window where writes are paused.

### PdpaBackfillRun retention (W2)

`PdpaBackfillRetentionCron` (apps/api/src/modules/pdpa/pdpa-backfill-retention.cron.ts)
hard-deletes rows older than 365 days. Runs daily at 02:00 BKK.
Matches the existing AuditLog + OffsiteBackupRun retention policy.

### Backfill query indexes (W10)

Migration `20260949000000_pii_backfill_pending_indexes` adds 4 partial
indexes on `customers` covering the high-cardinality PII columns:
`national_id`, `phone`, `email`, `address_id_card`. Each index covers
only rows where the encrypted counterpart is NULL, so the index size
collapses to ~0 bytes once the backfill is complete.

---

## 4. Audit + access patterns

### What gets logged

| Event | AuditLog action | Triggered by | userId carries |
| --- | --- | --- | --- |
| Backfill run completed/failed | `PDPA_BACKFILL_RUN` | `POST /pdpa-encryption/backfill` (UI) OR CLI | OWNER user (UI) / SYSTEM user (CLI) — W7 |
| Strict-mode toggle | `PDPA_STRICT_MODE_TOGGLED` | `PUT /pdpa-encryption/strict-mode` | OWNER user |
| Per-row PII decryption (existing) | `PII_DECRYPT_FULL` / `PII_DECRYPT_MASKED` | every CustomersController read | reader user |

> **DEEP review W6/W7** — `PDPA_STRICT_MODE_TOGGLED` and `PDPA_BACKFILL_RUN`
> audit rows include `ipAddress` + `userAgent` from the request when
> triggered through HTTP. CLI invocations have neither — the audit row
> lists `triggeredBy: 'cli'` in `newValue` and uses the SYSTEM user UUID
> (`User.isSystemUser=true`) as `userId`, mirroring the cron-job pattern
> from `OffsiteBackupCron` / `etax-auto-submit.cron`.

The `PdpaBackfillRun` model is the auditable history of every backfill,
including the CLI invocations. It records `triggeredBy` ('cli' or
'manual'), `triggeredByUserId` (FK to `User` when 'manual'), and the
hostname/Cloud Run revision the run executed on. Rows older than 1 year
are pruned by `PdpaBackfillRetentionCron` (see §3).

### Who can decrypt what

| Role | nationalId | phone, email, address |
| --- | --- | --- |
| OWNER, FINANCE_MANAGER, ACCOUNTANT, BRANCH_MANAGER | Full | Full |
| SALES | Masked (`12345-XXXXX-XX-3`) via `applyRoleMask` in CustomersController | Full |

Other PII (LIFF-only paths, public webhooks) only decrypts what's required
for that specific flow.

---

## 5. Right-to-deletion (PDPA Article 33)

When a customer requests deletion via DSAR:

1. Process the DSAR via existing flow (`POST /pdpa/dsar/<id>` with
   `status: 'COMPLETED'`).
2. Soft-delete the customer record (existing `DELETE /customers/:id`).
3. **Run the optional anonymisation script** (not in SP4 scope — Phase
   6.6 deliverable) to NULL the encrypted + hash + plaintext columns,
   keeping the row only for audit-log referential integrity.

Soft-delete alone is NOT sufficient for full PDPA erasure — the encrypted
data still exists on disk. Plan the anonymisation step before promising
customers full deletion.

---

## 6. Disaster recovery

### "I lost the PII_ENCRYPTION_KEY"

**Data is unrecoverable.** AES-256-GCM has no backdoor — the auth tag
verifies key correctness and will THROW on the wrong key (no silent
return of garbage). Every encrypted column on every customer is opaque
ciphertext that cannot be decrypted without the original key.

Recovery path:
1. Restore the most recent Cloud SQL backup that pre-dates the key loss
   AND has a known working key (you'll need to redeploy with that key).
2. If no backup exists with a recoverable key — the encrypted columns
   stay broken; you can fall back to the plaintext columns IF Phase 6.6
   hasn't dropped them yet.

**Mitigation:** Secret Manager has version history. Restore the
previous version of the secret before deploying.

### "I rotated the salt"

Every `*_hash` column is now wrong. Dedup queries silently miss
collisions, LIFF login by lineUserIdHash fails for legacy customers.
Recovery: re-run the backfill, which recomputes hashes for any row
where the hash is null OR doesn't match the current salt (see future
"recompute-hashes" mode — out of SP4 scope).

### "Strict mode rejects every read"

You enabled strict mode before completing the backfill. Solution:
1. UI: Settings → PDPA → toggle Strict Mode **OFF**.
2. Run the backfill to completion.
3. Toggle Strict Mode back ON.

The toggle itself doesn't touch customer data — flipping it back is
safe and instantaneous.

---

## 7. Compliance checklist (for legal review)

- [x] PII encrypted at rest with AES-256 (matches NIST SP 800-175B
      recommendations).
- [x] Encryption keys stored outside the application database, in Secret
      Manager.
- [x] Deterministic hash separated from encryption key (HMAC-SHA-256).
- [x] Audit trail for every backfill run + strict-mode toggle.
- [x] Per-role access masking (SALES sees only last digit of national ID).
- [x] Off-site backups also encrypted at rest (P3-SP2 — see
      `OFFSITE-BACKUP.md`).
- [x] Plaintext columns flagged with database comments (`COMMENT ON COLUMN
      ... IS 'LEGACY plaintext PII — Cleared in Phase 6.6.'`).
- [ ] Anonymisation-on-DSAR-completion script — **deferred to Phase 6.6**.
- [ ] Column-level encryption for AuditLog PII — **deferred** (audit is
      immutable; would require a new model).
- [ ] HSM-backed key management — **deferred** (Secret Manager is the
      interim solution; HSM is annual rotation justification only).

---

## 8. Reference paths

| Component | Path |
| --- | --- |
| Crypto util | `apps/api/src/utils/crypto.util.ts` |
| Hash + masking util | `apps/api/src/utils/pii.util.ts` |
| Customer PII service | `apps/api/src/modules/customers/customer-pii.service.ts` |
| Strict-mode + backfill service | `apps/api/src/modules/pdpa/pdpa-encryption.service.ts` |
| Admin controller | `apps/api/src/modules/pdpa/pdpa-encryption.controller.ts` |
| Backfill CLI | `apps/api/src/cli/encrypt-customer-pii.cli.ts` |
| Settings UI tab | `apps/web/src/pages/SettingsPage/tabs/PdpaTab.tsx` |
| Backfill history schema | `model PdpaBackfillRun` in `apps/api/prisma/schema.prisma` |
| Backfill retention cron (W2) | `apps/api/src/modules/pdpa/pdpa-backfill-retention.cron.ts` |
| Existing PII decryption audit | `apps/api/src/modules/pii/pii-audit.service.ts` |
| Phase 2 encrypted-column migration | `apps/api/prisma/migrations/20260528400000_add_pii_encrypted_columns/` |
| SP4 PdpaBackfillRun migration | `apps/api/prisma/migrations/20260948000000_pdpa_backfill_runs/` |
| SP4 partial-index migration (W10) | `apps/api/prisma/migrations/20260949000000_pii_backfill_pending_indexes/` |
