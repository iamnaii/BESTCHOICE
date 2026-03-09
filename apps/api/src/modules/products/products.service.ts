import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const productInclude = {
  prices: { orderBy: { createdAt: 'asc' as const } },
  supplier: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  po: { select: { id: true, poNumber: true } },
  inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
  productPhotos: { select: { id: true, isCompleted: true } },
};

// Re-export for use by other services if needed
export { productInclude };

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    search?: string;
    branchId?: string;
    status?: string;
    category?: string;
    brand?: string;
    supplierId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = filters.brand;
    if (filters.supplierId) where.supplierId = filters.supplierId;

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
        { imeiSerial: { contains: filters.search } },
      ];
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    return product;
  }

  async create(dto: CreateProductDto) {
    const { prices, costPrice, warrantyExpireDate, ...data } = dto;

    const isInStock = !data.status || data.status === 'IN_STOCK';
    const product = await this.prisma.product.create({
      data: {
        ...data,
        costPrice,
        warrantyExpireDate: warrantyExpireDate ? new Date(warrantyExpireDate) : null,
        ...(isInStock ? { stockInDate: new Date() } : {}),
        ...(prices && prices.length > 0
          ? {
              prices: {
                create: prices.map((p, i) => ({
                  label: p.label,
                  amount: p.amount,
                  isDefault: p.isDefault ?? (i === 0),
                })),
              },
            }
          : {}),
      } as Prisma.ProductUncheckedCreateInput,
      include: productInclude,
    });

    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    const { costPrice, warrantyExpireDate, ...data } = dto;
    return this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(costPrice !== undefined ? { costPrice } : {}),
        ...(warrantyExpireDate !== undefined ? { warrantyExpireDate: warrantyExpireDate ? new Date(warrantyExpireDate) : null } : {}),
      } as Prisma.ProductUncheckedUpdateInput,
      include: productInclude,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // === Workflow Tracker ===

  /**
   * Get workflow status for a product showing which step it's at
   * Steps: 1.เช็ค Stock → 2.สั่งสินค้า → 3.ตรวจรับ → 4.ถ่ายรูป 6 มุม → 5.เข้าคลัง → 6.ส่งไปสาขา → 7.สาขาเช็ครับ
   */
  async getWorkflowStatus(productId: string) {
    const stockTransferSelect = {
      id: true,
      batchNumber: true,
      productId: true,
      fromBranchId: true,
      toBranchId: true,
      transferredBy: true,
      notes: true,
      status: true,
      confirmedById: true,
      confirmedAt: true,
      dispatchedById: true,
      dispatchedAt: true,
      trackingNote: true,
      expectedDeliveryDate: true,
      createdAt: true,
    };

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        po: { select: { id: true, poNumber: true, status: true, approvedBy: { select: { name: true } } } },
        branch: { select: { id: true, name: true, isMainWarehouse: true } },
        supplier: { select: { id: true, name: true } },
        receivingItem: {
          select: {
            id: true, status: true, createdAt: true,
            receiving: { select: { receivedBy: { select: { name: true } } } },
          },
        },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });

    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    // Get photo completion count without loading base64 data
    let photoAngles = 0;
    if (product.productPhotos) {
      const raw = await this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT (CASE WHEN front IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN back IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN "left" IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN "right" IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN top IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN bottom IS NOT NULL THEN 1 ELSE 0 END) as count
        FROM product_photos WHERE product_id = ${productId}`;
      photoAngles = Number(raw[0]?.count || 0);
    }

    // Find transfer history
    const transfers = await this.prisma.stockTransfer.findMany({
      where: { productId },
      select: {
        ...stockTransferSelect,
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        branchReceiving: { select: { id: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestTransfer = transfers[0] || null;

    const isUsedPhone = product.category === 'PHONE_USED';
    const photoCompleted = product.productPhotos?.isCompleted === true;

    const rawSteps: { name: string; status: 'completed' | 'in_progress' | 'pending'; description: string }[] = [
      {
        name: 'เช็ค Stock',
        status: 'completed',
        description: 'ตรวจสอบสต๊อคก่อนสั่งซื้อ',
      },
      {
        name: 'สั่งสินค้า (PO)',
        status: product.poId ? 'completed' : 'pending',
        description: product.po ? `PO: ${product.po.poNumber} (${product.po.status})` : 'ยังไม่ได้สั่งซื้อ',
      },
      {
        name: 'ตรวจรับสินค้า (QC)',
        status: product.receivingItem ? 'completed' : 'pending',
        description: product.receivingItem
          ? `QC: ${product.receivingItem.status} (${new Date(product.receivingItem.createdAt).toLocaleDateString('th-TH')})`
          : 'ยังไม่ได้ตรวจรับ',
      },
    ];

    // ถ่ายรูป 6 มุม เฉพาะมือสอง
    if (isUsedPhone) {
      rawSteps.push({
        name: 'ถ่ายรูปสินค้า 6 มุม',
        status: photoCompleted
          ? 'completed'
          : product.status === 'PHOTO_PENDING' ? 'in_progress'
          : photoAngles > 0 ? 'in_progress'
          : 'pending',
        description: photoCompleted
          ? 'ถ่ายรูปครบ 6 มุมแล้ว'
          : photoAngles > 0
          ? `ถ่ายแล้ว ${photoAngles}/6 มุม`
          : 'รอถ่ายรูปสินค้า',
      });
    }

    rawSteps.push(
      {
        name: 'สินค้าเข้าคลัง',
        status: (['IN_STOCK', 'RESERVED', 'SOLD_INSTALLMENT', 'SOLD_CASH', 'SOLD_RESELL'].includes(product.status))
          ? 'completed'
          : product.status === 'QC_PENDING' ? 'in_progress'
          : product.status === 'PHOTO_PENDING' ? 'pending'
          : 'pending',
        description: product.status === 'QC_PENDING' ? 'รอยืนยัน QC เข้าคลัง'
          : product.status === 'PHOTO_PENDING' ? 'รอถ่ายรูป 6 มุมก่อนเข้าคลัง'
          : product.status === 'IN_STOCK' ? 'อยู่ในคลัง'
          : 'รอดำเนินการ',
      },
      {
        name: 'ส่งไปสาขา',
        status: latestTransfer
          ? latestTransfer.status === 'CONFIRMED' ? 'completed'
            : latestTransfer.status === 'REJECTED' ? 'pending'
            : latestTransfer.status === 'IN_TRANSIT' ? 'in_progress'
            : 'pending'
          : 'pending',
        description: latestTransfer
          ? `${latestTransfer.fromBranch.name} → ${latestTransfer.toBranch.name} (${latestTransfer.status})`
          : 'ยังไม่ได้โอนไปสาขา',
      },
      {
        name: 'สาขาเช็ครับ',
        status: latestTransfer?.branchReceiving
          ? 'completed'
          : latestTransfer?.status === 'IN_TRANSIT' ? 'pending'
          : 'pending',
        description: latestTransfer?.branchReceiving
          ? `ตรวจรับแล้ว (${latestTransfer.branchReceiving.status})`
          : 'ยังไม่ได้ตรวจรับที่สาขา',
      },
    );

    const steps = rawSteps.map((s, i) => ({ step: i + 1, ...s }));

    let currentStep = 1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].status === 'completed' || steps[i].status === 'in_progress') {
        currentStep = steps[i].step;
        break;
      }
    }

    return {
      productId: product.id,
      productName: product.name,
      currentStep,
      status: product.status,
      branch: product.branch,
      steps,
    };
  }

  // === Get available brands for filter ===
  async getBrands() {
    const brands = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });
    return brands.map((b) => b.brand);
  }
}
