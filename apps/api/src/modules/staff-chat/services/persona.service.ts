import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SHOP_SALES_PERSONA_BASE,
  SHOP_SALES_PERSONA_BOT_EXTRAS,
} from '../prompts/sales-persona';

const KEY_BASE = 'shop_bot_persona_base';
const KEY_EXTRAS = 'shop_bot_persona_bot_extras';
/** In-memory cache TTL (mirrors LlmProviderRegistry — same pattern, same window). */
const CACHE_TTL_MS = 60_000;

interface CachedField {
  value: string;
  readAt: number;
}

/**
 * Single source of truth for the SHOP sales persona prompt.
 *
 * Two layers, edited independently by the owner from `/settings/ai-persona`:
 *
 * - **BASE** (`shop_bot_persona_base`) — identity + tone. Used by both
 *   AiSuggest (staff suggestions) and SalesBot (auto-reply).
 * - **BOT_EXTRAS** (`shop_bot_persona_bot_extras`) — tool-use playbook.
 *   Appended after BASE for SalesBot only.
 *
 * Resolution per field:
 * 1. `SystemConfig.<key>` if present + non-whitespace
 * 2. Hardcoded const in `prompts/sales-persona.ts`
 *
 * Cached for {@link CACHE_TTL_MS} per field. `AiAutoReplyService.updateSettings`
 * calls {@link invalidateCache} when the owner saves either field so the
 * change is live on the next message instead of after the TTL.
 *
 * Empty-string from the PATCH body = "revert to default" (the service
 * soft-deletes the row so the fallback kicks in). `null`/`undefined` in the
 * DTO = "skip this field" (per PR #1059 null-skip pattern).
 */
@Injectable()
export class PersonaService {
  private readonly logger = new Logger(PersonaService.name);
  private cachedBase: CachedField | null = null;
  private cachedExtras: CachedField | null = null;

  constructor(private prisma: PrismaService) {}

  /** BASE persona (identity + tone) — used by AiSuggest + SalesBot. */
  async getBase(): Promise<string> {
    return this.getField(KEY_BASE, SHOP_SALES_PERSONA_BASE, 'base');
  }

  /** BOT-only playbook (tool-use rules) — appended after BASE for SalesBot. */
  async getBotExtras(): Promise<string> {
    return this.getField(KEY_EXTRAS, SHOP_SALES_PERSONA_BOT_EXTRAS, 'extras');
  }

  /** Composed BOT prompt = BASE + EXTRAS, both layers respecting overrides. */
  async getBot(): Promise<string> {
    const [base, extras] = await Promise.all([this.getBase(), this.getBotExtras()]);
    return `${base}${extras}`;
  }

  /**
   * Drop both in-memory snapshots so the next read re-checks SystemConfig.
   * Idempotent — safe to call when caches are already empty.
   */
  invalidateCache(): void {
    this.cachedBase = null;
    this.cachedExtras = null;
  }

  /**
   * Whether the owner has saved an override for each field. Used by the
   * frontend to show the "(แก้ไขแล้ว)" badge vs "(ค่าเริ่มต้น)".
   * Reads DB directly (bypasses cache) so the badge reflects current truth.
   */
  async isCustomized(): Promise<{ base: boolean; extras: boolean }> {
    try {
      const rows = await this.prisma.systemConfig.findMany({
        where: { key: { in: [KEY_BASE, KEY_EXTRAS] }, deletedAt: null },
        select: { key: true, value: true },
      });
      const map = new Map(rows.map((r) => [r.key, r.value]));
      return {
        base: this.isNonEmpty(map.get(KEY_BASE)),
        extras: this.isNonEmpty(map.get(KEY_EXTRAS)),
      };
    } catch (err) {
      this.logger.error(
        `isCustomized() failed: ${err instanceof Error ? err.message : err}`,
      );
      return { base: false, extras: false };
    }
  }

  private async getField(
    key: string,
    fallback: string,
    cacheSlot: 'base' | 'extras',
  ): Promise<string> {
    const cached = cacheSlot === 'base' ? this.cachedBase : this.cachedExtras;
    if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) {
      return cached.value;
    }

    let value = fallback;
    try {
      const cfg = await this.prisma.systemConfig.findFirst({
        where: { key, deletedAt: null },
        select: { value: true },
      });
      if (cfg && cfg.value && cfg.value.trim()) {
        value = cfg.value;
      }
    } catch (err) {
      this.logger.error(
        `Failed to read ${key} from SystemConfig: ${
          err instanceof Error ? err.message : err
        } — using hardcoded default`,
      );
    }

    const snapshot = { value, readAt: Date.now() };
    if (cacheSlot === 'base') {
      this.cachedBase = snapshot;
    } else {
      this.cachedExtras = snapshot;
    }
    return value;
  }

  private isNonEmpty(v: string | undefined): boolean {
    return Boolean(v && v.trim());
  }
}
