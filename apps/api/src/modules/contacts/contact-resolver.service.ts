import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export interface ResolveContactInput {
  name: string;
  taxId?: string | null;
  nationalIdHash?: string | null;
  phone?: string | null;
  email?: string | null;
  role: ContactRole;
}

export interface EnsureRoleResult {
  contactId: string;
  role: ContactRole;
  supplierId?: string;
  customerId?: string;
  /** true when a child row was created and/or the role was newly added */
  provisioned: boolean;
}

@Injectable()
export class ContactResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sequential internal code P-NNNNN, serialized via a global advisory lock. */
  async nextContactCode(tx: Tx): Promise<string> {
    const lockKey = this.hashLockKey('contact:code');
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    // contactCode is zero-padded to 5 digits, so lexicographic desc == numeric desc
    // up to P-99999. A 6th digit (P-100000) would break this ordering; the party
    // master is not expected to exceed 99,999 contacts. Mirror of doc-number.service.ts.
    const last = await tx.contact.findFirst({
      where: { contactCode: { startsWith: 'P-' } },
      orderBy: { contactCode: 'desc' },
      select: { contactCode: true },
    });

    const lastSeq = last ? parseInt(last.contactCode.split('-')[1], 10) || 0 : 0;
    return `P-${String(lastSeq + 1).padStart(5, '0')}`;
  }

  /**
   * Find the party master for these natural keys, or create one.
   * Matching priority: taxId, then nationalIdHash. When NEITHER key is
   * present we never match — always create a fresh Contact (safe
   * no-auto-merge policy for keyless walk-ins / trade-in sellers).
   * If a match is found, the role is appended (idempotent).
   */
  async findOrCreateByNaturalKey(tx: Tx, input: ResolveContactInput) {
    const orClauses: Prisma.ContactWhereInput[] = [];
    if (input.taxId) orClauses.push({ taxId: input.taxId });
    if (input.nationalIdHash) orClauses.push({ nationalIdHash: input.nationalIdHash });

    if (orClauses.length > 0) {
      const existing = await tx.contact.findFirst({
        where: { deletedAt: null, OR: orClauses },
      });
      if (existing) {
        if (!existing.roles.includes(input.role)) {
          return tx.contact.update({
            where: { id: existing.id },
            data: { roles: { set: [...existing.roles, input.role] } },
          });
        }
        return existing;
      }
    }

    const contactCode = await this.nextContactCode(tx);
    try {
      return await tx.contact.create({
        data: {
          contactCode,
          name: input.name,
          taxId: input.taxId ?? null,
          nationalIdHash: input.nationalIdHash ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          roles: [input.role],
        },
      });
    } catch (e) {
      // A concurrent create of the same party can pass the findFirst lookup and
      // then lose the race on the partial-unique index → P2002. The tx is now
      // aborted (Postgres), so we cannot re-query/recover here. Translate to a
      // retryable ConflictException; the caller's tx rolls back and the user retries.
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('ผู้ติดต่อนี้ถูกสร้างพร้อมกัน กรุณาลองใหม่อีกครั้ง');
      }
      throw e;
    }
  }

  /**
   * Ensure a contact can be used in a `role` context: provision the child row
   * (Supplier or Customer) if missing and append the role. Idempotent.
   * Supports SUPPLIER and CUSTOMER. The provisioned child is a minimal stub
   * (name + phone mirrored from the contact); the rest is enriched later.
   */
  async ensureRole(
    tx: Tx,
    contactId: string,
    role: ContactRole,
  ): Promise<EnsureRoleResult> {
    if (role !== 'SUPPLIER' && role !== 'CUSTOMER' && role !== 'TRADE_IN_SELLER') {
      throw new BadRequestException(
        'รองรับเฉพาะการสร้างบทบาท SUPPLIER, CUSTOMER หรือ TRADE_IN_SELLER อัตโนมัติ',
      );
    }

    const contact = await tx.contact.findFirst({
      where: { id: contactId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');

    let provisioned = false;
    let supplierId: string | undefined;
    let customerId: string | undefined;

    if (role === 'SUPPLIER') {
      const existing = await tx.supplier.findFirst({
        where: { contactId, deletedAt: null },
        select: { id: true },
      });
      supplierId = existing
        ? existing.id
        : (
            await tx.supplier.create({
              data: { name: contact.name, phone: contact.phone ?? '', contactId },
              select: { id: true },
            })
          ).id;
      if (!existing) provisioned = true;
    } else if (role === 'CUSTOMER') {
      // CUSTOMER stub: name + phone only. PII encryption/hash columns are left
      // null and filled when the customer record is properly completed.
      const existing = await tx.customer.findFirst({
        where: { contactId, deletedAt: null },
        select: { id: true },
      });
      customerId = existing
        ? existing.id
        : (
            await tx.customer.create({
              data: { name: contact.name, phone: contact.phone ?? '', contactId },
              select: { id: true },
            })
          ).id;
      if (!existing) provisioned = true;
    }
    // TRADE_IN_SELLER: no child row — the TradeIn record links directly via
    // sellerContactId. Just append the role to the Contact if absent.

    if (!contact.roles.includes(role)) {
      await tx.contact.update({
        where: { id: contactId },
        data: { roles: { set: [...contact.roles, role] } },
      });
      provisioned = true;
    }

    if (role === 'SUPPLIER') return { contactId, role, supplierId, provisioned };
    if (role === 'CUSTOMER') return { contactId, role, customerId, provisioned };
    return { contactId, role, provisioned };
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
