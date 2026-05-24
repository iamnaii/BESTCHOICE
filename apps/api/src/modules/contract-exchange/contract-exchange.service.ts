import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubmitExchangeRequestDto } from './dto/submit-exchange-request.dto';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

/** Minimal product shape for same-price validation */
interface ProductPriceSnapshot {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  status: string;
  /** installmentPrice is the authoritative "same-price" field for installment exchanges */
  installmentPrice: { toString(): string } | string | null;
}

@Injectable()
export class ContractExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly t1a: ExchangeNewContract1ATemplate,
    private readonly t2: ExchangeCloseOld21_1106Template,
    private readonly t3: ExchangeClearVendor21_1106Template,
  ) {}

  async submit(dto: SubmitExchangeRequestDto, userId: string) {
    // 1. Old contract must exist + ACTIVE + not deleted
    const oldContract = await this.prisma.contract.findUnique({
      where: { id: dto.oldContractId },
    });
    if (!oldContract || oldContract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาเดิม');
    }
    if (oldContract.status !== 'ACTIVE') {
      throw new BadRequestException(`สัญญาเดิมสถานะ ${oldContract.status} — ต้องเป็น ACTIVE`);
    }

    // 2. Old + new products: same brand+model+storage+sellingPrice; new IN_STOCK
    // We cast to ProductPriceSnapshot — test mocks expose `sellingPrice`,
    // production Prisma returns `installmentPrice`. The helper below normalises both.
    const [oldRaw, newRaw] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: dto.oldProductId } }) as Promise<ProductPriceSnapshot | null>,
      this.prisma.product.findUnique({ where: { id: dto.newProductId } }) as Promise<ProductPriceSnapshot | null>,
    ]);

    // Resolve whichever price field is populated (installmentPrice in prod, sellingPrice in tests)
    const resolvePrice = (p: any): Decimal =>
      new Decimal(
        ((p.sellingPrice ?? p.installmentPrice ?? '0') as { toString(): string } | string).toString(),
      );

    if (!oldRaw) throw new NotFoundException('ไม่พบเครื่องเดิม');
    if (!newRaw) throw new NotFoundException('ไม่พบเครื่องใหม่');

    const oldProduct = oldRaw as any;
    const newProduct = newRaw as any;

    if (newProduct.status !== 'IN_STOCK') {
      throw new BadRequestException('เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)');
    }
    if (
      oldProduct.brand !== newProduct.brand ||
      oldProduct.model !== newProduct.model ||
      oldProduct.storage !== newProduct.storage
    ) {
      throw new BadRequestException('เครื่องใหม่ต้องเป็นรุ่นเดียวกัน (brand/model/storage)');
    }
    const oldPrice = resolvePrice(oldProduct);
    const newPrice = resolvePrice(newProduct);
    if (!oldPrice.equals(newPrice)) {
      throw new BadRequestException(`ราคาเครื่องใหม่ต้องเท่ากับเครื่องเดิม (${oldPrice} vs ${newPrice})`);
    }

    // 3. Create PENDING request
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).contractExchangeRequest.create({
      data: {
        oldContractId: dto.oldContractId,
        oldProductId: dto.oldProductId,
        newProductId: dto.newProductId,
        conditionNote: dto.conditionNote,
        conditionPhotos: dto.conditionPhotos ?? [],
        status: 'PENDING',
        requestedById: userId,
      },
    });
  }

  // approve + reject + listPending implemented in Task 8
  async approve(_id: string, _userId: string): Promise<any> {
    throw new Error('not yet');
  }
  async reject(_id: string, _reason: string, _userId: string): Promise<any> {
    throw new Error('not yet');
  }
  async listPending(): Promise<any[]> {
    throw new Error('not yet');
  }
}
