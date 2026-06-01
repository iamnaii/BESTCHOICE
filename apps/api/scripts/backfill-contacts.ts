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
 * Usage:
 *   CONFIRM_BACKFILL=YES_I_AM_SURE \
 *   EXPECTED_DB_NAME=bestchoice_dev \
 *   npm --prefix apps/api run backfill:contacts
 *
 * Production: also add ALLOW_PROD_BACKFILL=YES_I_AM_SURE.
 *
 * Notes:
 *   - The pure decision helper `resolveBackfillAction` is unit-tested. The
 *     runnable main() is operational glue guarded by `require.main === module`
 *     so importing this file in Jest does NOT connect to a DB or run anything.
 *   - Customer.nationalIdHash is read DIRECTLY from the column (already
 *     populated by the PII system) — we never recompute hashes here, so no
 *     PII_HASH_SALT / PII_ENCRYPTION_KEY is needed.
 */
import { PrismaClient } from '@prisma/client';

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

    /** Ensure an existing contact carries `role`; persist + update memory. */
    async function ensureRole(contactId: string, role: ContactRole): Promise<void> {
      const row = contacts.find((c) => c.id === contactId);
      if (row && !row.roles.includes(role)) {
        row.roles.push(role);
        await prisma.contact.update({
          where: { id: contactId },
          data: { roles: { set: row.roles } },
        });
      }
    }

    /** Create a Contact, register it in the in-memory set, return its id. */
    async function createContact(data: {
      name: string;
      taxId: string | null;
      nationalIdHash: string | null;
      phone: string | null;
      email: string | null;
      roles: ContactRole[];
    }): Promise<string> {
      const created = await prisma.contact.create({
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
      contacts.push({
        id: created.id,
        taxId: created.taxId,
        nationalIdHash: created.nationalIdHash,
        roles: created.roles as ContactRole[],
      });
      return created.id;
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
        let contactId: string;
        if (action.kind === 'attach') {
          contactId = action.contactId;
          await ensureRole(contactId, 'SUPPLIER');
          summary.Supplier.attached += 1;
        } else {
          contactId = await createContact({
            name: s.name,
            taxId: s.taxId,
            nationalIdHash: null,
            phone: s.phone,
            email: null, // Supplier has no email column
            roles: ['SUPPLIER'],
          });
          summary.Supplier.created += 1;
        }
        await prisma.supplier.update({ where: { id: s.id }, data: { contactId } });
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
        let contactId: string;
        if (action.kind === 'attach') {
          contactId = action.contactId;
          await ensureRole(contactId, 'CUSTOMER');
          summary.Customer.attached += 1;
        } else {
          contactId = await createContact({
            name: cust.name,
            taxId: null,
            nationalIdHash: cust.nationalIdHash,
            phone: cust.phone,
            email: null,
            roles: ['CUSTOMER'],
          });
          summary.Customer.created += 1;
        }
        await prisma.customer.update({ where: { id: cust.id }, data: { contactId } });
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
        let contactId: string;
        if (action.kind === 'attach') {
          contactId = action.contactId;
          await ensureRole(contactId, 'TRADE_IN_SELLER');
          summary.TradeIn.attached += 1;
        } else {
          contactId = await createContact({
            name: t.sellerName ?? 'ไม่ระบุชื่อ',
            taxId: null,
            nationalIdHash: null,
            phone: t.sellerPhone,
            email: null,
            roles: ['TRADE_IN_SELLER'],
          });
          summary.TradeIn.created += 1;
        }
        await prisma.tradeIn.update({ where: { id: t.id }, data: { sellerContactId: contactId } });
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
        let contactId: string;
        if (action.kind === 'attach') {
          contactId = action.contactId;
          await ensureRole(contactId, 'FINANCE_COMPANY');
          summary.ExternalFinanceCompany.attached += 1;
        } else {
          contactId = await createContact({
            name: co.name,
            taxId: co.taxId,
            nationalIdHash: null,
            phone: co.contactPhone,
            email: co.email,
            roles: ['FINANCE_COMPANY'],
          });
          summary.ExternalFinanceCompany.created += 1;
        }
        await prisma.externalFinanceCompany.update({
          where: { id: co.id },
          data: { contactId },
        });
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
