import { Injectable } from '@nestjs/common';
import { ContactRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export interface ResolveContactInput {
  name: string;
  taxId?: string | null;
  nationalIdHash?: string | null;
  phone?: string | null;
  email?: string | null;
  role: ContactRole;
}

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

  /**
   * Find the party master for these natural keys, or create one.
   * Matching priority: taxId, then nationalIdHash. When NEITHER key is
   * present we never match — always create a fresh Contact (safe
   * no-auto-merge policy for keyless walk-ins / trade-in sellers).
   * If a match is found, the role is appended (idempotent).
   */
  async findOrCreateByNaturalKey(tx: Tx, input: ResolveContactInput) {
    const orClauses: Prisma.ContactWhereInput[] = [];
    if (input.taxId) orClauses.push({ taxId: input.taxId });
    if (input.nationalIdHash) orClauses.push({ nationalIdHash: input.nationalIdHash });

    if (orClauses.length > 0) {
      const existing = await tx.contact.findFirst({
        where: { deletedAt: null, OR: orClauses },
      });
      if (existing) {
        if (!existing.roles.includes(input.role)) {
          return tx.contact.update({
            where: { id: existing.id },
            data: { roles: { set: [...existing.roles, input.role] } },
          });
        }
        return existing;
      }
    }

    const contactCode = await this.nextContactCode(tx);
    return tx.contact.create({
      data: {
        contactCode,
        name: input.name,
        taxId: input.taxId ?? null,
        nationalIdHash: input.nationalIdHash ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        roles: [input.role],
      },
    });
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
