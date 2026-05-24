import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { format } from 'date-fns';

/**
 * CannedResponseVariableService — expands template variables in canned response content.
 *
 * Supported variables:
 *   {customerName}   → customer.name
 *   {customerPhone}  → customer.phone
 *   {contractNumber} → contract.contractNumber
 *   {amountDue}      → latest unpaid payment amount (formatted with commas)
 *   {dueDate}        → latest unpaid payment due date (dd/MM/yyyy)
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
          where: { id: context.roomId },
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
              variables['amountDue'] = Number(payment.amountDue).toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
              variables['dueDate'] = format(new Date(payment.dueDate), 'dd/MM/yyyy');
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
}
