import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.2.4.5 — Read access to Expense Template categories.
 *
 * Categories are shop-wide reference data, seeded once at migration
 * time. This service exposes only the list endpoint — CRUD on the
 * categories themselves is intentionally NOT wired in this PR (would
 * need OWNER permission + UI; ship that in a follow-up if owner asks).
 *
 * Returns active rows (deletedAt: null) ordered by name for stable
 * dropdown display.
 */
@Injectable()
export class TemplateCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.templateCategory.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true },
    });
  }
}
