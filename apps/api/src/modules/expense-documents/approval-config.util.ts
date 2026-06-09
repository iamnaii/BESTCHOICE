import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { readJsonFlag } from '../../utils/config.util';

/**
 * D1.2.1.3 — Approvers whitelist. JSON-encoded array of User UUIDs stored
 * in SystemConfig key `approvers_list`. Default = empty array (only OWNER
 * may approve when the workflow is enabled but no list is configured).
 *
 * Returns the list filtered to USERS that still exist + are active +
 * not soft-deleted — so a stale ID in the SystemConfig row can never
 * grant approval rights to a deleted account.
 */
export async function getApproversList(
  tx: Prisma.TransactionClient | PrismaService,
): Promise<string[]> {
  try {
    const row = await tx.systemConfig.findFirst({
      where: { key: 'approvers_list', deletedAt: null },
      select: { value: true },
    });
    if (!row?.value) return [];
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    const candidateIds = parsed.filter((v): v is string => typeof v === 'string');
    if (candidateIds.length === 0) return [];
    const valid = await tx.user.findMany({
      where: { id: { in: candidateIds }, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return valid.map((u) => u.id);
  } catch {
    return [];
  }
}

/**
 * D1.2.1.3 — Approver gate. OWNER is always allowed (root-of-trust).
 * Anyone else must be in the configured `approvers_list`. Throws
 * `ForbiddenException` when the caller cannot approve.
 */
export async function assertUserCanApprove(
  tx: Prisma.TransactionClient | PrismaService,
  userId: string,
  userRole?: string,
): Promise<void> {
  if (userRole === 'OWNER') return;
  const approvers = await getApproversList(tx);
  if (!approvers.includes(userId)) {
    throw new ForbiddenException(
      'ไม่มีสิทธิ์อนุมัติเอกสาร — ผู้ใช้นี้ไม่อยู่ในรายชื่อผู้อนุมัติ',
    );
  }
}

/**
 * D1.2.1.4 — Doc-type filter for the Approval Workflow gate. JSON-encoded
 * array of DocumentType enum values stored in SystemConfig key
 * `approval_required_doc_types`. Default = `['PAYROLL']` — the most
 * common controlled-cost category. Other doc types skip approval even
 * when `approval_enabled` is true.
 *
 * Returns the set as a parsed array, defaulting to ['PAYROLL'] when the
 * row is missing / malformed / contains invalid enum values.
 */
export async function getApprovalRequiredDocTypes(
  tx: Prisma.TransactionClient | PrismaService,
): Promise<string[]> {
  const defaults: string[] = ['PAYROLL'];
  const validValues: string[] = [
    'EXPENSE',
    'CREDIT_NOTE',
    'PAYROLL',
    'VENDOR_SETTLEMENT',
    'PETTY_CASH_REIMBURSEMENT',
  ];
  try {
    const row = await tx.systemConfig.findFirst({
      where: { key: 'approval_required_doc_types', deletedAt: null },
      select: { value: true },
    });
    if (!row?.value) return defaults;
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaults;
    const filtered = parsed.filter(
      (v): v is string => typeof v === 'string' && validValues.includes(v),
    );
    return filtered.length > 0 ? filtered : defaults;
  } catch {
    return defaults;
  }
}

/**
 * D1.2.7.2 — reverse-reasons whitelist. Uses shared `readJsonFlag` for
 * uniform JSON-parse + validator semantics. Empty / malformed lists fall
 * back to the canonical 6-reason default so the UI never shows an empty
 * dropdown.
 */
export async function getReverseReasons(
  tx: Prisma.TransactionClient | PrismaService,
): Promise<{ code: string; label: string }[]> {
  const defaults: { code: string; label: string }[] = [
    { code: 'data_entry_error', label: 'ป้อนข้อมูลผิด' },
    { code: 'wrong_vendor', label: 'ผู้ขายผิด' },
    { code: 'wrong_amount', label: 'จำนวนเงินผิด' },
    { code: 'duplicate_entry', label: 'ข้อมูลซ้ำ' },
    { code: 'cancel_transaction', label: 'ยกเลิกรายการ' },
    { code: 'other', label: 'อื่นๆ (ระบุรายละเอียด)' },
  ];
  return readJsonFlag<{ code: string; label: string }[]>(
    tx,
    'reverse_reasons',
    defaults,
    (v): v is { code: string; label: string }[] =>
      Array.isArray(v) &&
      v.length > 0 &&
      v.every(
        (r) =>
          r != null &&
          typeof r === 'object' &&
          typeof (r as { code: unknown }).code === 'string' &&
          typeof (r as { label: unknown }).label === 'string',
      ),
  );
}
