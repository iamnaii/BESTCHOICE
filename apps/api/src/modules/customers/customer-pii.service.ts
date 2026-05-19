import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { encryptPII, decryptPII, isEncrypted } from '../../utils/crypto.util';
import {
  hashPII,
  encryptReferencesJson,
  decryptReferencesJson,
} from '../../utils/pii.util';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Phase 3 SP4 — Customer PII service.
 *
 * Centralizes encrypt / decrypt / hash logic for Customer PII columns
 * (Phase 2 added the columns; Phase 3 dual-writes; Phase 6 will drop
 * plaintext). Previously the same code lived inside CustomersService —
 * extracted here so:
 *
 *   1. Tests can mock PII handling without spinning CustomersService.
 *   2. PDPA "strict mode" toggle has one chokepoint to enforce.
 *   3. Other modules that need to write Customer PII (e.g. chatbot-finance
 *      auto-registration, LIFF onboarding) share the same dual-write logic
 *      instead of re-implementing it.
 *
 * NB: this service NEVER logs decrypted values. The only log statements
 * here are about config drift (missing key/salt) and strict-mode rejections,
 * neither of which carries customer data.
 */

/** Plaintext PII inputs a caller might supply for create/update. */
export interface CustomerPiiInput {
  nationalId?: string | null;
  phone?: string | null;
  phoneSecondary?: string | null;
  email?: string | null;
  addressIdCard?: string | null;
  addressCurrent?: string | null;
  addressWork?: string | null;
  guardianNationalId?: string | null;
  guardianPhone?: string | null;
  guardianAddress?: string | null;
  references?: unknown;
}

/**
 * Encrypted / hash columns produced by encryptCustomerFields(). All fields
 * are optional because callers only pass the subset they're updating.
 */
export interface CustomerPiiEncrypted {
  nationalIdEncrypted?: string | null;
  nationalIdHash?: string | null;
  phoneEncrypted?: string | null;
  phoneHash?: string | null;
  phoneSecondaryEncrypted?: string | null;
  emailEncrypted?: string | null;
  addressIdCardEncrypted?: string | null;
  addressCurrentEncrypted?: string | null;
  addressWorkEncrypted?: string | null;
  guardianNationalIdEncrypted?: string | null;
  guardianPhoneEncrypted?: string | null;
  guardianAddressEncrypted?: string | null;
  referencesEncrypted?: unknown;
}

/** Which PII field a search-by-hash query is targeting. */
export type HashSearchField = 'phone' | 'nationalId' | 'email';

@Injectable()
export class CustomerPiiService {
  private readonly logger = new Logger(CustomerPiiService.name);
  /** SystemConfig key that controls strict mode. */
  static readonly STRICT_MODE_CONFIG_KEY = 'PDPA_STRICT_MODE';

  constructor(private readonly prisma: PrismaService) {}

  private get piiKey(): string {
    return process.env.PII_ENCRYPTION_KEY || '';
  }

  private get hashSalt(): string {
    return process.env.PII_HASH_SALT || '';
  }

  /**
   * Read the strict-mode toggle. SystemConfig wins, env var falls back. The
   * env var path matters in tests + CLI runs that have no DB session, but
   * production toggling happens through the SystemConfig UI.
   *
   * DEEP review W1 — there is intentionally NO in-process cache here. The
   * SystemConfig SELECT is sub-millisecond (indexed `key` column, ~99
   * rows total) and caching produces cross-pod inconsistency (one pod
   * reads strict=true, peer pod still serves strict=false from its
   * 30s-old cache, callers see flapping 400s). Hit the DB every time.
   */
  async isStrictMode(): Promise<boolean> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: CustomerPiiService.STRICT_MODE_CONFIG_KEY, deletedAt: null },
        select: { value: true },
      });
      if (row?.value) {
        const v = row.value.trim().toLowerCase();
        return v === 'true' || v === '1';
      }
    } catch {
      // Database unreachable (CLI bootstrap, ts-node first connect, etc.)
      // — fall back to env var rather than throwing. Strict-mode rejection
      // is enforced in user-facing paths only, so a fallback of `false`
      // here is safe (dual-write still happens).
    }
    const env = (process.env.PDPA_STRICT_MODE || '').trim().toLowerCase();
    return env === 'true' || env === '1';
  }

  /**
   * Set the strict-mode flag. Upserts SystemConfig.
   * Returns the new effective value.
   */
  async setStrictMode(enabled: boolean): Promise<boolean> {
    await this.prisma.systemConfig.upsert({
      where: { key: CustomerPiiService.STRICT_MODE_CONFIG_KEY },
      update: {
        value: enabled ? 'true' : 'false',
        updatedAt: new Date(),
        deletedAt: null,
      },
      create: {
        key: CustomerPiiService.STRICT_MODE_CONFIG_KEY,
        value: enabled ? 'true' : 'false',
        label: 'PDPA strict mode — require encrypted PII columns on every read',
      },
    });
    return enabled;
  }

  /**
   * Encrypt + hash a set of PII fields. Only fields the caller passes
   * (typeof !== 'undefined') are touched, so partial updates leave
   * untouched columns alone.
   *
   * Null / empty inputs become null/empty in the output, NOT encrypted —
   * encrypting an empty string would produce ciphertext that decrypts to
   * '' but burns CPU + bytes for nothing.
   *
   * @throws Error when PII_ENCRYPTION_KEY is missing or too short and the
   *   caller is trying to write a non-empty value. Refusing here prevents
   *   the historical bug where misconfigured prod wrote literal plaintext
   *   into the `*_encrypted` columns (DEEP review C2).
   */
  encryptCustomerFields(input: CustomerPiiInput): CustomerPiiEncrypted {
    const key = this.piiKey;
    const salt = this.hashSalt;
    const out: CustomerPiiEncrypted = {};

    // Hard guard: if any non-empty PII value is being written but the key
    // / salt are missing, refuse the operation. Empty values stay legal
    // because they bypass crypto entirely.
    const hasNonEmptyPii = ([
      input.nationalId,
      input.phone,
      input.phoneSecondary,
      input.email,
      input.addressIdCard,
      input.addressCurrent,
      input.addressWork,
      input.guardianNationalId,
      input.guardianPhone,
      input.guardianAddress,
    ] as Array<string | null | undefined>).some((v) => typeof v === 'string' && v.length > 0) ||
      (Array.isArray(input.references) && input.references.length > 0);

    if (hasNonEmptyPii) {
      if (!key || key.length < 32) {
        throw new Error(
          'PII_ENCRYPTION_KEY missing or too short — refusing to write plaintext into *_encrypted columns',
        );
      }
      if (!salt || salt.length < 32) {
        throw new Error(
          'PII_HASH_SALT missing or too short — refusing to write plaintext into *_hash columns',
        );
      }
    }

    const enc = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return v;
      return encryptPII(v, key);
    };
    const hsh = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return v;
      return hashPII(v, salt);
    };

    if (input.nationalId !== undefined) {
      out.nationalIdEncrypted = enc(input.nationalId);
      out.nationalIdHash = hsh(input.nationalId);
    }
    if (input.phone !== undefined) {
      out.phoneEncrypted = enc(input.phone);
      out.phoneHash = hsh(input.phone);
    }
    if (input.phoneSecondary !== undefined) {
      out.phoneSecondaryEncrypted = enc(input.phoneSecondary);
    }
    if (input.email !== undefined) {
      out.emailEncrypted = enc(input.email);
    }
    if (input.addressIdCard !== undefined) {
      out.addressIdCardEncrypted = enc(input.addressIdCard);
    }
    if (input.addressCurrent !== undefined) {
      out.addressCurrentEncrypted = enc(input.addressCurrent);
    }
    if (input.addressWork !== undefined) {
      out.addressWorkEncrypted = enc(input.addressWork);
    }
    if (input.guardianNationalId !== undefined) {
      out.guardianNationalIdEncrypted = enc(input.guardianNationalId);
    }
    if (input.guardianPhone !== undefined) {
      out.guardianPhoneEncrypted = enc(input.guardianPhone);
    }
    if (input.guardianAddress !== undefined) {
      out.guardianAddressEncrypted = enc(input.guardianAddress);
    }
    if (input.references !== undefined) {
      out.referencesEncrypted =
        key && input.references
          ? encryptReferencesJson(input.references, key)
          : input.references;
    }

    return out;
  }

  /**
   * Decrypt PII columns and project them back onto the legacy field names.
   * Strict mode: if the encrypted column is NULL and the row is referenced
   * by the caller, throw — the row hasn't been backfilled yet.
   * Non-strict: fall back to the legacy plaintext column (rolling-deploy
   * safety).
   */
  decryptCustomerFields<T extends Record<string, unknown>>(c: T | null, opts: { strict?: boolean } = {}): T | null {
    if (!c) return c;
    const key = this.piiKey;
    if (!key) return c;
    const strict = opts.strict === true;

    const dec = (encField: string, legacyField: string): string | null | undefined => {
      const enc = c[encField] as string | null | undefined;
      if (enc && typeof enc === 'string' && isEncrypted(enc)) {
        return decryptPII(enc, key);
      }
      // In strict mode, reading a row whose encrypted column is missing
      // means the backfill hasn't run. Surface that loudly rather than
      // silently leaking plaintext.
      if (strict) {
        const legacy = c[legacyField];
        if (legacy !== undefined && legacy !== null && legacy !== '') {
          throw new BadRequestException(
            `ข้อมูลยังไม่ได้เข้ารหัส (${encField}) — กรุณารัน backfill ก่อนเปิด PDPA strict mode`,
          );
        }
      }
      return c[legacyField] as string | null | undefined;
    };

    const refEnc = c['referencesEncrypted'];
    let references: unknown = c['references'];
    if (refEnc) {
      references = decryptReferencesJson(refEnc, key);
    } else if (strict && c['references']) {
      throw new BadRequestException(
        'ข้อมูล references ยังไม่ได้เข้ารหัส — กรุณารัน backfill ก่อนเปิด PDPA strict mode',
      );
    }

    return {
      ...c,
      nationalId: dec('nationalIdEncrypted', 'nationalId'),
      phone: dec('phoneEncrypted', 'phone'),
      phoneSecondary: dec('phoneSecondaryEncrypted', 'phoneSecondary'),
      email: dec('emailEncrypted', 'email'),
      addressIdCard: dec('addressIdCardEncrypted', 'addressIdCard'),
      addressCurrent: dec('addressCurrentEncrypted', 'addressCurrent'),
      addressWork: dec('addressWorkEncrypted', 'addressWork'),
      guardianNationalId: dec('guardianNationalIdEncrypted', 'guardianNationalId'),
      guardianPhone: dec('guardianPhoneEncrypted', 'guardianPhone'),
      guardianAddress: dec('guardianAddressEncrypted', 'guardianAddress'),
      references,
    } as T;
  }

  /** Bulk variant of decryptCustomerFields for list endpoints. */
  decryptCustomerList<T extends Record<string, unknown>>(rows: T[], opts: { strict?: boolean } = {}): T[] {
    return rows.map((r) => this.decryptCustomerFields(r, opts) as T);
  }

  /**
   * Build a Prisma where fragment that looks up a customer by the
   * deterministic hash of a PII field. Returns null if the salt is
   * unconfigured (test env, dev without secrets) — caller is expected
   * to fall back to the plaintext path in that case.
   *
   * Address is intentionally NOT hash-searchable — addresses are
   * variable-cased free text, exact-match lookup makes no sense.
   */
  searchByHash(field: HashSearchField, value: string): Record<string, string> | null {
    if (!value) return null;
    const salt = this.hashSalt;
    if (field === 'email') {
      // Email is not hashed (case sensitivity + normalization complicates it).
      // Callers should use Prisma's `mode: 'insensitive'` on the plaintext
      // column. Returning null nudges them to do that instead of mis-using
      // this helper.
      return null;
    }
    if (!salt) return null;
    const h = hashPII(value, salt);
    if (field === 'phone') return { phoneHash: h };
    if (field === 'nationalId') return { nationalIdHash: h };
    return null;
  }

  /**
   * Convenience: produce the hash for a given input (e.g. for unique-
   * constraint lookups inside CustomersService.create()). Returns null if
   * the salt is missing so callers can fall back to the plaintext path.
   */
  hash(value: string | null | undefined): string | null {
    if (!value) return null;
    const salt = this.hashSalt;
    if (!salt) return null;
    return hashPII(value, salt);
  }

  /**
   * Quick "is at least one encrypted column populated?" sniff on a raw
   * Customer row. Used by strict-mode read guards before they descend
   * into per-field decryption.
   */
  isRowEncrypted(c: Record<string, unknown> | null): boolean {
    if (!c) return false;
    return (
      typeof c['nationalIdEncrypted'] === 'string' && isEncrypted(c['nationalIdEncrypted'] as string)
    );
  }
}
