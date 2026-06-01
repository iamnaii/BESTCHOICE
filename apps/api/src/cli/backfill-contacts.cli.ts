/**
 * Task 13 — one-time backfill CLI: create `Contact` party-master rows from
 * existing Customer / Supplier / TradeIn / ExternalFinanceCompany data and
 * attach the new contact FK back onto each source row.
 *
 * Dedup policy = SAFE NO-AUTO-MERGE: only `taxId` and `nationalIdHash` count
 * as identity. Phone/name are NEVER used to auto-merge. Keyless rows always
 * get a fresh Contact. This avoids wrongly fusing two different people who
 * happen to share a phone number.
 *
 * Idempotent: each entity is processed only where its contact FK is still
 * null, so re-runs skip already-linked rows.
 *
 * Compiled CLI — ships in the prod Docker image as `dist/src/cli/backfill-contacts.cli.js`
 * and runs as a Cloud Run Job (matching the other prod backfills).
 *
 * Usage (dev):
 *   CONFIRM_BACKFILL=YES_I_AM_SURE \
 *   EXPECTED_DB_NAME=bestchoice_dev \
 *   npm --prefix apps/api run backfill:contacts
 *
 * Production invocation (Cloud Run Job):
 *   gcloud run jobs execute backfill-contacts --region=asia-southeast1 \
 *     --project=bestchoice-prod \
 *     --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,EXPECTED_DB_NAME=bestchoice_prod,ALLOW_PROD_BACKFILL=YES_I_AM_SURE \
 *     --wait
 *
 *   (the container entrypoint runs: node dist/src/cli/backfill-contacts.cli.js)
 *
 * Notes:
 *   - The pure decision helper `resolveBackfillAction` is unit-tested. The
 *     runnable main() is operational glue guarded by `require.main === module`
 *     so importing this file in Jest does NOT connect to a DB or run anything.
 *   - Customer.nationalIdHash is read DIRECTLY from the column (already
 *     populated by the PII system) — we never recompute hashes here, so no
 *     PII_HASH_SALT / PII_ENCRYPTION_KEY is needed.
 */
import { PrismaClient, Prisma } from '@prisma/client';

export interface BackfillCandidate {
  taxId: string | null;
  nationalIdHash: string | null;
  phone?: string | null;
}

export type BackfillAction = { kind: 'attach'; contactId: string } | { kind: 'create' };

/** Pure dedup decision. Only taxId / nationalIdHash count as identity.
 * Phone/name are NEVER used to auto-merge (safe no-auto-merge policy). */
export function resolveBackfillAction(
  existing: Array<{ id: string; taxId: string | null; nationalIdHash: string | null }>,
  c: BackfillCandidate,
): BackfillAction {
  if (c.taxId) {
    const m = existing.find((e) => e.taxId && e.taxId === c.taxId);
    if (m) return { kind: 'attach', contactId: m.id };
  }
  if (c.nationalIdHash) {
    const m = existing.find((e) => e.nationalIdHash && e.nationalIdHash === c.nationalIdHash);
    if (m) return { kind: 'attach', contactId: m.id };
  }
  return { kind: 'create' };
}

// ─────────────────────────────────────────────────────────────────────────
// Runnable glue below — only executes under `require.main === module`.
// ─────────────────────────────────────────────────────────────────────────

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

type ContactRole = 'CUSTOMER' | 'SUPPLIER' | 'TRADE_IN_SELLER' | 'FINANCE_COMPANY';

/** In-memory mirror of the contacts identity set, kept updated as we create. */
interface ContactRow {
  id: string;
  taxId: string | null;
  nationalIdHash: string | null;
  roles: ContactRole[];
}

interface EntitySummary {
  created: number;
  attached: number;
  skipped: number;
}

/** Sequential P-NNNNN code generator backed by an in-memory counter.
 * Single-process one-time script ⇒ no advisory lock needed. */
function makeCodeGenerator(startSeq: number): () => string {
  let seq = startSeq;
  return () => {
    seq += 1;
    return `P-${String(seq).padStart(5, '0')}`;
  };
}

async function main(): Promise<void> {
  if (process.env.CONFIRM_BACKFILL !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to run without CONFIRM_BACKFILL=${REQUIRED_CONSENT}`);
    console.error('');
    console.error('This script creates Contact party-master rows from existing Customer,');
    console.error('Supplier, TradeIn and ExternalFinanceCompany data and attaches the new');
    console.error('contact FK back onto each row. It is idempotent (already-linked rows are');
    console.error('skipped) but it WRITES to data. Run a backup first if in doubt.');
    console.error('');
    console.error('Required env vars:');
    console.error(`  CONFIRM_BACKFILL=${REQUIRED_CONSENT}      (consent)`);
    console.error('  EXPECTED_DB_NAME=<db-name>              (must match current_database())');
    console.error('');
    console.error('Optional:');
    console.error('  ALLOW_PROD_BACKFILL=YES_I_AM_SURE       (required when NODE_ENV=production)');
    process.exit(1);
  }

  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT
  ) {
    console.error(
      `ERROR: Refusing to backfill in NODE_ENV=production without ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}`,
    );
    process.exit(1);
  }

  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact-db-name>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const [{ current_database: actualDb }] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(
      `ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[backfill-contacts] DB: ${actualDb}`);
  console.log('[backfill-contacts] Press Ctrl+C within 5 seconds to abort.');
  await new Promise((r) => setTimeout(r, 5000));

  try {
    // Load the current contacts identity set ONCE into memory. We keep this
    // updated as we create new contacts so within one run, dedup sees freshly
    // created rows too.
    const contacts: ContactRow[] = (
      await prisma.contact.findMany({
        where: { deletedAt: null },
        select: { id: true, taxId: true, nationalIdHash: true, roles: true },
      })
    ).map((c) => ({
      id: c.id,
      taxId: c.taxId,
      nationalIdHash: c.nationalIdHash,
      roles: c.roles as ContactRole[],
    }));

    // Seed the code counter from the current max P-NNNNN.
    const lastContact = await prisma.contact.findFirst({
      where: { contactCode: { startsWith: 'P-' } },
      orderBy: { contactCode: 'desc' },
      select: { contactCode: true },
    });
    const startSeq = lastContact ? parseInt(lastContact.contactCode.split('-')[1], 10) || 0 : 0;
    const nextContactCode = makeCodeGenerator(startSeq);

    // ── Per-row atomicity model ─────────────────────────────────────────
    // Each source row is processed inside a single prisma.$transaction: the
    // Contact create/role-append AND the source-row FK update both run on the
    // SAME `tx` client, so a row either fully links or not at all (no orphaned
    // Contact left behind if the FK update fails). In-memory dedup state
    // (`contacts`) is mutated ONLY after the tx commits — see processRow's
    // post-commit step — so a later row sharing the same key never attaches to
    // a Contact that was rolled back.
    //
    // SOFT-DELETE / UNIQUE CAVEAT: `Contact.taxId` has a FULL @@unique
    // constraint (not partial), so a soft-deleted Contact still carrying a
    // taxId will BLOCK creating/attaching a new Contact with that same taxId —
    // the contact.create below throws, the per-row try/catch counts the row as
    // skipped, and it needs manual follow-up. This cannot happen on the initial
    // backfill (the contacts table starts empty); it only becomes relevant on
    // later re-runs after merges/soft-deletes have occurred.

    /** Ensure an existing contact carries `role` inside `tx`. Returns whether
     * the role was newly appended (so the caller can mirror it into the
     * in-memory `contacts` set AFTER the tx commits). Does NOT mutate memory. */
    async function ensureRole(
      tx: Prisma.TransactionClient,
      contactId: string,
      role: ContactRole,
    ): Promise<boolean> {
      const row = contacts.find((c) => c.id === contactId);
      if (row && !row.roles.includes(role)) {
        await tx.contact.update({
          where: { id: contactId },
          data: { roles: { set: [...row.roles, role] } },
        });
        return true;
      }
      return false;
    }

    /** Create a Contact inside `tx`. Returns the created row but does NOT push
     * it into the in-memory set — the caller registers it AFTER the tx commits
     * so dedup never sees a contact that ended up rolled back. */
    async function createContact(
      tx: Prisma.TransactionClient,
      data: {
        name: string;
        taxId: string | null;
        nationalIdHash: string | null;
        phone: string | null;
        email: string | null;
        roles: ContactRole[];
      },
    ): Promise<ContactRow> {
      const created = await tx.contact.create({
        data: {
          contactCode: nextContactCode(),
          name: data.name,
          taxId: data.taxId,
          nationalIdHash: data.nationalIdHash,
          phone: data.phone,
          email: data.email,
          roles: data.roles,
        },
        select: { id: true, taxId: true, nationalIdHash: true, roles: true },
      });
      return {
        id: created.id,
        taxId: created.taxId,
        nationalIdHash: created.nationalIdHash,
        roles: created.roles as ContactRole[],
      };
    }

    const summary: Record<string, EntitySummary> = {
      Supplier: { created: 0, attached: 0, skipped: 0 },
      Customer: { created: 0, attached: 0, skipped: 0 },
      TradeIn: { created: 0, attached: 0, skipped: 0 },
      ExternalFinanceCompany: { created: 0, attached: 0, skipped: 0 },
    };

    // ── 1. Supplier ──────────────────────────────────────────────────────
    const suppliers = await prisma.supplier.findMany({
      where: { contactId: null, deletedAt: null },
      select: { id: true, name: true, taxId: true, phone: true },
    });
    for (const s of suppliers) {
      try {
        const candidate: BackfillCandidate = { taxId: s.taxId, nationalIdHash: null };
        const action = resolveBackfillAction(contacts, candidate);
        const committed = await prisma.$transaction(async (tx) => {
          if (action.kind === 'attach') {
            const roleAdded = await ensureRole(tx, action.contactId, 'SUPPLIER');
            await tx.supplier.update({ where: { id: s.id }, data: { contactId: action.contactId } });
            return { kind: 'attach' as const, contactId: action.contactId, roleAdded };
          }
          const newContact = await createContact(tx, {
            name: s.name,
            taxId: s.taxId,
            nationalIdHash: null,
            phone: s.phone,
            email: null, // Supplier has no email column
            roles: ['SUPPLIER'],
          });
          await tx.supplier.update({ where: { id: s.id }, data: { contactId: newContact.id } });
          return { kind: 'create' as const, newContact };
        });
        // Post-commit: only now mutate the in-memory dedup set + counters.
        if (committed.kind === 'attach') {
          if (committed.roleAdded) {
            const row = contacts.find((c) => c.id === committed.contactId);
            if (row) row.roles.push('SUPPLIER');
          }
          summary.Supplier.attached += 1;
        } else {
          contacts.push(committed.newContact);
          summary.Supplier.created += 1;
        }
      } catch (err) {
        summary.Supplier.skipped += 1;
        console.error(
          `[backfill-contacts] Supplier ${s.id} FAILED:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── 2. Customer ──────────────────────────────────────────────────────
    // Read EXISTING customer.nationalIdHash directly (do NOT recompute).
    const customers = await prisma.customer.findMany({
      where: { contactId: null, deletedAt: null },
      select: { id: true, name: true, nationalIdHash: true, phone: true },
    });
    for (const cust of customers) {
      try {
        const candidate: BackfillCandidate = {
          taxId: null,
          nationalIdHash: cust.nationalIdHash,
        };
        const action = resolveBackfillAction(contacts, candidate);
        const committed = await prisma.$transaction(async (tx) => {
          if (action.kind === 'attach') {
            const roleAdded = await ensureRole(tx, action.contactId, 'CUSTOMER');
            await tx.customer.update({ where: { id: cust.id }, data: { contactId: action.contactId } });
            return { kind: 'attach' as const, contactId: action.contactId, roleAdded };
          }
          const newContact = await createContact(tx, {
            name: cust.name,
            taxId: null,
            nationalIdHash: cust.nationalIdHash,
            phone: cust.phone,
            email: null,
            roles: ['CUSTOMER'],
          });
          await tx.customer.update({ where: { id: cust.id }, data: { contactId: newContact.id } });
          return { kind: 'create' as const, newContact };
        });
        if (committed.kind === 'attach') {
          if (committed.roleAdded) {
            const row = contacts.find((c) => c.id === committed.contactId);
            if (row) row.roles.push('CUSTOMER');
          }
          summary.Customer.attached += 1;
        } else {
          contacts.push(committed.newContact);
          summary.Customer.created += 1;
        }
      } catch (err) {
        summary.Customer.skipped += 1;
        console.error(
          `[backfill-contacts] Customer ${cust.id} FAILED:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── 3. TradeIn ───────────────────────────────────────────────────────
    // Always keyless ⇒ always create a fresh contact (safe no-auto-merge).
    const tradeIns = await prisma.tradeIn.findMany({
      where: { sellerContactId: null, deletedAt: null },
      select: { id: true, sellerName: true, sellerPhone: true },
    });
    for (const t of tradeIns) {
      try {
        const candidate: BackfillCandidate = { taxId: null, nationalIdHash: null };
        const action = resolveBackfillAction(contacts, candidate);
        // action is always 'create' for keyless candidates.
        const committed = await prisma.$transaction(async (tx) => {
          if (action.kind === 'attach') {
            const roleAdded = await ensureRole(tx, action.contactId, 'TRADE_IN_SELLER');
            await tx.tradeIn.update({
              where: { id: t.id },
              data: { sellerContactId: action.contactId },
            });
            return { kind: 'attach' as const, contactId: action.contactId, roleAdded };
          }
          const newContact = await createContact(tx, {
            name: t.sellerName ?? 'ไม่ระบุชื่อ',
            taxId: null,
            nationalIdHash: null,
            phone: t.sellerPhone,
            email: null,
            roles: ['TRADE_IN_SELLER'],
          });
          await tx.tradeIn.update({
            where: { id: t.id },
            data: { sellerContactId: newContact.id },
          });
          return { kind: 'create' as const, newContact };
        });
        if (committed.kind === 'attach') {
          if (committed.roleAdded) {
            const row = contacts.find((c) => c.id === committed.contactId);
            if (row) row.roles.push('TRADE_IN_SELLER');
          }
          summary.TradeIn.attached += 1;
        } else {
          contacts.push(committed.newContact);
          summary.TradeIn.created += 1;
        }
      } catch (err) {
        summary.TradeIn.skipped += 1;
        console.error(
          `[backfill-contacts] TradeIn ${t.id} FAILED:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── 4. ExternalFinanceCompany ────────────────────────────────────────
    const companies = await prisma.externalFinanceCompany.findMany({
      where: { contactId: null, deletedAt: null },
      select: { id: true, name: true, taxId: true, contactPhone: true, email: true },
    });
    for (const co of companies) {
      try {
        const candidate: BackfillCandidate = { taxId: co.taxId, nationalIdHash: null };
        const action = resolveBackfillAction(contacts, candidate);
        const committed = await prisma.$transaction(async (tx) => {
          if (action.kind === 'attach') {
            const roleAdded = await ensureRole(tx, action.contactId, 'FINANCE_COMPANY');
            await tx.externalFinanceCompany.update({
              where: { id: co.id },
              data: { contactId: action.contactId },
            });
            return { kind: 'attach' as const, contactId: action.contactId, roleAdded };
          }
          const newContact = await createContact(tx, {
            name: co.name,
            taxId: co.taxId,
            nationalIdHash: null,
            phone: co.contactPhone,
            email: co.email,
            roles: ['FINANCE_COMPANY'],
          });
          await tx.externalFinanceCompany.update({
            where: { id: co.id },
            data: { contactId: newContact.id },
          });
          return { kind: 'create' as const, newContact };
        });
        if (committed.kind === 'attach') {
          if (committed.roleAdded) {
            const row = contacts.find((c) => c.id === committed.contactId);
            if (row) row.roles.push('FINANCE_COMPANY');
          }
          summary.ExternalFinanceCompany.attached += 1;
        } else {
          contacts.push(committed.newContact);
          summary.ExternalFinanceCompany.created += 1;
        }
      } catch (err) {
        summary.ExternalFinanceCompany.skipped += 1;
        console.error(
          `[backfill-contacts] ExternalFinanceCompany ${co.id} FAILED:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    console.log('');
    console.log('[backfill-contacts] ===== SUMMARY =====');
    for (const [entity, s] of Object.entries(summary)) {
      console.log(
        `[backfill-contacts]   ${entity.padEnd(24)} created=${s.created} attached=${s.attached} skipped=${s.skipped}`,
      );
    }
    console.log('[backfill-contacts] Done.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(
      '[backfill-contacts] FATAL:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
