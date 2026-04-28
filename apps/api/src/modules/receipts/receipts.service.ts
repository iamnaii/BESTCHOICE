import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { formatDateShort } from '../../utils/thai-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { LineOaService } from '../line-oa/line-oa.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { JournalAutoService } from '../journal/journal-auto.service';

// Embedded BESTCHOICE logo. Single source of truth for the receipt header.
// Loaded inline so the PDF renders without network access.
const BESTCHOICE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="395 285 710 425" fill="none"><defs><linearGradient id="bc" gradientUnits="userSpaceOnUse" x1="597.6" y1="434.1" x2="902.4" y2="434.1"><stop offset="0" stop-color="#39F0CF"/><stop offset="0.5" stop-color="#25BC93"/><stop offset="1" stop-color="#1DA579"/></linearGradient></defs><path fill="url(#bc)" d="M 603.769531 297.347656 C 600.023438 298.191406 597.769531 301.1875 597.597656 305.820312 C 597.414062 310.808594 599.695312 314.0625 603.605469 315.121094 C 605.0625 315.515625 606.605469 315.484375 608.132812 315.453125 C 608.550781 315.445312 608.96875 315.4375 609.382812 315.4375 C 623.914062 315.445312 638.449219 315.445312 652.980469 315.445312 C 662.1875 315.445312 671.390625 315.445312 680.59375 315.445312 C 692.277344 315.449219 696.074219 321.558594 693.207031 335.660156 C 687.417969 364.132812 681.613281 392.601562 675.878906 421.089844 C 673.085938 434.941406 678.320312 443.273438 689.765625 443.289062 C 717.367188 443.324219 744.976562 443.292969 772.582031 443.335938 C 782.101562 443.351562 785.0625 447.972656 782.789062 459.183594 C 777.746094 484.074219 772.6875 508.957031 767.59375 533.832031 C 764.777344 547.605469 759.269531 552.824219 747.617188 552.828125 C 701.550781 552.84375 655.484375 552.839844 609.414062 552.847656 C 608.996094 552.847656 608.578125 552.84375 608.160156 552.835938 C 606.816406 552.820312 605.472656 552.800781 604.144531 552.976562 C 599.992188 553.523438 597.800781 556.847656 597.597656 561.664062 C 597.402344 566.289062 599.542969 569.574219 603.199219 570.730469 C 604.714844 571.210938 606.347656 571.191406 607.960938 571.171875 C 608.292969 571.164062 608.628906 571.160156 608.960938 571.160156 C 650.808594 571.183594 692.65625 571.175781 734.503906 571.179688 C 776.878906 571.183594 819.257812 571.214844 861.632812 571.164062 C 873.066406 571.152344 879.71875 564.628906 882.480469 551.023438 C 888.8125 519.808594 895.195312 488.605469 901.441406 457.363281 C 905.367188 437.703125 897.210938 424.992188 880.769531 424.957031 C 868.933594 424.933594 857.101562 424.9375 845.265625 424.941406 C 833.714844 424.945312 822.164062 424.949219 810.613281 424.925781 C 799.550781 424.90625 794.933594 417.503906 797.613281 404.195312 C 802.675781 379.085938 807.78125 353.988281 812.839844 328.878906 C 816.617188 310.132812 808.339844 297.125 792.601562 297.121094 C 731.234375 297.097656 669.867188 297.109375 608.503906 297.117188 C 607.859375 297.117188 607.214844 297.097656 606.566406 297.097656 C 605.625 297.097656 604.683594 297.140625 603.769531 297.347656"/><path fill="#4D4D4D" d="M 434.851562 645.261719 L 432.128906 658.890625 L 446.460938 658.890625 C 450.027344 658.890625 452.738281 658.199219 454.589844 656.820312 C 456.4375 655.441406 457.363281 653.441406 457.363281 650.816406 C 457.363281 647.117188 454.570312 645.261719 448.984375 645.261719 Z M 452.214844 684.933594 C 454.234375 683.523438 455.246094 681.4375 455.246094 678.675781 C 455.246094 676.65625 454.503906 675.160156 453.023438 674.183594 C 451.542969 673.207031 449.523438 672.71875 446.964844 672.71875 L 429.300781 672.71875 L 426.476562 687.054688 L 443.835938 687.054688 C 447.402344 687.054688 450.199219 686.347656 452.214844 684.933594 M 472.65625 670.652344 C 474.304688 673.039062 475.128906 675.851562 475.128906 679.078125 C 475.128906 686.414062 472.136719 691.984375 466.148438 695.785156 C 460.15625 699.589844 452.351562 701.488281 442.726562 701.488281 L 403.863281 701.488281 L 417.996094 630.828125 L 453.730469 630.828125 C 461.667969 630.828125 467.746094 632.257812 471.949219 635.117188 C 476.15625 637.980469 478.257812 642.066406 478.257812 647.382812 C 478.257812 651.488281 477.148438 655.039062 474.929688 658.03125 C 472.707031 661.027344 469.613281 663.367188 465.640625 665.046875 C 468.667969 666.394531 471.007812 668.261719 472.65625 670.652344"/><path fill="#4D4D4D" d="M 512.175781 646.273438 L 509.855469 658.183594 L 541.25 658.183594 L 538.320312 673.125 L 506.828125 673.125 L 504.304688 686.042969 L 541.351562 686.042969 L 538.121094 701.488281 L 481.488281 701.488281 L 495.621094 630.828125 L 550.941406 630.828125 L 547.808594 646.273438 Z"/><path fill="#4D4D4D" d="M 559.015625 700.78125 C 553.765625 699.371094 549.492188 697.554688 546.195312 695.332031 L 554.070312 680.390625 C 557.632812 682.679688 561.4375 684.414062 565.472656 685.589844 C 569.511719 686.769531 573.550781 687.355469 577.589844 687.355469 C 581.425781 687.355469 584.402344 686.800781 586.523438 685.691406 C 588.640625 684.582031 589.703125 683.050781 589.703125 681.097656 C 589.703125 679.417969 588.742188 678.105469 586.824219 677.164062 C 584.90625 676.21875 581.929688 675.210938 577.890625 674.132812 C 573.3125 672.921875 569.511719 671.695312 566.484375 670.449219 C 563.457031 669.203125 560.847656 667.304688 558.660156 664.746094 C 556.472656 662.1875 555.378906 658.824219 555.378906 654.652344 C 555.378906 649.601562 556.757812 645.179688 559.519531 641.378906 C 562.277344 637.574219 566.214844 634.632812 571.328125 632.542969 C 576.445312 630.460938 582.433594 629.414062 589.296875 629.414062 C 594.34375 629.414062 599.054688 629.9375 603.429688 630.980469 C 607.804688 632.023438 611.574219 633.519531 614.738281 635.472656 L 607.46875 650.308594 C 604.707031 648.5625 601.664062 647.230469 598.332031 646.324219 C 595.003906 645.414062 591.585938 644.960938 588.085938 644.960938 C 584.117188 644.960938 581.003906 645.601562 578.75 646.878906 C 576.492188 648.15625 575.367188 649.804688 575.367188 651.824219 C 575.367188 653.574219 576.34375 654.921875 578.296875 655.863281 C 580.246094 656.804688 583.273438 657.816406 587.378906 658.890625 C 591.957031 660.035156 595.742188 661.210938 598.738281 662.425781 C 601.730469 663.636719 604.304688 665.484375 606.460938 667.976562 C 608.613281 670.464844 609.6875 673.730469 609.6875 677.765625 C 609.6875 682.75 608.292969 687.140625 605.5 690.941406 C 602.707031 694.742188 598.738281 697.6875 593.589844 699.773438 C 588.441406 701.859375 582.464844 702.902344 575.671875 702.902344 C 569.816406 702.902344 564.261719 702.195312 559.015625 700.78125"/><path fill="#4D4D4D" d="M 639.566406 646.675781 L 617.863281 646.675781 L 621.09375 630.828125 L 684.386719 630.828125 L 681.15625 646.675781 L 659.554688 646.675781 L 648.550781 701.488281 L 628.566406 701.488281 Z"/><path fill="#1DA579" d="M 717.195312 686.347656 C 711.878906 686.347656 707.671875 684.902344 704.574219 682.007812 C 701.480469 679.113281 699.933594 675.277344 699.933594 670.5 C 699.933594 665.855469 700.890625 661.667969 702.808594 657.933594 C 704.726562 654.195312 707.402344 651.269531 710.835938 649.148438 C 714.265625 647.03125 718.238281 645.96875 722.746094 645.96875 C 729.675781 645.96875 734.859375 648.730469 738.292969 654.246094 L 752.726562 642.738281 C 750.234375 638.5 746.46875 635.21875 741.421875 632.898438 C 736.375 630.578125 730.585938 629.414062 724.058594 629.414062 C 715.441406 629.414062 707.769531 631.230469 701.042969 634.867188 C 694.3125 638.5 689.082031 643.546875 685.347656 650.007812 C 681.609375 656.46875 679.742188 663.738281 679.742188 671.8125 C 679.742188 677.9375 681.191406 683.355469 684.085938 688.0625 C 686.976562 692.777344 691.117188 696.425781 696.5 699.015625 C 701.882812 701.605469 708.140625 702.902344 715.277344 702.902344 C 721.871094 702.902344 727.726562 701.875 732.839844 699.824219 C 737.953125 697.773438 742.429688 694.421875 746.265625 689.78125 L 734.457031 678.171875 C 729.675781 683.621094 723.921875 686.347656 717.195312 686.347656"/><path fill="#1DA579" d="M 807.234375 657.277344 L 780.082031 657.277344 L 785.332031 630.828125 L 765.34375 630.828125 L 751.210938 701.488281 L 771.199219 701.488281 L 776.648438 674.03125 L 803.804688 674.03125 L 798.351562 701.488281 L 818.339844 701.488281 L 832.472656 630.828125 L 812.484375 630.828125 Z"/><path fill="#1DA579" d="M 891.929688 674.082031 C 890.109375 677.816406 887.519531 680.796875 884.15625 683.015625 C 880.789062 685.238281 876.886719 686.347656 872.445312 686.347656 C 867.195312 686.347656 863.109375 684.917969 860.179688 682.058594 C 857.253906 679.199219 855.789062 675.378906 855.789062 670.601562 C 855.789062 666.09375 856.699219 661.96875 858.515625 658.234375 C 860.332031 654.5 862.921875 651.519531 866.289062 649.300781 C 869.652344 647.078125 873.554688 645.96875 877.996094 645.96875 C 883.246094 645.96875 887.335938 647.398438 890.261719 650.261719 C 893.191406 653.121094 894.652344 656.9375 894.652344 661.71875 C 894.652344 666.226562 893.746094 670.347656 891.929688 674.082031 M 898.339844 633.351562 C 893.054688 630.726562 886.847656 629.414062 879.714844 629.414062 C 871.167969 629.414062 863.546875 631.230469 856.851562 634.867188 C 850.152344 638.5 844.9375 643.546875 841.203125 650.007812 C 837.46875 656.46875 835.601562 663.734375 835.601562 671.8125 C 835.601562 677.867188 837.03125 683.253906 839.890625 687.964844 C 842.75 692.675781 846.820312 696.339844 852.105469 698.964844 C 857.386719 701.589844 863.597656 702.902344 870.730469 702.902344 C 879.273438 702.902344 886.898438 701.085938 893.59375 697.449219 C 900.289062 693.816406 905.503906 688.769531 909.238281 682.308594 C 912.976562 675.851562 914.84375 668.582031 914.84375 660.507812 C 914.84375 654.449219 913.410156 649.066406 910.550781 644.355469 C 907.691406 639.644531 903.621094 635.976562 898.339844 633.351562"/><path fill="#1DA579" d="M 917.972656 701.488281 L 937.957031 701.488281 L 952.089844 630.828125 L 932.101562 630.828125 Z"/><path fill="#1DA579" d="M 992.667969 686.347656 C 987.351562 686.347656 983.144531 684.902344 980.050781 682.007812 C 976.957031 679.113281 975.40625 675.277344 975.40625 670.5 C 975.40625 665.855469 976.367188 661.667969 978.285156 657.933594 C 980.203125 654.195312 982.878906 651.269531 986.308594 649.148438 C 989.742188 647.03125 993.710938 645.96875 998.222656 645.96875 C 1005.152344 645.96875 1010.335938 648.730469 1013.765625 654.246094 L 1028.203125 642.738281 C 1025.710938 638.5 1021.945312 635.21875 1016.894531 632.898438 C 1011.847656 630.578125 1006.058594 629.414062 999.535156 629.414062 C 990.917969 629.414062 983.246094 631.230469 976.519531 634.867188 C 969.789062 638.5 964.554688 643.546875 960.820312 650.007812 C 957.085938 656.46875 955.21875 663.738281 955.21875 671.8125 C 955.21875 677.9375 956.664062 683.355469 959.558594 688.0625 C 962.453125 692.777344 966.589844 696.425781 971.976562 699.015625 C 977.359375 701.605469 983.617188 702.902344 990.75 702.902344 C 997.347656 702.902344 1003.199219 701.875 1008.316406 699.824219 C 1013.429688 697.773438 1017.90625 694.421875 1021.742188 689.78125 L 1009.929688 678.171875 C 1005.152344 683.621094 999.398438 686.347656 992.667969 686.347656"/><path fill="#1DA579" d="M 1093.007812 646.273438 L 1096.136719 630.828125 L 1040.820312 630.828125 L 1026.6875 701.488281 L 1083.316406 701.488281 L 1086.546875 686.042969 L 1049.5 686.042969 L 1052.023438 673.125 L 1083.519531 673.125 L 1086.445312 658.183594 L 1055.050781 658.183594 L 1057.375 646.273438 Z"/></svg>`;

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);
  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    @Inject(forwardRef(() => LineOaService))
    private lineOaService?: LineOaService,
  ) {}

  /**
   * Generate receipt number: RC-YYYY-MM-NNNNN
   * Uses SELECT FOR UPDATE to prevent race conditions with concurrent payments.
   */
  private async generateReceiptNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx || this.prisma;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `RC-${year}-${month}-`;

    // Use raw query with FOR UPDATE to lock the row and prevent concurrent reads
    // from getting the same sequence number.
    // Schema maps Receipt → "receipts" with column "receipt_number" (snake_case).
    const result = await db.$queryRaw<Array<{ receiptNumber: string }>>`
      SELECT receipt_number AS "receiptNumber" FROM receipts
      WHERE receipt_number LIKE ${prefix + '%'}
      ORDER BY receipt_number DESC
      LIMIT 1
      FOR UPDATE
    `;

    let seq = 1;
    if (result.length > 0) {
      const lastSeq = parseInt(result[0].receiptNumber.replace(prefix, ''));
      seq = lastSeq + 1;
    }

    return `${prefix}${String(seq).padStart(5, '0')}`;
  }

  /**
   * Auto-generate e-Receipt after payment recording.
   * Wrapped in a transaction with FOR UPDATE lock on sequence to prevent
   * duplicate receipt numbers under concurrent payments.
   */
  async generateReceipt(
    contractId: string,
    paymentId: string | null,
    receiptType: string,
    amount: number,
    installmentNo: number | null,
    paymentMethod: string | null,
    transactionRef: string | null,
    issuedById: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: {
          customer: { select: { name: true } },
          payments: { where: { status: 'PAID', deletedAt: null }, select: { amountPaid: true } },
        },
      });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

      // Get company info
      const company = await tx.companyInfo.findFirst({ where: { isActive: true, deletedAt: null } });
      const receiverName = company?.nameTh || 'บริษัท เบสท์ช้อยส์โฟน จำกัด';

      // Calculate remaining balance
      const totalPaid = contract.payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
      const remainingBalance = Number(contract.financedAmount) - totalPaid;
      const totalMonths = contract.totalMonths;
      const paidMonths = contract.payments.length;
      const remainingMonths = totalMonths - paidMonths;

      // Generate receipt number inside transaction (uses FOR UPDATE lock)
      const receiptNumber = await this.generateReceiptNumber(tx);

      // Generate receipt content hash
      const receiptContent = JSON.stringify({
        receiptNumber,
        contractId,
        amount,
        installmentNo,
        paidDate: new Date().toISOString(),
      });
      const fileHash = crypto.createHash('sha256').update(receiptContent).digest('hex');

      const receipt = await tx.receipt.create({
        data: {
          receiptNumber,
          contractId,
          paymentId,
          receiptType,
          payerName: contract.customer?.name || '',
          receiverName,
          amount,
          installmentNo,
          remainingBalance: Math.max(0, remainingBalance),
          remainingMonths: Math.max(0, remainingMonths),
          paymentMethod,
          transactionRef,
          paidDate: new Date(),
          fileHash,
          issuedById,
        },
      });

      // Send receipt via LINE if customer is linked
      if (this.lineOaService) {
        try {
          const customer = await tx.customer.findFirst({
            where: {
              contracts: { some: { id: contractId } },
              lineId: { not: null },
              deletedAt: null
            },
            select: { id: true }
          });

          if (customer) {
            // Send receipt in background (don't wait)
            this.lineOaService.sendPaymentReceipt(customer.id, receipt).catch(err => {
              this.logger.error('[Receipt] Failed to send LINE receipt:', err);
            });
          }
        } catch (error) {
          // Log but don't fail the receipt generation
          this.logger.error('[Receipt] Error checking LINE status:', error);
        }
      }

      return receipt;
    });
  }

  /** List receipts with search, filter, pagination */
  async findAll(filters: {
    search?: string;
    receiptType?: string;
    dateFrom?: string;
    dateTo?: string;
    branchId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 200);
    const where: Prisma.ReceiptWhereInput = { deletedAt: null, isVoided: false };

    if (filters.search) {
      where.OR = [
        { receiptNumber: { contains: filters.search, mode: 'insensitive' } },
        { payerName: { contains: filters.search, mode: 'insensitive' } },
        { contract: { contractNumber: { contains: filters.search, mode: 'insensitive' } } },
        { contract: { customer: { phone: { contains: filters.search } } } },
      ];
    }

    if (filters.receiptType) {
      where.receiptType = filters.receiptType;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.paidDate = {};
      if (filters.dateFrom) {
        where.paidDate.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.paidDate.lte = endDate;
      }
    }

    if (filters.branchId) {
      where.contract = {
        ...(typeof where.contract === 'object' ? where.contract : {}),
        branchId: filters.branchId,
      } as Prisma.ContractWhereInput;
    }

    const [data, total, summary] = await Promise.all([
      this.prisma.receipt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contract: {
            select: {
              contractNumber: true,
              customer: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.receipt.count({ where }),
      this.prisma.receipt.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalAmount: summary._sum.amount || 0,
        totalCount: summary._count,
      },
    };
  }

  /** Get receipts for a contract */
  async getContractReceipts(contractId: string) {
    return this.prisma.receipt.findMany({
      where: { contractId, deletedAt: null, isVoided: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single receipt */
  async getReceipt(id: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: {
              select: {
                name: true,
                phone: true,
                email: true,
                nationalId: true,
                addressIdCard: true,
                addressCurrent: true,
              },
            },
            branch: {
              select: { id: true, name: true, location: true, phone: true },
            },
            product: {
              select: { id: true, name: true, imeiSerial: true, serialNumber: true },
            },
          },
        },
      },
    });
    if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');

    const company = await this.prisma.companyInfo.findFirst({
      where: { isActive: true, deletedAt: null },
      select: {
        nameTh: true,
        nameEn: true,
        taxId: true,
        address: true,
        phone: true,
        logoUrl: true,
        bankName: true,
        bankAccountName: true,
        bankAccountNumber: true,
      },
    });

    const issuer = await this.prisma.user.findUnique({
      where: { id: receipt.issuedById },
      select: { name: true, role: true },
    });

    // Look up the underlying installment to derive partial-payment context
    const payment = receipt.paymentId
      ? await this.prisma.payment.findUnique({
          where: { id: receipt.paymentId },
          select: { amountDue: true, lateFee: true, amountPaid: true, status: true },
        })
      : null;

    return { ...receipt, company, issuer, payment };
  }

  /** Get receipt by number */
  async getReceiptByNumber(receiptNumber: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { receiptNumber },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true } },
            branch: {
              select: {
                id: true,
                name: true,
                location: true,
                phone: true,
              },
            },
            product: {
              select: {
                id: true,
                name: true,
                imeiSerial: true,
                serialNumber: true,
              },
            },
          },
        },
      },
    });
    if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');

    // Get company info
    const company = await this.prisma.companyInfo.findFirst({
      where: { isActive: true, deletedAt: null },
      select: {
        nameTh: true,
        nameEn: true,
        taxId: true,
        address: true,
        phone: true,
        logoUrl: true,
      },
    });

    return { ...receipt, company };
  }

  /**
   * Void a receipt (ถ้าผิด → ออกใบลดหนี้/ใบแก้ไขแทน)
   * ใบเสร็จที่ออกแล้วห้ามแก้ไข/ลบ
   */
  async voidReceipt(id: string, reason: string, issuedById: string, approvedById: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลในการยกเลิก');
    }
    // CR-7: Validate void date is not in a closed accounting period
    await validatePeriodOpen(this.prisma, new Date());
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({ where: { id } });
      if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');
      if (receipt.isVoided) throw new BadRequestException('ใบเสร็จนี้ถูกยกเลิกแล้ว');

      // W-006: Credit Note 30-day time limit
      const daysSinceIssue = Math.floor(
        (Date.now() - receipt.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceIssue > 30) {
        throw new BadRequestException('ไม่สามารถยกเลิกใบเสร็จที่ออกเกิน 30 วัน');
      }

      // Generate credit note number inside transaction (uses FOR UPDATE lock)
      const creditNoteNumber = await this.generateReceiptNumber(tx);
      const creditNote = await tx.receipt.create({
        data: {
          receiptNumber: creditNoteNumber,
          contractId: receipt.contractId,
          paymentId: receipt.paymentId,
          receiptType: 'CREDIT_NOTE',
          payerName: receipt.payerName,
          receiverName: receipt.receiverName,
          amount: receipt.amount,
          installmentNo: receipt.installmentNo,
          paymentMethod: receipt.paymentMethod,
          paidDate: new Date(),
          voidedReceiptId: receipt.id,
          issuedById,
        },
      });

      // Mark original as voided with approval trail
      await tx.receipt.update({
        where: { id },
        data: {
          isVoided: true,
          voidReason: reason.trim(),
          voidApprovedById: approvedById,
          voidApprovedAt: new Date(),
        },
      });

      // Auto journal — create reversal entry for the original payment
      if (receipt.paymentId) {
        try {
          // Find the original journal entry by payment reference
          const originalEntry = await tx.journalEntry.findFirst({
            where: {
              referenceType: 'PAYMENT',
              referenceId: receipt.paymentId,
              status: 'POSTED',
              deletedAt: null,
            },
          });
          if (originalEntry) {
            await this.journalAutoService.createReversalJournal(tx, {
              originalEntryId: originalEntry.id,
              reason: reason.trim(),
              userId: issuedById,
            });
          }
        } catch (err) {
          this.logger.error(`Auto-reversal failed for receipt ${id}: ${err}`);
        }
      }

      return { voidedReceipt: receipt, creditNote };
    });
  }

  /** Escape HTML special characters to prevent XSS in PDF templates */
  private escapeHtml(text: string | null | undefined): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** Convert a non-negative number to its Thai-baht spelling. e.g. 1926 → "หนึ่งพันเก้าร้อยยี่สิบหกบาทถ้วน" */
  private numberToThaiText(num: number): string {
    if (num === 0) return 'ศูนย์บาทถ้วน';

    const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
    const places = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

    const readGroup = (n: number): string => {
      if (n === 0) return '';
      let s = '';
      const str = String(Math.floor(n));
      const len = str.length;
      for (let i = 0; i < len; i++) {
        const d = parseInt(str[i]);
        const place = len - i - 1;
        if (d === 0) continue;
        if (place === 1 && d === 1) {
          s += 'สิบ';
        } else if (place === 1 && d === 2) {
          s += 'ยี่สิบ';
        } else if (place === 0 && d === 1 && len > 1) {
          s += 'เอ็ด';
        } else {
          s += digits[d] + places[place];
        }
      }
      return s;
    };

    let text = '';
    let remaining = Math.floor(num);
    if (remaining >= 1000000) {
      const millions = Math.floor(remaining / 1000000);
      text += readGroup(millions) + 'ล้าน';
      remaining = remaining - millions * 1000000;
    }
    if (remaining > 0) text += readGroup(remaining);
    text += 'บาท';

    const satang = Math.round((num - Math.floor(num)) * 100);
    if (satang === 0) {
      text += 'ถ้วน';
    } else {
      text += readGroup(satang) + 'สตางค์';
    }
    return text;
  }

  /**
   * Generate the e-Receipt PDF using Puppeteer + the Thai tax-invoice layout.
   * The HTML template is intentionally inlined (no external assets) so the
   * renderer works in air-gapped Cloud Run revisions and offline tests.
   */
  async generatePDF(id: string): Promise<Buffer> {
    const receipt = await this.getReceipt(id);

    // Payment method labels (matches Prisma PaymentMethod enum)
    const methodLabels: Record<string, string> = {
      CASH: 'เงินสด',
      BANK_TRANSFER: 'โอนเงินผ่านธนาคาร',
      QR_EWALLET: 'QR / e-Wallet',
      CREDIT_BALANCE: 'ใช้ยอดเครดิตในสัญญา',
      ONLINE_GATEWAY: 'ชำระออนไลน์',
    };

    const customer = receipt.contract?.customer;
    const safe = {
      companyName: this.escapeHtml(receipt.company?.nameTh) || 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      companyAddress: this.escapeHtml(receipt.company?.address),
      companyPhone: this.escapeHtml(receipt.company?.phone),
      taxId: this.escapeHtml(receipt.company?.taxId),
      payerName: this.escapeHtml(receipt.payerName),
      payerAddress:
        this.escapeHtml(receipt.payerAddress) ||
        this.escapeHtml(customer?.addressIdCard) ||
        this.escapeHtml(customer?.addressCurrent),
      payerTaxId: this.escapeHtml(receipt.payerTaxId) || this.escapeHtml(customer?.nationalId),
      customerPhone: this.escapeHtml(customer?.phone),
      customerEmail: this.escapeHtml(customer?.email),
      contractNumber: this.escapeHtml(receipt.contract?.contractNumber),
      productName: this.escapeHtml(receipt.contract?.product?.name),
      imeiSerial: this.escapeHtml(receipt.contract?.product?.imeiSerial),
      serialNumber: this.escapeHtml(receipt.contract?.product?.serialNumber),
      branchName: this.escapeHtml(receipt.contract?.branch?.name),
      branchPhone: this.escapeHtml(receipt.contract?.branch?.phone),
      receiptNumber: this.escapeHtml(receipt.receiptNumber),
      paymentMethodLabel: methodLabels[receipt.paymentMethod ?? ''] ?? this.escapeHtml(receipt.paymentMethod),
      transactionRef: this.escapeHtml(receipt.transactionRef),
      bankName: this.escapeHtml(receipt.company?.bankName),
      bankAccountName: this.escapeHtml(receipt.company?.bankAccountName),
      bankAccountNumber: this.escapeHtml(receipt.company?.bankAccountNumber),
      issuerName: this.escapeHtml(receipt.issuer?.name) || 'ระบบอัตโนมัติ',
      issuerSignName:
        this.escapeHtml((receipt.issuer?.name || '').split(/\s+/)[0]) || 'ระบบ',
    };

    const total = Number(receipt.amount);
    const amountBeforeVat = receipt.amountBeforeVat ? Number(receipt.amountBeforeVat) : null;
    const vatAmount = receipt.vatAmount ? Number(receipt.vatAmount) : null;
    const totalDue = receipt.payment
      ? Number(receipt.payment.amountDue) + Number(receipt.payment.lateFee)
      : null;
    const totalPaidOnInstallment = receipt.payment ? Number(receipt.payment.amountPaid) : null;
    const isPartial = receipt.payment?.status === 'PARTIALLY_PAID';
    const remainingBalance = Number(receipt.remainingBalance || 0);
    const fmt = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const thaiAmount = this.numberToThaiText(total);
    const paidDateStr = formatDateShort(receipt.paidDate);

    const verifyUrl = `https://bestchoicephone.app/r/${receipt.receiptNumber}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 0,
      width: 260,
      color: { dark: '#18181b', light: '#ffffff' },
    });

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    const html = `
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Sriracha&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --emerald-50:#ecfdf5; --emerald-100:#d1fae5; --emerald-700:#047857; --emerald-800:#065f46;
      --zinc-200:#e4e4e7; --zinc-300:#d4d4d8; --zinc-400:#a1a1aa; --zinc-500:#71717a; --zinc-600:#52525b; --zinc-700:#3f3f46; --zinc-900:#18181b;
      --red-500:#ef4444;
    }
    body {
      font-family: 'IBM Plex Sans Thai', sans-serif;
      color: var(--zinc-900);
      font-size: 10pt;
      line-height: 1.55;
      padding: 14mm 14mm 12mm;
    }
    .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:14px; border-bottom:1.5px solid var(--zinc-300); }
    .logo-block svg { height: 38px; width: auto; }
    .doc-title { font-size:24pt; font-weight:700; color:var(--emerald-700); line-height:1; text-align:right; letter-spacing:-0.01em; }

    .parties { display:grid; grid-template-columns: minmax(0, 1fr) 240px; gap:18px; padding:16px 0; border-bottom:1px solid var(--zinc-200); margin-bottom:18px; }
    .party-row { display:grid; grid-template-columns: 78px 1fr; gap:6px; margin-bottom:4px; align-items:start; font-size:9.5pt; }
    .party-label { color:var(--zinc-900); font-weight:700; white-space:nowrap; }
    .party-name { font-weight:600; }
    .party-divider { margin:10px 0; border:0; border-top:1px solid var(--zinc-200); }
    .meta-card { background:var(--emerald-50); border:1px solid var(--emerald-100); border-radius:6px; padding:10px 14px; font-size:9pt; align-self:start; }
    .meta-row { display:flex; justify-content:space-between; padding:3px 0; }
    .meta-label { color:var(--emerald-800); font-weight:600; }
    .meta-value { color:var(--zinc-900); font-family:'IBM Plex Mono',monospace; font-size:8.5pt; font-weight:500; }
    .contact-info { margin-top:14px; font-size:9pt; }
    .contact-info .heading { color:var(--zinc-700); margin-bottom:4px; }
    .icon-line { display:grid; grid-template-columns:16px 1fr; gap:6px; align-items:start; color:var(--zinc-700); font-size:9pt; margin-top:2px; }
    .icon-line svg { width:11px; height:11px; color:var(--zinc-500); margin-top:3px; }

    table.items { width:100%; border-collapse:collapse; font-size:9.5pt; }
    table.items thead th { text-align:left; padding:8px; background:var(--emerald-50); color:var(--emerald-800); font-size:9pt; font-weight:600; border-bottom:1.5px solid var(--emerald-700); }
    table.items thead th.right { text-align:right; }
    table.items tbody td { padding:10px 8px; border-bottom:1px solid var(--zinc-200); vertical-align:top; font-variant-numeric:tabular-nums; }
    table.items tbody td.right { text-align:right; }
    table.items td.no { color:var(--zinc-500); width:22px; }
    .item-name { font-weight:600; }
    .item-code { color:var(--zinc-500); font-weight:500; }
    .item-meta { color:var(--zinc-500); font-size:8.5pt; margin-top:2px; }

    .partial-tag { display:block; margin:8px 0 0; color:var(--emerald-700); font-size:9pt; padding:4px 0 14px; border-bottom:1px solid var(--zinc-200); margin-bottom:18px; }

    .summary { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding-bottom:16px; margin-bottom:16px; border-bottom:1px solid var(--zinc-200); }
    .summary-section { display:grid; grid-template-columns:18px 1fr; gap:8px; align-items:start; }
    .summary-section .icon { width:16px; height:16px; color:var(--zinc-700); margin-top:2px; }
    .breakdown { display:grid; grid-template-columns:max-content 1fr auto; column-gap:18px; row-gap:4px; font-size:9.5pt; }
    .breakdown .label { color:var(--zinc-700); }
    .breakdown .label.bold { font-weight:600; color:var(--zinc-900); }
    .breakdown .text { color:var(--zinc-600); font-style:italic; font-size:9pt; }
    .breakdown .num { text-align:right; font-variant-numeric:tabular-nums; color:var(--zinc-900); }
    .grand-card { background:var(--emerald-50); border-radius:8px; padding:12px 16px; text-align:center; }
    .grand-card .label { color:var(--emerald-800); font-size:9.5pt; font-weight:600; margin-bottom:4px; }
    .grand-card .amount { color:var(--emerald-700); font-size:22pt; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }
    .grand-card .amount-suffix { color:var(--emerald-700); font-size:12pt; font-weight:500; margin-left:4px; }
    .summary-aux { margin-top:10px; display:grid; grid-template-columns:1fr auto; row-gap:4px; column-gap:18px; font-size:9.5pt; }
    .summary-aux .label { color:var(--zinc-700); }
    .summary-aux .num { text-align:right; font-variant-numeric:tabular-nums; }

    .pay-section { padding-bottom:16px; margin-bottom:16px; border-bottom:1px solid var(--zinc-200); }
    .sec-title { display:flex; align-items:center; gap:8px; font-size:10pt; font-weight:700; color:var(--zinc-900); margin-bottom:6px; }
    .sec-title .icon-pill { width:22px; height:22px; background:var(--zinc-900); color:#fff; border-radius:6px; display:flex; align-items:center; justify-content:center; }
    .sec-title .icon-pill svg { width:13px; height:13px; }
    .pay-row { display:grid; grid-template-columns:200px 18px 1fr auto; gap:8px; align-items:start; padding:4px 0; font-size:9.5pt; }
    .pay-row .head { display:grid; grid-template-columns:70px 1fr; gap:6px; }
    .pay-row .head .label { color:var(--zinc-700); }
    .pay-row .head .value { color:var(--zinc-900); font-weight:500; font-variant-numeric:tabular-nums; }
    .check-icon { width:14px; height:14px; border-radius:50%; background:var(--emerald-50); color:var(--emerald-700); display:flex; align-items:center; justify-content:center; margin-top:2px; }
    .check-icon svg { width:10px; height:10px; }
    .bank-info .name { font-weight:600; }
    .bank-info .acct { font-weight:500; color:var(--zinc-700); }
    .bank-info .holder { color:var(--zinc-500); font-size:9pt; }
    .pay-row .num { text-align:right; font-variant-numeric:tabular-nums; }

    .notes-section { padding-bottom:16px; margin-bottom:18px; font-size:9.5pt; border-bottom:1px solid var(--zinc-200); }
    .notes-section .body { color:var(--zinc-600); min-height:16px; }

    .approval { display:grid; grid-template-columns:100px 1fr 1fr; gap:24px; align-items:start; margin-top:4px; }
    .approval-label { display:flex; align-items:center; gap:6px; font-size:10.5pt; font-weight:700; color:var(--zinc-900); padding-top:2px; }
    .approval-label svg { width:14px; height:14px; color:var(--zinc-700); }
    .qr-pane { text-align:center; }
    .qr-caption-top { font-size:9.5pt; color:var(--zinc-700); margin-bottom:6px; }
    .qr-pane img { width:130px; height:130px; }
    .sig-block { text-align:left; }
    .sig-role { font-size:10pt; color:var(--zinc-900); font-weight:600; margin-bottom:4px; }
    .sig-handwriting { font-family:'Sriracha',cursive; font-size:28pt; color:var(--zinc-600); line-height:1; transform:rotate(-3deg); transform-origin:left center; display:inline-block; opacity:0.85; margin-top:6px; }
    .sig-rule { width:220px; border-top:1px dotted var(--zinc-300); margin:22px 0 8px; }
    .sig-name { font-size:11pt; font-weight:700; color:var(--zinc-900); }
    .sig-date { font-size:9.5pt; color:var(--zinc-500); margin-top:2px; font-variant-numeric:tabular-nums; }

    .void-overlay { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-15deg); font-size:80pt; font-weight:900; color:rgba(220,38,38,0.18); letter-spacing:0.1em; pointer-events:none; }
  </style>
</head>
<body>
  ${receipt.isVoided ? `<div class="void-overlay">VOID / ยกเลิก</div>` : ''}

  <!-- Header: Logo + Title -->
  <div class="header">
    <div class="logo-block">${BESTCHOICE_LOGO_SVG}</div>
    <div class="doc-title">ใบเสร็จรับเงิน/ใบกำกับภาษี</div>
  </div>

  <!-- Parties + meta -->
  <div class="parties">
    <div>
      <div class="party-row"><span class="party-label">ผู้ขาย :</span><span class="party-name">${safe.companyName}</span></div>
      ${safe.companyAddress ? `<div class="party-row"><span class="party-label">ที่อยู่ :</span><span>${safe.companyAddress}</span></div>` : ''}
      ${safe.taxId ? `<div class="party-row"><span class="party-label">เลขที่ภาษี :</span><span>${safe.taxId}</span></div>` : ''}

      <hr class="party-divider"/>

      <div class="party-row"><span class="party-label">ลูกค้า :</span><span class="party-name">${safe.payerName}</span></div>
      ${safe.payerAddress ? `<div class="party-row"><span class="party-label">ที่อยู่ :</span><span>${safe.payerAddress}</span></div>` : ''}
      ${safe.payerTaxId ? `<div class="party-row"><span class="party-label">เลขที่ภาษี :</span><span>${safe.payerTaxId}</span></div>` : ''}
    </div>
    <div>
      <div class="meta-card">
        <div class="meta-row"><span class="meta-label">เลขที่เอกสาร :</span><span class="meta-value">${safe.receiptNumber}</span></div>
        <div class="meta-row"><span class="meta-label">วันที่ออก :</span><span class="meta-value">${paidDateStr}</span></div>
        ${safe.contractNumber ? `<div class="meta-row"><span class="meta-label">อ้างอิง :</span><span class="meta-value">${safe.contractNumber}</span></div>` : ''}
      </div>
      ${(safe.customerPhone || safe.customerEmail) ? `
        <div class="contact-info">
          <div class="heading">ติดต่อลูกค้า :</div>
          ${safe.customerPhone ? `
            <div class="icon-line">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span>${safe.customerPhone}</span>
            </div>` : ''}
          ${safe.customerEmail ? `
            <div class="icon-line">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              <span>${safe.customerEmail}</span>
            </div>` : ''}
        </div>` : ''}
    </div>
  </div>

  <!-- Items table -->
  <table class="items">
    <thead>
      <tr>
        <th></th>
        <th>คำอธิบาย</th>
        <th class="right">จำนวน</th>
        <th class="right">ราคา</th>
        <th class="right">ส่วนลด</th>
        <th class="right">VAT</th>
        <th class="right">มูลค่าก่อนภาษี</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="no">1.</td>
        <td>
          <div><span class="item-name">${receipt.installmentNo ? `ค่างวดผ่อนชำระ งวดที่ ${receipt.installmentNo}` : 'การชำระเงิน'}</span></div>
          ${safe.productName ? `<div class="item-meta">${safe.productName}${safe.imeiSerial ? ` &nbsp; IMEI ${safe.imeiSerial}` : (safe.serialNumber ? ` &nbsp; S/N ${safe.serialNumber}` : '')}</div>` : ''}
        </td>
        <td class="right">1.00</td>
        <td class="right">${fmt(total)}</td>
        <td class="right">0.00</td>
        <td class="right">${vatAmount !== null ? '7%' : '-'}</td>
        <td class="right">${amountBeforeVat !== null ? fmt(amountBeforeVat) : fmt(total)}</td>
      </tr>
    </tbody>
  </table>

  ${isPartial && totalDue !== null && totalPaidOnInstallment !== null
    ? `<div class="partial-tag">ชำระเงินบางส่วน ยอด ${fmt(totalPaidOnInstallment)} / ${fmt(totalDue)} บาท</div>`
    : '<div style="margin-bottom:18px; padding-bottom:14px; border-bottom:1px solid var(--zinc-200);"></div>'}

  <!-- Summary -->
  <div class="summary">
    <div>
      <div class="summary-section">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
        <div>
          <div style="font-weight:700; margin-bottom:4px;">สรุป</div>
          <div class="breakdown">
            ${amountBeforeVat !== null && vatAmount !== null ? `
              <span class="label">มูลค่าที่คำนวณภาษี 7%</span><span></span><span class="num">${fmt(amountBeforeVat)} บาท</span>
              <span class="label">ภาษีมูลค่าเพิ่ม 7%</span><span></span><span class="num">${fmt(vatAmount)} บาท</span>
            ` : ''}
            <span class="label bold">จำนวนเงินทั้งสิ้น</span>
            <span class="text">${thaiAmount}</span>
            <span></span>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div class="grand-card">
        <div class="label">จำนวนเงินทั้งสิ้น</div>
        <div class="amount">${fmt(total)}<span class="amount-suffix">บาท</span></div>
      </div>
      <div class="summary-aux">
        <span class="label">จำนวนเงินที่ถูกหัก ณ ที่จ่าย</span><span class="num">0.00 บาท</span>
        <span class="label">จำนวนเงินที่ชำระ</span><span class="num"><strong>${fmt(total)} บาท</strong></span>
      </div>
    </div>
  </div>

  <!-- Payment section -->
  <div class="pay-section">
    <div class="sec-title">
      <span class="icon-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg></span>
      <span>ชำระเงิน</span>
    </div>
    <div class="pay-row">
      <div class="head">
        <span class="label">วันที่ชำระ :</span><span class="value">${paidDateStr}</span>
        <span class="label">ช่องทาง :</span><span class="value">${safe.paymentMethodLabel || '-'}</span>
      </div>
      <span class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20,6 9,17 4,12"/></svg></span>
      <div class="bank-info">
        ${safe.bankName ? `
          <div class="name">${safe.bankName}</div>
          ${safe.bankAccountNumber ? `<div class="acct">เลขบัญชี ${safe.bankAccountNumber}</div>` : ''}
          ${safe.bankAccountName ? `<div class="holder">${safe.bankAccountName}</div>` : ''}
        ` : `<div class="name">${safe.paymentMethodLabel || '-'}</div>`}
        ${safe.transactionRef ? `<div class="holder">อ้างอิง ${safe.transactionRef}</div>` : ''}
      </div>
      <span class="num">${fmt(total)} บาท</span>
    </div>

    ${remainingBalance > 0 ? `
      <div class="pay-row" style="margin-top:8px;">
        <div class="head">
          <span class="label">ยอดคงเหลือ :</span><span class="value">${fmt(remainingBalance)} บาท</span>
          ${receipt.remainingMonths ? `<span class="label">งวดที่เหลือ :</span><span class="value">${receipt.remainingMonths} งวด</span>` : '<span></span><span></span>'}
        </div>
        <span></span><span></span><span></span>
      </div>
    ` : ''}
  </div>

  <!-- Notes -->
  <div class="notes-section">
    <div class="sec-title">
      <span class="icon-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
      <span>หมายเหตุ</span>
    </div>
    <div class="body">&nbsp;</div>
  </div>

  <!-- Approval (3-col) -->
  <div class="approval">
    <div class="approval-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c2-3 4-3.5 7-1.5s5 1.5 7-1.5"/><path d="M5 17c2-1 4-1 5 1"/><path d="M14 14c-1.5-2-1-4 1-5s3 0 4 2"/></svg>
      <span>รับรอง</span>
    </div>
    <div class="qr-pane">
      <div class="qr-caption-top">สแกนเพื่อเปิดด้วยเว็บไซต์</div>
      <img src="${qrDataUrl}" alt="QR"/>
    </div>
    <div class="sig-block">
      <div class="sig-role">ผู้ออกใบเสร็จรับเงิน</div>
      <div class="sig-handwriting">${safe.issuerSignName}</div>
      <div class="sig-rule"></div>
      <div class="sig-name">${safe.issuerName}</div>
      <div class="sig-date">${paidDateStr}</div>
    </div>
  </div>
</body>
</html>`;

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();
    return Buffer.from(pdf);
  }
}
