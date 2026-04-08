import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FINANCE_BANK,
  FINANCE_CONTACT_PHONE,
  BANK_INFO_BLOCK,
} from '../constants/finance-rules';

interface FinanceBankConfig {
  bankName: string;
  accountNumber: string;
  accountName: string;
  contactPhone: string;
  bankInfoBlock: string;
}

const SYSTEM_CONFIG_KEYS = {
  bankName: 'finance_bank_name',
  accountNumber: 'finance_bank_account',
  accountName: 'finance_bank_account_name',
  contactPhone: 'finance_contact_phone',
} as const;

/**
 * FinanceConfigService — runtime config สำหรับ Finance Bot
 *
 * Source priority: SystemConfig table > constants/finance-rules.ts (fallback)
 *
 * Loaded once on module init + cached. Admin can call `reload()` after editing
 * SystemConfig via /settings/line-oa or future /settings/finance UI.
 */
@Injectable()
export class FinanceConfigService implements OnModuleInit {
  private readonly logger = new Logger(FinanceConfigService.name);
  private cached: FinanceBankConfig = this.buildFromConstants();

  constructor(private prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /** Reload from DB — call after admin edits SystemConfig */
  async reload(): Promise<void> {
    try {
      const rows = await this.prisma.systemConfig.findMany({
        where: { key: { in: Object.values(SYSTEM_CONFIG_KEYS) } },
      });
      const map = new Map(rows.map((r) => [r.key, r.value]));

      const bankName = map.get(SYSTEM_CONFIG_KEYS.bankName) || FINANCE_BANK.bankName;
      const accountNumber =
        map.get(SYSTEM_CONFIG_KEYS.accountNumber) || FINANCE_BANK.accountNumber;
      const accountName =
        map.get(SYSTEM_CONFIG_KEYS.accountName) || FINANCE_BANK.accountName;
      const contactPhone =
        map.get(SYSTEM_CONFIG_KEYS.contactPhone) || FINANCE_CONTACT_PHONE;

      this.cached = {
        bankName,
        accountNumber,
        accountName,
        contactPhone,
        bankInfoBlock: this.formatBlock(bankName, accountNumber, accountName),
      };
      this.logger.log(`[FinanceConfig] Loaded (account=${accountNumber})`);
    } catch (err) {
      this.logger.warn(
        `[FinanceConfig] Reload failed, using constants: ${err instanceof Error ? err.message : err}`,
      );
      this.cached = this.buildFromConstants();
    }
  }

  get bankName(): string {
    return this.cached.bankName;
  }

  get accountNumber(): string {
    return this.cached.accountNumber;
  }

  get accountName(): string {
    return this.cached.accountName;
  }

  get contactPhone(): string {
    return this.cached.contactPhone;
  }

  get bankInfoBlock(): string {
    return this.cached.bankInfoBlock;
  }

  /** Match exact digits-only against current company account */
  isCompanyBankAccount(slipAccount: string | null | undefined): boolean {
    if (!slipAccount) return false;
    const slipDigits = slipAccount.replace(/\D/g, '');
    const expectedDigits = this.cached.accountNumber.replace(/\D/g, '');
    return slipDigits === expectedDigits;
  }

  // ─── private ──────────────────────────────────────────────

  private buildFromConstants(): FinanceBankConfig {
    return {
      bankName: FINANCE_BANK.bankName,
      accountNumber: FINANCE_BANK.accountNumber,
      accountName: FINANCE_BANK.accountName,
      contactPhone: FINANCE_CONTACT_PHONE,
      bankInfoBlock: BANK_INFO_BLOCK,
    };
  }

  private formatBlock(bankName: string, accountNumber: string, accountName: string): string {
    return [
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
      `🏦 ${bankName}`,
      `🔢 เลขที่: ${accountNumber}`,
      `👤 ชื่อ: ${accountName}`,
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
    ].join('\n');
  }
}
