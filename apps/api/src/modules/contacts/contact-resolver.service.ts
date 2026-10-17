import type { ContactRoleDestination } from '@installment/shared';
import { AuditService } from '../audit/audit.service';
import {
  AccessPartySourceService,
  PartyOrigin,
  partyWriteExecution,
} from '../employee-access/access-party-source.service';
import { lockCustomerPhone } from '../customers/customer-phone-lock';
import { hashPII } from '../../utils/pii.util';
import { domainAccessClient } from '../employee-access/access-execution-context';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ContactRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';

type Tx = Prisma.TransactionClient | PrismaService;

export interface ResolveContactInput {
  name: string;
  taxId?: string | null;
  nationalIdHash?: string | null;
  phone?: string | null;
  email?: string | null;
  role: ContactRole;
  origin?: PartyOrigin;
  /** Internal managed-writer proof; checked against the persisted archived Customer link. */
  reviveCustomerId?: string;
  /** Canonical opaque reuse notification; never exposed in a response. */
  onExisting?: (id: string) => void;
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
  private readonly pii: CustomerPiiService;

  private get prisma(): PrismaService {
    return domainAccessClient(this.basePrisma);
  }

  constructor(
    private readonly basePrisma: PrismaService,
    // CustomerPiiModule (leaf) — ไม่ฉีดมา (spec/CLI เก่าที่ new ด้วย prisma ตัวเดียว) = สร้างเอง
    // encryptCustomerFields ไม่แตะ DB เลย จึงใช้ตัวที่สร้างเองได้ผลเท่ากัน
    @Optional() pii?: CustomerPiiService,
    @Optional() private readonly parties?: AccessPartySourceService,
    @Optional() private readonly audit?: AuditService,
  ) {
    this.pii = pii ?? new CustomerPiiService(basePrisma);
  }

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
      const ctx = partyWriteExecution(tx);
      if (ctx) {
        const archived = await tx.contact.findMany({
          where: { deletedAt: { not: null }, OR: orClauses },
          orderBy: { id: 'asc' },
        });
        const ghost = input.reviveCustomerId
          ? await tx.customer.findFirst({
              where: { id: input.reviveCustomerId, deletedAt: { not: null }, mergedIntoId: null },
              select: { contactId: true },
            })
          : null;
        if (input.reviveCustomerId && !ghost)
          throw new ConflictException('ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
        const linked = ghost?.contactId
          ? await tx.contact.findUnique({ where: { id: ghost.contactId } })
          : null;
        // A persisted archived link takes precedence. Never replace or merge it implicitly.
        const candidate = linked?.deletedAt ? linked : !existing ? archived[0] : undefined;
        if (candidate) {
          if (
            archived.length !== 1 ||
            archived[0].id !== candidate.id ||
            !candidate.isActive ||
            (existing && existing.id !== candidate.id)
          )
            throw new ConflictException('ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
          try {
            const sources = await this.parties!.contact(tx, candidate.id, true, false, {
              ...(linked?.id === candidate.id && input.reviveCustomerId
                ? { ghostCustomerId: input.reviveCustomerId }
                : {}),
            });
            this.parties!.assert(ctx.snapshot, 'contacts.read', sources);
            this.parties!.assert(ctx.snapshot, 'contacts.update', sources);
          } catch (error) {
            if (error instanceof ForbiddenException)
              throw new ConflictException('ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
            throw error;
          }
          input.onExisting?.(candidate.id);
          const row = await tx.contact.update({
            where: { id: candidate.id },
            data: {
              deletedAt: null,
              roles: {
                set: candidate.roles.includes(input.role)
                  ? candidate.roles
                  : [...candidate.roles, input.role],
              },
            },
          });
          if (!this.audit) throw new Error('Required contact audit writer unavailable');
          await this.audit.log(
            {
              userId: ctx.snapshot.userId,
              action: 'CONTACT_REVIVED',
              entity: 'contact',
              entityId: candidate.id,
              oldValue: { deletedAt: candidate.deletedAt, roles: candidate.roles },
              newValue: {
                deletedAt: null,
                roles: row.roles,
                customerId: input.reviveCustomerId ?? null,
              },
            },
            ctx.client,
          );
          return row;
        }
        if (existing && !existing.isActive)
          throw new ConflictException('ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
      }
      if (existing) {
        input.onExisting?.(existing.id);
        if (partyWriteExecution(tx) && !existing.roles.includes(input.role)) {
          try {
            await this.parties!.mutation(tx, 'contact', existing.id, 'contacts.update');
          } catch (error) {
            if (error instanceof ForbiddenException)
              throw new ConflictException('ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
            throw error;
          }
        }
        if (!existing.roles.includes(input.role)) {
          const row = await tx.contact.update({
            where: { id: existing.id },
            data: { roles: { set: [...existing.roles, input.role] } },
          });
          const ctx = partyWriteExecution(tx);
          if (ctx) {
            if (!this.audit) throw new Error('Required contact audit writer unavailable');
            await this.audit.log(
              {
                userId: ctx.snapshot.userId,
                action: 'CONTACT_ROLE_ADDED',
                entity: 'contact',
                entityId: existing.id,
                oldValue: { roles: existing.roles },
                newValue: { roles: row.roles },
              },
              ctx.client,
            );
          }
          return row;
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
          ...(input.origin ?? {}),
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
    destination?: ContactRoleDestination,
  ): Promise<EnsureRoleResult> {
    if (role !== 'SUPPLIER' && role !== 'CUSTOMER' && role !== 'TRADE_IN_SELLER') {
      throw new BadRequestException(
        'รองรับเฉพาะการสร้างบทบาท SUPPLIER, CUSTOMER หรือ TRADE_IN_SELLER อัตโนมัติ',
      );
    }

    const contact = await tx.contact.findFirst({
      where: { id: contactId, deletedAt: null },
    });
    if (!contact) {
      if (partyWriteExecution(tx)) throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
      throw new NotFoundException('ไม่พบผู้ติดต่อ');
    }

    const ctx = partyWriteExecution(tx);
    let origin: PartyOrigin | undefined;
    if (ctx) {
      // Opaque phone load precedes business row/code locks. Re-read under source locks below.
      await lockCustomerPhone(ctx.client, this.pii, contact.phone);
      const existing =
        role === 'CUSTOMER'
          ? await tx.customer.findFirst({
              where: { contactId, deletedAt: null },
              select: { id: true },
            })
          : role === 'SUPPLIER'
            ? await tx.supplier.findFirst({
                where: { contactId, deletedAt: null },
                select: { id: true },
              })
            : null;
      const changes =
        (destination?.assignedToId !== undefined &&
          destination.assignedToId !== contact.assignedToId) ||
        !contact.roles.includes(role) ||
        (role !== 'TRADE_IN_SELLER' && !existing);
      const sources = await this.parties!.contact(tx, contactId, true, !changes);
      if (
        !changes &&
        !sources.some(
          (source) =>
            this.parties!.allows(ctx.snapshot, 'contacts.read', source) &&
            this.parties!.allows(ctx.snapshot, 'contacts.update', source),
        )
      )
        throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
      this.parties!.assert(ctx.snapshot, 'contacts.read', sources, changes);
      this.parties!.assert(ctx.snapshot, 'contacts.update', sources, changes);
      await this.parties!.assignment(tx, 'contact', contactId, destination?.assignedToId, sources);
      if (existing) {
        const childSources =
          role === 'CUSTOMER'
            ? await this.parties!.customer(tx, existing.id, true, false, true)
            : await this.parties!.supplier(tx, existing.id, true, true);
        this.parties!.assert(
          ctx.snapshot,
          role === 'CUSTOMER' ? 'customers.read' : 'suppliers.read',
          childSources,
          false,
        );
        // ensureRole does not silently reassign an existing child.
        if (destination?.customerAssignedToId !== undefined) {
          const actual =
            role === 'CUSTOMER'
              ? await tx.customer.findUniqueOrThrow({
                  where: { id: existing.id },
                  select: { assignedToId: true },
                })
              : null;
          if (!actual || actual.assignedToId !== destination.customerAssignedToId)
            throw new BadRequestException('กรุณาแก้ผู้รับผิดชอบที่รายการเดิม');
        }
      } else if (role !== 'TRADE_IN_SELLER') {
        origin = await this.parties!.destination(tx, ctx.scope.company, destination?.branchId);
        const source = {
          company: origin.accessCompanyCode,
          ...(origin.accessBranchId ? { branchId: origin.accessBranchId } : {}),
        };
        this.parties!.assert(
          ctx.snapshot,
          role === 'CUSTOMER' ? 'customers.create' : 'suppliers.create',
          [source],
        );
        if (role === 'CUSTOMER') {
          await this.parties!.assignment(tx, 'customer', null, destination?.customerAssignedToId, [
            source,
          ]);
          const phone = normalizeThaiPhone(contact.phone);
          if (
            phone &&
            (await tx.customer.count({
              where: {
                phoneHash: hashPII(phone, process.env.PII_HASH_SALT || ''),
                deletedAt: null,
              },
            }))
          )
            throw new ConflictException('ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
        } else if (destination?.customerAssignedToId !== undefined)
          throw new BadRequestException('รายการนี้ไม่รองรับผู้รับผิดชอบ');
      }
    }
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
              data: {
                name: contact.name,
                phone: contact.phone ?? '',
                contactId,
                ...(origin ?? {}),
              },
              select: { id: true },
            })
          ).id;
      if (!existing) provisioned = true;
    } else if (role === 'CUSTOMER') {
      // CUSTOMER stub: name + phone only. เบอร์ไม่ว่าง → normalize แล้ว dual-write phoneHash +
      // phoneEncrypted (แบบเดียวกับผู้เขียนเบอร์หลักอื่น — dedup ฝั่งพนักงานหาด้วย phoneHash จึงต้องเห็น stub)
      // เบอร์ว่างคงเขียน '' แบบเดิม (ไม่ต้องใช้กุญแจ) · คอลัมน์ PII อื่นเติมตอนกรอกข้อมูลลูกค้าเต็ม
      // **ไม่ล็อกเบอร์และไม่บล็อกเบอร์ซ้ำที่นี่** — trade-in accept ถือ `contact:code` มาก่อนถึงจุดนี้
      // (กติกาลำดับล็อก .claude/rules/database.md "ล็อกเบอร์หลักของลูกค้า")
      const existing = await tx.customer.findFirst({
        where: { contactId, deletedAt: null },
        select: { id: true },
      });
      customerId = existing
        ? existing.id
        : (
            await tx.customer.create({
              data: {
                name: contact.name,
                ...this.stubPhone(contact.phone),
                contactId,
                ...(origin ?? {}),
                ...(ctx && destination?.customerAssignedToId
                  ? { assignedToId: destination.customerAssignedToId }
                  : {}),
              },
              select: { id: true },
            })
          ).id;
      if (!existing) provisioned = true;
    }
    // TRADE_IN_SELLER: no child row — the TradeIn record links directly via
    // sellerContactId. Just append the role to the Contact if absent.

    if (
      ctx &&
      destination?.assignedToId !== undefined &&
      destination.assignedToId !== contact.assignedToId
    ) {
      await tx.contact.update({
        where: { id: contactId },
        data: { assignedToId: destination.assignedToId },
      });
      provisioned = true;
    }

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

  /** เบอร์ของ customer stub — ว่าง = '' แบบเดิม · ไม่ว่าง = normalize + hash + เข้ารหัส */
  private stubPhone(raw: string | null | undefined): {
    phone: string;
    phoneHash?: string | null;
    phoneEncrypted?: string | null;
  } {
    const phone = normalizeThaiPhone(raw) || '';
    if (!phone) return { phone: '' };
    const enc = this.pii.encryptCustomerFields({ phone });
    return { phone, phoneHash: enc.phoneHash, phoneEncrypted: enc.phoneEncrypted };
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
