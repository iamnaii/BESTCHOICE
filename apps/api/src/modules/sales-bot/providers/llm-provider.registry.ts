import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { ILlmProvider, LlmProviderName } from './llm-provider.interface';

const CONFIG_KEY = 'shop_bot_llm_provider';
const DEFAULT_PROVIDER: LlmProviderName = 'claude';
/** Small in-memory cache to avoid hitting SystemConfig DB on every reply */
const CACHE_TTL_MS = 60_000;

@Injectable()
export class LlmProviderRegistry {
  private readonly logger = new Logger(LlmProviderRegistry.name);
  private cached: { name: LlmProviderName; readAt: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private claude: ClaudeProvider,
    private gemini: GeminiProvider,
  ) {}

  async getActive(): Promise<ILlmProvider> {
    const name = await this.resolveName();
    if (name === 'gemini') return this.gemini;
    return this.claude;
  }

  private async resolveName(): Promise<LlmProviderName> {
    if (this.cached && Date.now() - this.cached.readAt < CACHE_TTL_MS) {
      return this.cached.name;
    }

    let name: LlmProviderName = DEFAULT_PROVIDER;
    try {
      const cfg = await this.prisma.systemConfig.findFirst({
        where: { key: CONFIG_KEY, deletedAt: null },
        select: { value: true },
      });
      const raw = (cfg?.value ?? '').trim().toLowerCase();
      if (raw === 'gemini' || raw === 'claude') {
        name = raw;
      } else if (raw) {
        this.logger.warn(
          `Unknown ${CONFIG_KEY}="${raw}" — falling back to ${DEFAULT_PROVIDER}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to read ${CONFIG_KEY} from SystemConfig: ${
          err instanceof Error ? err.message : err
        } — using ${DEFAULT_PROVIDER}`,
      );
    }

    this.cached = { name, readAt: Date.now() };
    return name;
  }

  /** Force re-read on next getActive() — used by admin flip endpoint + tests */
  invalidateCache(): void {
    this.cached = null;
  }
}
