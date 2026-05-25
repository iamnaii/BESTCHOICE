import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * CannedResponseVariableService — expands template variables in canned response content.
 *
 * Supported variables:
 *   {customerName}   → customer.name
 *   {customerPhone}  → customer.phone
 *   {contractNumber} → contract.contractNumber
 *   {amountDue}      → latest unpaid payment amount (formatted with commas)
 *   {dueDate}        → latest unpaid payment due date (dd/MM/พ.ศ., Asia/Bangkok)
 *   {installmentNo}  → latest unpaid payment installment number
 *   {branchName}     → room.assignedTo.branch.name (assigned staff's home branch)
 */
@Injectable()
export class CannedResponseVariableService {
  private readonly logger = new Logger(CannedResponseVariableService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Expand variables in a template string using session/customer/contract context.
   *
   * @param template  - The canned response content (may contain {variable} placeholders)
   * @param context   - Session and optional customer identifiers
   * @returns The expanded string with variables replaced by real data
   */
  async expandVariables(
    template: string,
    context: { roomId: string; customerId?: string },
  ): Promise<string> {
    // 1. If no variables found, return template as-is
    if (!template.includes('{')) {
      return template;
    }

    const variables: Record<string, string> = {};

    // 2. Fetch room → assigned staff → branch (for {branchName}) only when needed
    if (template.includes('{branchName}')) {
      try {
        const room = await this.prisma.chatRoom.findFirst({
          where: { id: context.roomId, deletedAt: null },
          select: {
            assignedTo: {
              select: { branch: { select: { name: true } } },
            },
          },
        });
        variables['branchName'] = room?.assignedTo?.branch?.name ?? '-';
      } catch (error) {
        this.logger.warn(`Failed to fetch branch for variable expansion: ${error.message}`);
        variables['branchName'] = '-';
      }
    }

    // 3. Fetch customer if customerId provided
    if (context.customerId) {
      try {
        const customer = await this.prisma.customer.findFirst({
          where: { id: context.customerId, deletedAt: null },
          select: { id: true, name: true, phone: true },
        });

        if (customer) {
          variables['customerName'] = customer.name ?? 'ลูกค้า';
          variables['customerPhone'] = customer.phone ?? '-';

          // 4. Fetch active contract for customer (most recent ACTIVE contract)
          const contract = await this.prisma.contract.findFirst({
            where: {
              customerId: customer.id,
              status: 'ACTIVE',
              deletedAt: null,
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, contractNumber: true },
          });

          if (contract) {
            variables['contractNumber'] = contract.contractNumber ?? '-';

            // 5. Fetch latest unpaid payment for the contract
            const payment = await this.prisma.payment.findFirst({
              where: {
                contractId: contract.id,
                status: 'PENDING',
              },
              orderBy: { dueDate: 'asc' },
              select: {
                amountDue: true,
                dueDate: true,
                installmentNo: true,
              },
            });

            if (payment) {
              variables['amountDue'] = this.formatDecimalThai(payment.amountDue);
              variables['dueDate'] = this.formatBkkDateBE(payment.dueDate);
              variables['installmentNo'] = String(payment.installmentNo);
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch context for variable expansion: ${error.message}`);
      }
    }

    // 6. Replace variables in template
    let result = template;
    result = result.replace(/\{(\w+)\}/g, (_match, key: string) => {
      return variables[key] ?? '-';
    });

    // 7. Return expanded string
    return result;
  }

  /**
   * Format Prisma.Decimal (or any value with `.toString()`) as Thai-style
   * number with thousands separators + exactly 2 decimal places.
   * Operates on the string form to preserve precision — never coerces to
   * JS number (which loses precision past 2^53 / on certain rationals).
   *
   * Example: Decimal("1234.5") → "1,234.50"; Decimal("0") → "0.00"
   */
  private formatDecimalThai(value: unknown): string {
    if (value === null || value === undefined) return '-';
    const raw = String(value);
    // Strip leading '+'; preserve leading '-'
    const sign = raw.startsWith('-') ? '-' : '';
    const unsigned = raw.replace(/^[-+]/, '');
    const [wholeRaw, fracRaw = ''] = unsigned.split('.');
    const whole = (wholeRaw || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const frac = (fracRaw + '00').slice(0, 2);
    return `${sign}${whole}.${frac}`;
  }

  /**
   * Format a Date as `dd/MM/พ.ศ.` in Asia/Bangkok time (UTC+7, no DST).
   * Uses manual offset math to avoid an extra dependency (date-fns-tz).
   * พ.ศ. (Buddhist Era) = ค.ศ. + 543.
   *
   * Example: Date('2026-05-15T17:00:00Z') (= BKK 00:00 May 16) → "16/05/2569"
   */
  private formatBkkDateBE(date: Date | string): string {
    const utc = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(utc.getTime())) return '-';
    // BKK = UTC+7, no DST. Shift into a Date whose UTC getters return BKK values.
    const bkk = new Date(utc.getTime() + 7 * 60 * 60 * 1000);
    const d = String(bkk.getUTCDate()).padStart(2, '0');
    const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
    const beYear = bkk.getUTCFullYear() + 543;
    return `${d}/${m}/${beYear}`;
  }
}
