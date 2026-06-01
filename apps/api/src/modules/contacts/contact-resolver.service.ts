import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class ContactResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sequential internal code P-NNNNN, serialized via a global advisory lock. */
  async nextContactCode(tx: Tx): Promise<string> {
    const lockKey = this.hashLockKey('contact:code');
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.contact.findFirst({
      where: { contactCode: { startsWith: 'P-' } },
      orderBy: { contactCode: 'desc' },
      select: { contactCode: true },
    });

    const lastSeq = last ? parseInt(last.contactCode.split('-')[1], 10) || 0 : 0;
    return `P-${String(lastSeq + 1).padStart(5, '0')}`;
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
