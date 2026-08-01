import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class IntercompanyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Compute current outstanding inter-company balance.
   *
   * Formula fixed 2026-07-30 (spec:
   * docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §4/§9).
   * The OLD formula read FINANCE from `21-1102` only (missed `21-1101`
   * ยอดจัด — the bulk of the payable) and SHOP from `11-2105`, a Phase A.3
   * placeholder account the SHOP-side templates never actually post to. The
   * NEW formula reads the accounts the real SHOP/FINANCE templates
   * (`ContractActivation1ATemplate` / `ShopInventoryTransferTemplate`) post
   * to:
   *
   *   - financeOwesToShop: Σ(Cr−Dr) on FINANCE `21-1101` (ยอดจัด) + `21-1102` (ค่าคอม)
   *   - shopReceivableFromFinance: Σ(Dr−Cr) on SHOP `S11-3001` (ยอดจัด) + `S11-3002` (ค่าคอม)
   *
   * The two should match (IC invariant) for contracts activated after the
   * SHOP-side receivable was wired in (2026-06-23). `driftNote` documents the
   * known, EXPECTED residual for contracts activated before that date, or
   * created via contract-exchange (device swap) — neither posts the
   * SHOP-side receivable yet (spec F1/F2) — so a nonzero `drift` there is not
   * a bug on its own; it needs the pre-flight check (spec §10) to confirm.
   *
   * Settlement itself moved to the "จ่ายให้หน้าร้าน (INTER-CO)" batch menu
   * (`interco-settlement` module) — this service no longer posts JEs.
   */
  async getOutstandingBalance(): Promise<{
    financeOwesToShop: number;
    shopReceivableFromFinance: number;
    balanced: boolean;
    drift: number;
    driftNote: string;
  }> {
    const [shop, finance] = await Promise.all([
      this.prisma.companyInfo.findFirst({ where: { companyCode: 'SHOP', deletedAt: null }, select: { id: true } }),
      this.prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }),
    ]);
    if (!shop || !finance) {
      throw new InternalServerErrorException('SHOP or FINANCE company not configured');
    }

    const [shopAgg, financeAgg] = await Promise.all([
      this.prisma.journalLine.aggregate({
        where: {
          deletedAt: null,
          accountCode: { in: ['S11-3001', 'S11-3002'] },
          journalEntry: { companyId: shop.id, status: 'POSTED', deletedAt: null },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.aggregate({
        where: {
          deletedAt: null,
          accountCode: { in: ['21-1101', '21-1102'] },
          journalEntry: { companyId: finance.id, status: 'POSTED', deletedAt: null },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);

    const shopReceivableFromFinance = new Prisma.Decimal(shopAgg._sum.debit ?? 0)
      .sub(shopAgg._sum.credit ?? 0)
      .toDecimalPlaces(2)
      .toNumber();
    const financeOwesToShop = new Prisma.Decimal(financeAgg._sum.credit ?? 0)
      .sub(financeAgg._sum.debit ?? 0)
      .toDecimalPlaces(2)
      .toNumber();

    const drift = Math.round((shopReceivableFromFinance - financeOwesToShop) * 100) / 100;

    return {
      financeOwesToShop,
      shopReceivableFromFinance,
      balanced: Math.abs(drift) < 0.01,
      drift,
      driftNote: 'ส่วนต่าง = สัญญาก่อน 2026-06-23/เปลี่ยนเครื่อง (สมุด SHOP ยังไม่ตั้งลูกหนี้)',
    };
  }
}
