import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchReceivingDto } from './dto/branch-receiving.dto';

@Injectable()
export class BranchReceivingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Branch receives products from transfer (Step 6: สาขาเช็ครับสินค้า)
   * - เช็คจำนวนตรง
   * - สแกน IMEI ยืนยัน
   * - เช็คสภาพ + ถ่ายรูป
   * - PASS → สินค้าย้ายไปสาขา
   * - REJECT → แจ้ง reject กลับคลัง
   */
  async receive(dto: CreateBranchReceivingDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Validate transfer exists and is IN_TRANSIT
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: dto.transferId },
        select: {
          id: true, status: true, productId: true, fromBranchId: true, toBranchId: true,
          product: { select: { id: true, name: true, imeiSerial: true, brand: true, model: true } },
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          branchReceiving: true,
        },
      });

      if (!transfer) throw new NotFoundException('ไม่พบรายการโอน');
      if (transfer.status !== 'IN_TRANSIT') {
        throw new BadRequestException('รายการโอนนี้ไม่ได้อยู่ในสถานะกำลังจัดส่ง (IN_TRANSIT) ต้องจัดส่งก่อนถึงจะรับได้');
      }
      if (transfer.branchReceiving) {
        throw new BadRequestException('รายการโอนนี้ถูกตรวจรับไปแล้ว');
      }

      // Validate IMEI matches if product has IMEI
      for (const item of dto.items) {
        if (item.productId !== transfer.productId) {
          throw new BadRequestException(`สินค้า ${item.productId} ไม่ตรงกับรายการโอน (ต้องเป็น ${transfer.productId})`);
        }

        // IMEI verification
        if (transfer.product.imeiSerial && item.imeiSerial) {
          if (item.imeiSerial !== transfer.product.imeiSerial) {
            throw new BadRequestException(
              `IMEI ไม่ตรง: สแกนได้ ${item.imeiSerial} แต่ในระบบเป็น ${transfer.product.imeiSerial}`,
            );
          }
        }
      }

      // Create branch receiving record
      const receiving = await tx.branchReceiving.create({
        data: {
          transferId: dto.transferId,
          receivedById: userId,
          notes: dto.notes,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              imeiSerial: item.imeiSerial,
              status: item.status,
              conditionNotes: item.conditionNotes,
              photos: item.photos || [],
              rejectReason: item.rejectReason,
            })),
          },
        },
        include: {
          items: true,
          receivedBy: { select: { id: true, name: true } },
        },
      });

      // Check if all items passed
      const allPassed = dto.items.every((item) => item.status === 'PASS');
      const allRejected = dto.items.every((item) => item.status === 'REJECT');
      const anyRejected = dto.items.some((item) => item.status === 'REJECT');

      // Update receiving status
      const receivingStatus = allPassed ? 'COMPLETED' : allRejected ? 'REJECTED' : 'PARTIAL_REJECT';
      await tx.branchReceiving.update({
        where: { id: receiving.id },
        data: { status: receivingStatus },
      });

      if (allPassed) {
        // All items passed → confirm transfer, move product to branch
        await tx.stockTransfer.update({
          where: { id: dto.transferId },
          data: {
            status: 'CONFIRMED',
            confirmedById: userId,
            confirmedAt: new Date(),
          },
        });

        await tx.product.update({
          where: { id: transfer.productId },
          data: { branchId: transfer.toBranchId },
        });
      } else if (anyRejected) {
        // Some/all items rejected → reject transfer, product stays at source
        await tx.stockTransfer.update({
          where: { id: dto.transferId },
          data: {
            status: 'REJECTED',
            confirmedById: userId,
            confirmedAt: new Date(),
            trackingNote: `REJECTED at branch: ${dto.items.filter((i) => i.status === 'REJECT').map((i) => i.rejectReason).filter(Boolean).join(', ')}`,
          },
        });
      }

      return {
        receivingId: receiving.id,
        transferId: dto.transferId,
        status: receivingStatus,
        passed: dto.items.filter((i) => i.status === 'PASS').length,
        rejected: dto.items.filter((i) => i.status === 'REJECT').length,
        productMoved: allPassed,
        toBranch: transfer.toBranch.name,
      };
    });
  }

  /**
   * Get branch receiving history
   */
  async findAll(filters: {
    branchId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;

    // Filter by branch via transfer relation
    if (filters.branchId) {
      where.transfer = { toBranchId: filters.branchId };
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.branchReceiving.findMany({
        where,
        include: {
          transfer: {
            select: {
              id: true, batchNumber: true, status: true, createdAt: true, notes: true,
              productId: true, fromBranchId: true, toBranchId: true, transferredBy: true,
              product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, photos: true } },
              fromBranch: { select: { id: true, name: true } },
              toBranch: { select: { id: true, name: true } },
            },
          },
          receivedBy: { select: { id: true, name: true } },
          items: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branchReceiving.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const receiving = await this.prisma.branchReceiving.findUnique({
      where: { id },
      include: {
        transfer: {
          select: {
            id: true, batchNumber: true, status: true, createdAt: true, notes: true,
            productId: true, fromBranchId: true, toBranchId: true, transferredBy: true,
            product: {
              select: {
                id: true, name: true, brand: true, model: true,
                imeiSerial: true, serialNumber: true, color: true,
                storage: true, costPrice: true, photos: true, status: true,
              },
            },
            fromBranch: { select: { id: true, name: true } },
            toBranch: { select: { id: true, name: true } },
          },
        },
        receivedBy: { select: { id: true, name: true } },
        items: true,
      },
    });

    if (!receiving) throw new NotFoundException('ไม่พบรายการตรวจรับสาขา');
    return receiving;
  }

  /**
   * Get pending deliveries for a branch (transfers that are IN_TRANSIT to this branch)
   */
  async getPendingDeliveries(branchId: string) {
    return this.prisma.stockTransfer.findMany({
      where: {
        toBranchId: branchId,
        status: 'IN_TRANSIT',
      },
      select: {
        id: true, batchNumber: true, status: true, createdAt: true, notes: true,
        productId: true, fromBranchId: true, toBranchId: true, transferredBy: true,
        dispatchedAt: true, trackingNote: true, expectedDeliveryDate: true,
        product: {
          select: {
            id: true, name: true, brand: true, model: true,
            imeiSerial: true, serialNumber: true, color: true,
            storage: true, photos: true,
          },
        },
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        dispatchedBy: { select: { id: true, name: true } },
      },
      orderBy: { dispatchedAt: 'asc' },
    });
  }
}
