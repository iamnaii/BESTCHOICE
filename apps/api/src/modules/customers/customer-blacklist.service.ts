import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  resolveBlacklistLevel,
  type BlacklistReason,
  type CustomerBlacklistResult,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';
import { fmtDateShort } from '../../utils/document-format.util';
import { CustomerPiiService } from './customer-pii.service';

/**
 * ก้อน 5 C3 — ประเมินว่าลูกค้า "ติด blacklist" ระดับไหนจากสถานะปัจจุบัน
 * (spec docs/superpowers/specs/2026-10-23-contract-blacklist-gate-design.md)
 *
 * HARD (ไม่มีใครปลด): สัญญาผ่อนอยู่ (1 คน 1 เครื่อง) · บอกเลิกแล้วยังไม่คืนเครื่อง · เคยถูกยึด/คืนเอง ·
 *   เคยตัดหนี้สูญ · tag BLACKLIST ที่ติดมือ · เบอร์หลักตรงกับคนใน set
 * SOFT (OWNER/BM ปลดพร้อมเหตุผล): ผู้อ้างอิงพัวพันกับคนใน set ทั้งสองทิศ (จับคู่ด้วยเบอร์)
 *
 * set = ลูกค้า (รวม soft-delete) ที่มีสัญญา CLOSED_BAD_DEBT/TERMINATED · มีแถวยึดที่ไม่ถูกลบ · มี tag BLACKLIST
 * ทุกข้ออ่านจากสถานะปัจจุบัน — สัญญา TERMINATED ที่จ่ายครบจน COMPLETED = พ้นเอง (คำตัดสินใน spec รอบ 3)
 */
export const BLACKLIST_SET_CONTRACT_STATUSES = ['CLOSED_BAD_DEBT', 'TERMINATED'] as const;
export const ACTIVE_CONTRACT_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT'] as const;

const ACTIVE_LABEL: Record<(typeof ACTIVE_CONTRACT_STATUSES)[number], string> = {
  ACTIVE: 'กำลังผ่อน',
  OVERDUE: 'ค้างชำระ',
  DEFAULT: 'ผิดนัด',
};

type Db = Prisma.TransactionClient | PrismaService;

const CUSTOMER_SELECT = {
  id: true, name: true, phone: true, phoneSecondary: true, phoneHash: true, phoneEncrypted: true,
  phoneSecondaryEncrypted: true, references: true, referencesEncrypted: true, mergedIntoId: true,
} satisfies Prisma.CustomerSelect;
type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

const CONTRACT_SELECT = {
  id: true, customerId: true, contractNumber: true, status: true,
  repossession: { select: { id: true, createdAt: true, deletedAt: true,
    deviceReturn: { select: { returnKind: true, deviceReceivedAt: true } } } },
  deviceReturns: { where: { status: 'PENDING_CONFIRM', deletedAt: null }, select: { docNumber: true } },
} satisfies Prisma.ContractSelect;
type ContractRow = Prisma.ContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

type TagRow = Prisma.CustomerTagGetPayload<{ include: { appliedBy: { select: { name: true } } } }>;

interface PhoneProfile {
  primary: Set<string>;
  secondary: Set<string>;
  refs: { name: string; keys: Set<string> }[];
}

const intersects = (a: Set<string>, b: Set<string>) => {
  for (const k of a) if (b.has(k)) return true;
  return false;
};

@Injectable()
export class CustomerBlacklistService {
  constructor(private readonly prisma: PrismaService, private readonly pii: CustomerPiiService) {}

  async evaluate(customerId: string, db: Db = this.prisma): Promise<CustomerBlacklistResult> {
    return (await this.evaluateMany([customerId], db))[customerId];
  }

  /** โหลด set + ประวัติครั้งเดียว แล้วประเมินทุก id (ตาราง/แผงแชทเรียกแบบ batch) */
  async evaluateMany(customerIds: string[], db: Db = this.prisma): Promise<Record<string, CustomerBlacklistResult>> {
    const ids = [...new Set(customerIds.filter(Boolean))];
    if (!ids.length) return {};
    const [customers, contracts, tags, set] = await Promise.all([
      db.customer.findMany({ where: { id: { in: ids } }, select: CUSTOMER_SELECT }),
      db.contract.findMany({
        where: { customerId: { in: ids }, deletedAt: null,
          status: { in: [...ACTIVE_CONTRACT_STATUSES, ...BLACKLIST_SET_CONTRACT_STATUSES] } },
        select: CONTRACT_SELECT, orderBy: { createdAt: 'asc' },
      }),
      db.customerTag.findMany({
        where: { customerId: { in: ids }, tag: 'BLACKLIST', deletedAt: null },
        include: { appliedBy: { select: { name: true } } }, orderBy: { createdAt: 'desc' },
      }),
      db.customer.findMany({
        where: { OR: [
          { contracts: { some: { deletedAt: null, status: { in: [...BLACKLIST_SET_CONTRACT_STATUSES] } } } },
          { contracts: { some: { repossession: { is: { deletedAt: null } } } } },
          { tags: { some: { tag: 'BLACKLIST', deletedAt: null } } },
        ] },
        select: CUSTOMER_SELECT,
      }),
    ]);
    const members = set.map((row) => ({ row, profile: this.profile(row) }));
    const checkedAt = new Date().toISOString();
    const out: Record<string, CustomerBlacklistResult> = {};
    for (const id of ids) {
      const customer = customers.find((c) => c.id === id) ?? null;
      const reasons = [
        ...this.contractReasons(contracts.filter((c) => c.customerId === id)),
        ...this.tagReasons(tags.filter((t) => t.customerId === id)),
        ...(customer ? this.matchReasons(customer, members) : []),
      ];
      out[id] = { level: resolveBlacklistLevel(reasons), reasons, checkedAt };
    }
    return out;
  }

  // ─── สัญญาของตัวลูกค้าเอง ─────────────────────────────────────────────────

  private contractReasons(rows: ContractRow[]): BlacklistReason[] {
    const active: BlacklistReason[] = [], terminated: BlacklistReason[] = [];
    const repossessed: BlacklistReason[] = [], badDebt: BlacklistReason[] = [];
    for (const c of rows) {
      const status = c.status as string;
      const repo = c.repossession && !c.repossession.deletedAt ? c.repossession : null;
      if ((ACTIVE_CONTRACT_STATUSES as readonly string[]).includes(status)) {
        active.push({ code: 'ACTIVE_CONTRACT', level: 'HARD', contractNumber: c.contractNumber,
          message: `มีสัญญาผ่อนอยู่ ${c.contractNumber} (${ACTIVE_LABEL[status as keyof typeof ACTIVE_LABEL]}) — 1 คนผ่อนได้ 1 เครื่อง ต้องปิดสัญญาเดิมก่อน` });
      } else if (repo) {
        const voluntary = repo.deviceReturn?.returnKind === 'VOLUNTARY';
        const when = fmtDateShort(repo.deviceReturn?.deviceReceivedAt ?? repo.createdAt);
        repossessed.push({ code: 'REPOSSESSED', level: 'HARD', contractNumber: c.contractNumber,
          message: voluntary ? `เคยเอาเครื่องมาคืนเอง (สัญญา ${c.contractNumber} · ${when})` : `เคยถูกยึดเครื่อง (สัญญา ${c.contractNumber} · ${when})` });
      } else if (status === 'TERMINATED') {
        const pending = c.deviceReturns[0]?.docNumber;
        terminated.push({ code: 'TERMINATED_UNRETURNED', level: 'HARD', contractNumber: c.contractNumber,
          message: pending
            ? `สัญญา ${c.contractNumber} รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน (ใบ ${pending})`
            : `สัญญา ${c.contractNumber} ถูกบอกเลิกแล้วแต่ยังไม่ได้รับเครื่องคืน` });
      } else if (status === 'CLOSED_BAD_DEBT') {
        badDebt.push({ code: 'BAD_DEBT', level: 'HARD', contractNumber: c.contractNumber,
          message: `เคยถูกตัดเป็นหนี้สูญ (สัญญา ${c.contractNumber})` });
      }
    }
    return [...active, ...terminated, ...repossessed, ...badDebt];
  }

  private tagReasons(rows: TagRow[]): BlacklistReason[] {
    const tag = rows[0];
    if (!tag) return [];
    const by = tag.appliedBy?.name ?? 'ระบบ';
    const tail = tag.reason ? `: ${tag.reason}` : '';
    return [{ code: 'MANUAL_TAG', level: 'HARD', message: `ติด tag blacklist โดย ${by} ${fmtDateShort(tag.createdAt)}${tail}` }];
  }

  // ─── จับคู่เบอร์ / ผู้อ้างอิง กับสมาชิก set ─────────────────────────────────

  private matchReasons(customer: CustomerRow, members: { row: CustomerRow; profile: PhoneProfile | null }[]): BlacklistReason[] {
    const me = this.profile(customer);
    if (!me) return [];
    const phone: BlacklistReason[] = [], refOut: BlacklistReason[] = [], refIn: BlacklistReason[] = [];
    for (const { row, profile } of members) {
      if (!profile || row.id === customer.id || row.mergedIntoId === customer.id || customer.mergedIntoId === row.id) continue;
      const related = { customerId: row.id, name: row.name };
      if (me.primary.size && intersects(me.primary, profile.primary)) {
        phone.push({ code: 'PHONE_MATCH', level: 'HARD', related, message: `เบอร์โทรตรงกับ ${row.name} ที่ติด blacklist` });
      }
      const ref = me.refs.find((r) => intersects(r.keys, profile.primary));
      if (ref) {
        refOut.push({ code: 'REFERENCES_BLACKLISTED', level: 'SOFT', related,
          message: `ผู้อ้างอิง "${ref.name}" คือ ${row.name} ที่ติด blacklist` });
      }
      if (profile.refs.some((r) => intersects(r.keys, me.primary) || intersects(r.keys, me.secondary))) {
        refIn.push({ code: 'REFERENCED_BY_BLACKLISTED', level: 'SOFT', related,
          message: `${row.name} ที่ติด blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง` });
      }
    }
    return [...phone, ...refOut, ...refIn];
  }

  /** คีย์เบอร์ = hash ที่เก็บไว้ + เบอร์ normalize + hash ของเบอร์ normalize (แถวเก่าอาจไม่มี hash) · ถอดรหัสไม่ได้ = null (ข้ามแถว) */
  private profile(row: CustomerRow): PhoneProfile | null {
    let dec: Record<string, unknown>;
    try {
      dec = (this.pii.decryptCustomerFields(row as unknown as Record<string, unknown>) ?? row) as Record<string, unknown>;
    } catch {
      return null;
    }
    // hash ที่เก็บไว้ใช้เฉพาะเมื่อไม่มี plaintext ให้เทียบ — แถวที่ hash ค้างจากเบอร์เดิม (database.md / findLivePhoneOwner)
    // ต้องไม่ทำให้คนที่ถือเบอร์นั้นตอนนี้ถูกห้ามถาวร (review I2)
    const plain = this.keysFor(dec.phone);
    const primary = new Set<string>(plain.length ? plain : (row.phoneHash ? [row.phoneHash] : []));
    const secondary = new Set<string>(this.keysFor(dec.phoneSecondary));
    const refs = Array.isArray(dec.references)
      ? dec.references
          .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
          .map((r) => ({ name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(), keys: new Set<string>(this.keysFor(r.phone)) }))
          .filter((r) => r.keys.size > 0)
      : [];
    return { primary, secondary, refs };
  }

  private keysFor(raw: unknown): string[] {
    const norm = typeof raw === 'string' ? normalizeThaiPhone(raw) || null : null;
    if (!norm) return [];
    const h = this.pii.hash(norm);
    return h ? [norm, h] : [norm];
  }
}
