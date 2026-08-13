import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const D = Prisma.Decimal;

/** ทะเบียนปันผลรายปี — อ่านจากเอกสาร DIV_PAY ที่ POSTED (ไม่เดิน GL — ใบ REVERSED หลุดเอง) */
@Injectable()
export class EquityReportService {
  constructor(private readonly prisma: PrismaService) {}

  async dividendRegister(year: number) {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    const docs = await this.prisma.equityDocument.findMany({
      where: {
        txnType: 'DIV_PAY',
        status: 'POSTED',
        deletedAt: null,
        txnDate: { gte: start, lte: end },
      },
      orderBy: { txnDate: 'asc' },
      include: { lines: { include: { shareholder: { select: { taxId: true, type: true } } } } },
    });

    const byId = new Map<
      string,
      {
        shareholderId: string;
        name: string;
        taxId: string | null;
        type: string;
        payCount: number;
        gross: Prisma.Decimal;
        wht: Prisma.Decimal;
        docNumbers: string[];
      }
    >();
    for (const doc of docs) {
      for (const ln of doc.lines) {
        const cur = byId.get(ln.shareholderId) ?? {
          shareholderId: ln.shareholderId,
          name: ln.shareholderName,
          taxId: ln.shareholder?.taxId ?? null,
          type: ln.shareholder?.type ?? 'INDIVIDUAL',
          payCount: 0,
          gross: new D(0),
          wht: new D(0),
          docNumbers: [] as string[],
        };
        cur.payCount += 1;
        cur.gross = cur.gross.plus(ln.amount.toString());
        cur.wht = cur.wht.plus(ln.wht.toString());
        cur.docNumbers.push(doc.docNumber);
        byId.set(ln.shareholderId, cur);
      }
    }
    const rows = [...byId.values()].map((r) => ({
      ...r,
      gross: r.gross.toFixed(2),
      wht: r.wht.toFixed(2),
      net: r.gross.minus(r.wht).toFixed(2),
    }));
    const totals = rows.reduce(
      (t, r) => ({
        gross: t.gross.plus(r.gross),
        wht: t.wht.plus(r.wht),
        net: t.net.plus(r.net),
      }),
      { gross: new D(0), wht: new D(0), net: new D(0) },
    );
    return {
      year,
      rows,
      totals: {
        gross: totals.gross.toFixed(2),
        wht: totals.wht.toFixed(2),
        net: totals.net.toFixed(2),
      },
    };
  }
}
