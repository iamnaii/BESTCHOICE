import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReorderPointDto, UpdateReorderPointDto } from './dto/reorder-point.dto';

@Injectable()
export class ReorderPointsService {
  private readonly logger = new Logger(ReorderPointsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async findAll(filters: { branchId?: string; isActive?: boolean; category?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.category) where.category = filters.category;

    const reorderPoints = await this.prisma.reorderPoint.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ brand: 'asc' }, { model: 'asc' }],
    });

    // Enrich with current stock count
    const enriched = await Promise.all(
      reorderPoints.map(async (rp) => {
        const currentStock = await this.prisma.product.count({
          where: {
            brand: rp.brand,
            model: rp.model,
            ...(rp.storage ? { storage: rp.storage } : {}),
            category: rp.category,
            branchId: rp.branchId,
            status: 'IN_STOCK',
            deletedAt: null,
          },
        });
        return { ...rp, currentStock, isLow: currentStock <= rp.minQuantity };
      }),
    );

    return enriched;
  }

  async findOne(id: string) {
    const rp = await this.prisma.reorderPoint.findUnique({
      where: { id },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!rp) throw new NotFoundException('ไม่พบข้อมูล Reorder Point');
    return rp;
  }

  async create(dto: CreateReorderPointDto) {
    // Check for duplicate
    const existing = await this.prisma.reorderPoint.findFirst({
      where: {
        brand: dto.brand,
        model: dto.model,
        storage: dto.storage || null,
        category: dto.category as any,
        branchId: dto.branchId,
      },
    });
    if (existing) {
      throw new BadRequestException('มี Reorder Point สำหรับสินค้านี้ในสาขานี้อยู่แล้ว');
    }

    // Verify branch exists
    const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('ไม่พบสาขา');

    return this.prisma.reorderPoint.create({
      data: {
        brand: dto.brand,
        model: dto.model,
        storage: dto.storage || null,
        category: dto.category as any,
        branchId: dto.branchId,
        minQuantity: dto.minQuantity,
        reorderQuantity: dto.reorderQuantity,
      },
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async update(id: string, dto: UpdateReorderPointDto) {
    await this.findOne(id);
    return this.prisma.reorderPoint.update({
      where: { id },
      data: dto,
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.reorderPoint.delete({ where: { id } });
    return { message: 'ลบ Reorder Point สำเร็จ' };
  }

  // === Stock Check & Alert ===

  /**
   * Check all active reorder points and create alerts for low stock
   * Called by cron job daily or after sales
   */
  async checkStockLevels(): Promise<{ alertsCreated: number; notificationsSent: number }> {
    const activeReorderPoints = await this.prisma.reorderPoint.findMany({
      where: { isActive: true },
      include: { branch: { select: { id: true, name: true } } },
    });

    let alertsCreated = 0;
    let notificationsSent = 0;

    for (const rp of activeReorderPoints) {
      const currentStock = await this.prisma.product.count({
        where: {
          brand: rp.brand,
          model: rp.model,
          ...(rp.storage ? { storage: rp.storage } : {}),
          category: rp.category,
          branchId: rp.branchId,
          status: 'IN_STOCK',
          deletedAt: null,
        },
      });

      if (currentStock <= rp.minQuantity) {
        // Check if there's already an active alert for this reorder point
        const existingAlert = await this.prisma.stockAlert.findFirst({
          where: {
            reorderPointId: rp.id,
            status: 'ACTIVE',
          },
        });

        if (!existingAlert) {
          // Create new alert
          await this.prisma.stockAlert.create({
            data: {
              reorderPointId: rp.id,
              brand: rp.brand,
              model: rp.model,
              storage: rp.storage,
              category: rp.category as string,
              branchId: rp.branchId,
              currentStock,
              minQuantity: rp.minQuantity,
              reorderQuantity: rp.reorderQuantity,
              status: 'ACTIVE',
            },
          });
          alertsCreated++;

          // Send notifications to Owner + Branch Manager
          const productDesc = [rp.brand, rp.model, rp.storage].filter(Boolean).join(' ');
          const message = `แจ้งเตือน Stock ต่ำ\nสินค้า: ${productDesc}\nสาขา: ${rp.branch.name}\nคงเหลือ: ${currentStock} เครื่อง (ขั้นต่ำ: ${rp.minQuantity})\nแนะนำสั่ง: ${rp.reorderQuantity} เครื่อง\nกรุณาสร้าง PO สั่งซื้อ`;

          // Notify Owner(s) via IN_APP
          const owners = await this.prisma.user.findMany({
            where: { role: 'OWNER', isActive: true },
            select: { email: true, name: true },
          });
          for (const owner of owners) {
            await this.notificationsService.send({
              channel: 'IN_APP',
              recipient: owner.email,
              subject: `Stock ต่ำ: ${productDesc} (${rp.branch.name})`,
              message,
              relatedId: rp.id,
            });
            notificationsSent++;
          }

          // Notify Branch Manager(s) via IN_APP + LINE
          const branchManagers = await this.prisma.user.findMany({
            where: { role: 'BRANCH_MANAGER', branchId: rp.branchId, isActive: true },
            select: { email: true, name: true },
          });
          for (const manager of branchManagers) {
            await this.notificationsService.send({
              channel: 'IN_APP',
              recipient: manager.email,
              subject: `Stock ต่ำ: ${productDesc}`,
              message,
              relatedId: rp.id,
            });
            notificationsSent++;
          }

          // Also try LINE notification to owners
          for (const owner of owners) {
            try {
              await this.notificationsService.send({
                channel: 'LINE',
                recipient: owner.email,
                message,
                relatedId: rp.id,
              });
              notificationsSent++;
            } catch {
              // LINE may not be configured, skip silently
            }
          }
        }
      }
    }

    this.logger.log(`Stock check complete: ${alertsCreated} alerts created, ${notificationsSent} notifications sent`);
    return { alertsCreated, notificationsSent };
  }

  // === Stock Alerts Management ===

  async getActiveAlerts(branchId?: string) {
    const where: Record<string, unknown> = { status: 'ACTIVE' };
    if (branchId) where.branchId = branchId;

    return this.prisma.stockAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllAlerts(filters: {
    status?: string;
    branchId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.branchId) where.branchId = filters.branchId;

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.stockAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockAlert.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async resolveAlert(alertId: string, poId?: string) {
    const alert = await this.prisma.stockAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('ไม่พบ Stock Alert');

    return this.prisma.stockAlert.update({
      where: { id: alertId },
      data: {
        status: poId ? 'PO_CREATED' : 'RESOLVED',
        poId: poId || null,
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Get low stock items for dashboard (สินค้าที่ต้องสั่ง)
   */
  async getLowStockDashboard(branchId?: string) {
    const where: Record<string, unknown> = { isActive: true };
    if (branchId) where.branchId = branchId;

    const reorderPoints = await this.prisma.reorderPoint.findMany({
      where,
      include: { branch: { select: { id: true, name: true } } },
    });

    const lowStockItems: {
      reorderPointId: string;
      brand: string;
      model: string;
      storage: string | null;
      category: string;
      branch: { id: string; name: string };
      currentStock: number;
      minQuantity: number;
      reorderQuantity: number;
      hasActiveAlert: boolean;
    }[] = [];

    for (const rp of reorderPoints) {
      const currentStock = await this.prisma.product.count({
        where: {
          brand: rp.brand,
          model: rp.model,
          ...(rp.storage ? { storage: rp.storage } : {}),
          category: rp.category,
          branchId: rp.branchId,
          status: 'IN_STOCK',
          deletedAt: null,
        },
      });

      if (currentStock <= rp.minQuantity) {
        const hasActiveAlert = await this.prisma.stockAlert.count({
          where: { reorderPointId: rp.id, status: 'ACTIVE' },
        }) > 0;

        lowStockItems.push({
          reorderPointId: rp.id,
          brand: rp.brand,
          model: rp.model,
          storage: rp.storage,
          category: rp.category as string,
          branch: rp.branch,
          currentStock,
          minQuantity: rp.minQuantity,
          reorderQuantity: rp.reorderQuantity,
          hasActiveAlert,
        });
      }
    }

    // Sort by urgency (lowest stock ratio first)
    lowStockItems.sort((a, b) => {
      const ratioA = a.currentStock / a.minQuantity;
      const ratioB = b.currentStock / b.minQuantity;
      return ratioA - ratioB;
    });

    return {
      totalLowStock: lowStockItems.length,
      items: lowStockItems,
    };
  }
}
