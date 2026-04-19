# PII Column-Level Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply AES-256-CBC encryption to all Customer PII columns (`nationalId`, `phone`, `email`, addresses, guardian fields, `references`, customer bank account in TradeIn) with deterministic SHA-256 hash columns for `nationalId` + `phone` lookup, role-based display masking at the backend, and audit logging on every decryption.

**Architecture:** 4-phase 2-step migration to avoid downtime — (1) add nullable encrypted + hash columns, (2) backfill existing data via script, (3) switch reads/writes to new columns + add masking interceptor + audit, (4) drop old columns. Encryption util `crypto.util.ts` already exists; this plan wires it into Customer/TradeIn services and adds `pii.util.ts` (hash + mask helpers) + `pii-audit.service.ts` (decryption audit logging).

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, AES-256-CBC + SHA-256-HMAC for hashing, existing AuditService

**Spec basis:** Q1-Q4 brainstorm answers (2026-04-19)
- Q1: encrypt Customer.{nationalId, phone, phoneSecondary, email, addressIdCard, addressCurrent, addressWork, guardianNationalId, guardianPhone, guardianAddress, references} + TradeIn.{transferAccountNumber, transferAccountName}
- Q2: hash columns = `nationalIdHash` + `phoneHash` only (deterministic SHA-256 + salt)
- Q3: 2-step migration (4 PRs)
- Q4: backend masking, SALES sees `1-2345-XXXXX-XX-3` (5+1) for nationalId, `XXX-X-XXXX9-0` (last 2) for bankAccount

**Out of scope (future plans):**
- Supplier/Company bank account encryption (`SupplierPaymentMethod.bankAccountNumber`, `CompanyInfo.bankAccountNumber`, `PurchaseOrder.bankAccountSnapshot`)
- Key rotation strategy
- DSAR auto-decrypt for customer self-service

---

## File Structure

**New files:**
- `apps/api/src/utils/pii.util.ts` — hash + mask helpers
- `apps/api/src/utils/pii.util.spec.ts` — unit tests
- `apps/api/src/modules/pii/pii-audit.service.ts` — log every decryption call
- `apps/api/src/modules/pii/pii-audit.service.spec.ts` — unit tests
- `apps/api/src/modules/pii/pii.module.ts` — exports PiiAuditService globally
- `apps/api/scripts/backfill-pii-encryption.ts` — one-time backfill script
- `apps/api/prisma/migrations/{ts}_add_pii_encrypted_columns/migration.sql` — Phase 2 migration
- `apps/api/prisma/migrations/{ts}_drop_pii_legacy_columns/migration.sql` — Phase 6 migration

**Modified files:**
- `apps/api/prisma/schema.prisma` (Customer + TradeIn models)
- `apps/api/src/modules/customers/customers.service.ts` (encrypt on write, decrypt on read, log access)
- `apps/api/src/modules/customers/customers.controller.ts` (apply masking based on role)
- `apps/api/src/modules/trade-in/trade-in.service.ts` (encrypt customer bank fields)
- `apps/api/src/modules/auth/dto/*.dto.ts` (ensure DTO unaffected)
- `apps/api/src/utils/env-validation.ts` (require `PII_ENCRYPTION_KEY` + `PII_HASH_SALT` in prod)
- `apps/api/src/app.module.ts` (register PiiModule globally)
- `.env.example` (document new env vars)

---

## Phase 1: Foundation utilities + env vars (1 PR)

### Task 1: Add `pii.util.ts` with hash + mask helpers

**Files:**
- Create: `apps/api/src/utils/pii.util.ts`
- Test: `apps/api/src/utils/pii.util.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/utils/pii.util.spec.ts
import { hashPII, maskNationalId, maskPhone, maskBankAccount, maskEmail } from './pii.util';

describe('pii.util', () => {
  const salt = 'test-salt-32-chars-minimum-needed-here';

  describe('hashPII', () => {
    it('returns deterministic hash for same input', () => {
      expect(hashPII('1234567890123', salt)).toBe(hashPII('1234567890123', salt));
    });

    it('returns different hashes for different inputs', () => {
      expect(hashPII('1234567890123', salt)).not.toBe(hashPII('1234567890124', salt));
    });

    it('returns 64-char hex string', () => {
      const hash = hashPII('test', salt);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns empty string for empty input', () => {
      expect(hashPII('', salt)).toBe('');
    });

    it('throws if salt is missing or too short', () => {
      expect(() => hashPII('test', '')).toThrow('PII_HASH_SALT required');
      expect(() => hashPII('test', 'short')).toThrow('PII_HASH_SALT must be >= 32 chars');
    });
  });

  describe('maskNationalId', () => {
    it('shows 5 first + 1 last char', () => {
      expect(maskNationalId('1234567890123')).toBe('12345-XXXXX-XX-3');
    });

    it('returns empty for empty input', () => {
      expect(maskNationalId('')).toBe('');
    });

    it('returns input as-is if not 13 chars', () => {
      expect(maskNationalId('123')).toBe('123');
    });
  });

  describe('maskPhone', () => {
    it('shows prefix + last 2 chars', () => {
      expect(maskPhone('0812345678')).toBe('081-XXX-XX78');
    });

    it('returns input as-is if shorter than 10', () => {
      expect(maskPhone('12345')).toBe('12345');
    });
  });

  describe('maskBankAccount', () => {
    it('shows last 2 chars only', () => {
      expect(maskBankAccount('1234567890')).toBe('XXXXXXXX90');
    });

    it('returns empty for empty input', () => {
      expect(maskBankAccount('')).toBe('');
    });
  });

  describe('maskEmail', () => {
    it('masks local part except first char', () => {
      expect(maskEmail('john.doe@example.com')).toBe('j*******@example.com');
    });

    it('returns input as-is if no @', () => {
      expect(maskEmail('not-an-email')).toBe('not-an-email');
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx jest pii.util.spec.ts
```

Expected: FAIL with "Cannot find module './pii.util'"

- [ ] **Step 3: Implement `pii.util.ts`**

```typescript
// apps/api/src/utils/pii.util.ts
import { createHmac } from 'crypto';

/**
 * Deterministic hash for PII lookup. Uses HMAC-SHA-256 with PII_HASH_SALT.
 * Same input + salt → same hash, enabling unique constraint + lookup queries.
 * Cannot be reversed; attacker needs plaintext to test.
 */
export function hashPII(plaintext: string, salt: string): string {
  if (!salt) throw new Error('PII_HASH_SALT required');
  if (salt.length < 32) throw new Error('PII_HASH_SALT must be >= 32 chars');
  if (!plaintext) return '';
  return createHmac('sha256', salt).update(plaintext).digest('hex');
}

/**
 * Mask 13-digit Thai national ID: show 5 first + 1 last.
 * Example: "1234567890123" → "12345-XXXXX-XX-3"
 */
export function maskNationalId(value: string): string {
  if (!value) return '';
  if (value.length !== 13) return value;
  return `${value.slice(0, 5)}-XXXXX-XX-${value.slice(-1)}`;
}

/**
 * Mask Thai mobile phone: show 3-char prefix + last 2.
 * Example: "0812345678" → "081-XXX-XX78"
 */
export function maskPhone(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return value;
  return `${digits.slice(0, 3)}-XXX-XX${digits.slice(-2)}`;
}

/**
 * Mask bank account: show last 2 chars only.
 */
export function maskBankAccount(value: string): string {
  if (!value) return '';
  if (value.length <= 2) return value;
  return 'X'.repeat(value.length - 2) + value.slice(-2);
}

/**
 * Mask email local-part: show first char only.
 * Example: "john.doe@example.com" → "j*******@example.com"
 */
export function maskEmail(value: string): string {
  if (!value || !value.includes('@')) return value;
  const [local, domain] = value.split('@');
  if (local.length <= 1) return value;
  return `${local[0]}${'*'.repeat(local.length - 1)}@${domain}`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx jest pii.util.spec.ts
```

Expected: All 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/pii.util.ts apps/api/src/utils/pii.util.spec.ts
git commit -m "feat(pii): add hash + mask utilities for PII columns

- hashPII: HMAC-SHA-256 deterministic hash for lookup columns
- maskNationalId/Phone/BankAccount/Email: role-based display masking
- 13 unit tests"
```

---

### Task 2: Add env var validation for `PII_ENCRYPTION_KEY` + `PII_HASH_SALT`

**Files:**
- Modify: `apps/api/src/utils/env-validation.ts`
- Modify: `.env.example`

- [ ] **Step 1: Read current env-validation.ts**

```bash
cat apps/api/src/utils/env-validation.ts
```

Identify where required env vars are checked.

- [ ] **Step 2: Add PII env vars to required list (production-only)**

Add to the production-required list:
- `PII_ENCRYPTION_KEY` — 64-char hex (32 bytes for AES-256-CBC), validate length and hex
- `PII_HASH_SALT` — minimum 32 chars

Example pattern (adjust to existing file structure):

```typescript
if (process.env.NODE_ENV === 'production') {
  const piiKey = process.env.PII_ENCRYPTION_KEY;
  if (!piiKey || piiKey.length !== 64 || !/^[0-9a-f]+$/i.test(piiKey)) {
    throw new Error('PII_ENCRYPTION_KEY must be 64 hex chars (32 bytes) in production');
  }
  const piiSalt = process.env.PII_HASH_SALT;
  if (!piiSalt || piiSalt.length < 32) {
    throw new Error('PII_HASH_SALT must be >= 32 chars in production');
  }
}
```

- [ ] **Step 3: Update `.env.example` with placeholder values**

Add to `.env.example`:

```
# PII Encryption (Phase 6.5)
# Generate via: openssl rand -hex 32
PII_ENCRYPTION_KEY=

# PII Hash Salt (deterministic lookup for nationalId/phone)
# Generate via: openssl rand -hex 32
PII_HASH_SALT=
```

- [ ] **Step 4: Run API in dev to confirm no startup error (NODE_ENV=development should not require these)**

```bash
cd apps/api && npm run start:dev
```

Expected: API starts normally (env vars not required in dev).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/env-validation.ts .env.example
git commit -m "feat(pii): require PII_ENCRYPTION_KEY + PII_HASH_SALT in production"
```

---

### Task 3: Create `PiiAuditService` to log decryption events

**Files:**
- Create: `apps/api/src/modules/pii/pii-audit.service.ts`
- Create: `apps/api/src/modules/pii/pii-audit.service.spec.ts`
- Create: `apps/api/src/modules/pii/pii.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/modules/pii/pii-audit.service.spec.ts
import { Test } from '@nestjs/testing';
import { PiiAuditService } from './pii-audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PiiAuditService', () => {
  let service: PiiAuditService;
  let prisma: { auditLog: { create: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    const module = await Test.createTestingModule({
      providers: [
        PiiAuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PiiAuditService);
  });

  it('logs PII_DECRYPT_FULL action with all required fields', async () => {
    await service.logDecryption({
      userId: 'user-1',
      customerId: 'cust-1',
      fields: ['nationalId', 'phone'],
      role: 'OWNER',
      masked: false,
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'PII_DECRYPT_FULL',
        entity: 'customer',
        entityId: 'cust-1',
        newValue: { fields: ['nationalId', 'phone'], role: 'OWNER' },
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla',
      }),
    });
  });

  it('logs PII_DECRYPT_MASKED when masked=true', async () => {
    await service.logDecryption({
      userId: 'user-2',
      customerId: 'cust-2',
      fields: ['nationalId'],
      role: 'SALES',
      masked: true,
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PII_DECRYPT_MASKED',
        userId: 'user-2',
      }),
    });
  });

  it('does not throw if audit insert fails (logs to console)', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('DB down'));
    await expect(
      service.logDecryption({
        userId: 'u', customerId: 'c', fields: ['phone'], role: 'OWNER', masked: false,
      })
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd apps/api && npx jest pii-audit.service.spec
```

Expected: FAIL with "Cannot find module './pii-audit.service'"

- [ ] **Step 3: Implement `PiiAuditService`**

```typescript
// apps/api/src/modules/pii/pii-audit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LogDecryptionInput {
  userId: string;
  customerId: string;
  fields: string[];
  role: string;
  masked: boolean;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class PiiAuditService {
  private readonly logger = new Logger(PiiAuditService.name);

  constructor(private prisma: PrismaService) {}

  async logDecryption(input: LogDecryptionInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId,
          action: input.masked ? 'PII_DECRYPT_MASKED' : 'PII_DECRYPT_FULL',
          entity: 'customer',
          entityId: input.customerId,
          newValue: { fields: input.fields, role: input.role },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    } catch (err) {
      // Never let audit failure block PII access
      this.logger.error(`PII audit log failed: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Implement `PiiModule`**

```typescript
// apps/api/src/modules/pii/pii.module.ts
import { Global, Module } from '@nestjs/common';
import { PiiAuditService } from './pii-audit.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [PiiAuditService],
  exports: [PiiAuditService],
})
export class PiiModule {}
```

- [ ] **Step 5: Register `PiiModule` in `app.module.ts`**

Add to imports array:

```typescript
import { PiiModule } from './modules/pii/pii.module';

@Module({
  imports: [
    // ...existing imports...
    PiiModule,
  ],
})
```

- [ ] **Step 6: Run tests to confirm pass**

```bash
cd apps/api && npx jest pii-audit.service.spec
```

Expected: All 3 tests PASS.

- [ ] **Step 7: Run full app build to verify no module resolution error**

```bash
cd apps/api && npm run build
```

Expected: Build succeeds with 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/pii/ apps/api/src/app.module.ts
git commit -m "feat(pii): add PiiAuditService for decryption event logging

- Logs PII_DECRYPT_FULL or PII_DECRYPT_MASKED to AuditLog
- Catches and swallows audit insert errors (never blocks access)
- Globally exported via PiiModule"
```

---

### Task 4: PR for Phase 1 (Foundation)

- [ ] **Step 1: Push branch + open PR**

```bash
git push -u origin feat/pii-encryption-phase1-foundation
gh pr create --title "feat(pii): Phase 1 — foundation utilities + audit service" --body "$(cat <<'EOF'
## Summary
Phase 1 of CTO Roadmap 6.5 PII column-level encryption.

- pii.util.ts: hashPII (HMAC-SHA-256) + maskNationalId/Phone/BankAccount/Email
- PiiAuditService: log PII_DECRYPT_FULL / PII_DECRYPT_MASKED to AuditLog
- env validation: require PII_ENCRYPTION_KEY + PII_HASH_SALT in production
- 16 new unit tests (13 pii.util + 3 pii-audit)

No schema changes, no behavior changes — pure foundation.

## Test plan
- [ ] check-types passes
- [ ] new tests pass (npx jest pii)
- [ ] dev server starts without env vars
EOF
)"
```

- [ ] **Step 2: Wait for review + merge before starting Phase 2**

---

## Phase 2: Schema migration (add nullable encrypted + hash columns) (1 PR)

### Task 5: Add new columns to Customer + TradeIn models

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Migration: auto-generated by `npx prisma migrate dev`

- [ ] **Step 1: Modify Customer model in schema.prisma**

Add the following columns to the Customer model (lines 472+), keeping existing columns intact:

```prisma
model Customer {
  id                       String    @id @default(uuid())

  // === Legacy plaintext columns — KEPT during migration, dropped in Phase 6 ===
  nationalId               String    @unique @map("national_id")
  phone                    String
  phoneSecondary           String?   @map("phone_secondary")
  email                    String?
  addressIdCard            String?   @map("address_id_card")
  addressCurrent           String?   @map("address_current")
  addressWork              String?   @map("address_work")
  guardianNationalId       String?   @map("guardian_national_id")
  guardianPhone            String?   @map("guardian_phone")
  guardianAddress          String?   @map("guardian_address")
  references               Json?

  // === New encrypted columns (Phase 2 — nullable for migration window) ===
  nationalIdEncrypted      String?   @map("national_id_encrypted")
  nationalIdHash           String?   @unique @map("national_id_hash")
  phoneEncrypted           String?   @map("phone_encrypted")
  phoneHash                String?   @map("phone_hash")
  phoneSecondaryEncrypted  String?   @map("phone_secondary_encrypted")
  emailEncrypted           String?   @map("email_encrypted")
  addressIdCardEncrypted   String?   @map("address_id_card_encrypted")
  addressCurrentEncrypted  String?   @map("address_current_encrypted")
  addressWorkEncrypted     String?   @map("address_work_encrypted")
  guardianNationalIdEncrypted String? @map("guardian_national_id_encrypted")
  guardianPhoneEncrypted   String?   @map("guardian_phone_encrypted")
  guardianAddressEncrypted String?   @map("guardian_address_encrypted")
  referencesEncrypted      Json?     @map("references_encrypted")

  // ... rest of fields unchanged ...

  @@index([phoneHash])
  @@map("customers")
}
```

- [ ] **Step 2: Modify TradeIn model**

Add to TradeIn model (around line 2978):

```prisma
model TradeIn {
  // ... existing fields ...
  transferAccountNumber          String?   @map("transfer_account_number")
  transferAccountName            String?   @map("transfer_account_name")
  transferAccountNumberEncrypted String?   @map("transfer_account_number_encrypted")
  transferAccountNameEncrypted   String?   @map("transfer_account_name_encrypted")
  // ... rest unchanged ...
}
```

- [ ] **Step 3: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_pii_encrypted_columns
```

- [ ] **Step 4: Verify generated migration adds columns nullably (no NOT NULL on new columns)**

Read the generated migration file and confirm:
- All new columns are `NULL` (no NOT NULL)
- Indexes added: `customers_national_id_hash_key` (UNIQUE) + `customers_phone_hash_idx`

If verification fails, edit the migration file to remove any NOT NULL constraint.

- [ ] **Step 5: Verify Prisma client generation succeeds**

```bash
cd apps/api && npx prisma generate
```

- [ ] **Step 6: Run check-types**

```bash
./tools/check-types.sh api
```

Expected: 0 errors (existing reads/writes still target legacy columns).

- [ ] **Step 7: Run existing customer tests to confirm no regressions**

```bash
cd apps/api && npx jest customers
```

Expected: All existing tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(pii): add nullable encrypted + hash columns to Customer + TradeIn

Phase 2 of CTO 6.5. Adds:
- Customer: 13 new encrypted columns + nationalIdHash (UNIQUE) + phoneHash (indexed)
- TradeIn: 2 new encrypted columns for customer transfer bank info
- All new columns NULLABLE so existing rows remain valid until backfill

No reads/writes use new columns yet — pure schema addition."
```

- [ ] **Step 9: PR + merge before Phase 3**

```bash
git push -u origin feat/pii-encryption-phase2-schema
gh pr create --title "feat(pii): Phase 2 — schema migration (nullable encrypted columns)"
```

---

## Phase 3: Dual-write + backfill (1 PR)

### Task 6: Update Customer service to dual-write encrypted columns

**Files:**
- Modify: `apps/api/src/modules/customers/customers.service.ts`

- [ ] **Step 1: Identify all create/update methods in CustomersService**

```bash
grep -n "create\|update" apps/api/src/modules/customers/customers.service.ts | head -20
```

Note line numbers for: `create()`, `update()`, any patch methods.

- [ ] **Step 2: Add encryption helpers as private methods**

Add to top of CustomersService class:

```typescript
import { encryptPII } from '../../utils/crypto.util';
import { hashPII } from '../../utils/pii.util';

// Inside CustomersService class:
private get piiKey(): string {
  return process.env.PII_ENCRYPTION_KEY || '';
}

private get hashSalt(): string {
  return process.env.PII_HASH_SALT || '';
}

private encryptCustomerPII(data: Partial<Customer>): Partial<Customer> {
  const result: Partial<Customer> = { ...data };
  const enc = (v: string | null | undefined) => v ? encryptPII(v, this.piiKey) : v;

  if (data.nationalId !== undefined) {
    result.nationalIdEncrypted = enc(data.nationalId) ?? undefined;
    result.nationalIdHash = data.nationalId ? hashPII(data.nationalId, this.hashSalt) : null;
  }
  if (data.phone !== undefined) {
    result.phoneEncrypted = enc(data.phone) ?? undefined;
    result.phoneHash = data.phone ? hashPII(data.phone, this.hashSalt) : null;
  }
  if (data.phoneSecondary !== undefined) result.phoneSecondaryEncrypted = enc(data.phoneSecondary) ?? undefined;
  if (data.email !== undefined) result.emailEncrypted = enc(data.email) ?? undefined;
  if (data.addressIdCard !== undefined) result.addressIdCardEncrypted = enc(data.addressIdCard) ?? undefined;
  if (data.addressCurrent !== undefined) result.addressCurrentEncrypted = enc(data.addressCurrent) ?? undefined;
  if (data.addressWork !== undefined) result.addressWorkEncrypted = enc(data.addressWork) ?? undefined;
  if (data.guardianNationalId !== undefined) result.guardianNationalIdEncrypted = enc(data.guardianNationalId) ?? undefined;
  if (data.guardianPhone !== undefined) result.guardianPhoneEncrypted = enc(data.guardianPhone) ?? undefined;
  if (data.guardianAddress !== undefined) result.guardianAddressEncrypted = enc(data.guardianAddress) ?? undefined;
  if (data.references !== undefined && data.references) {
    result.referencesEncrypted = encryptReferencesJson(data.references, this.piiKey);
  }

  return result;
}
```

Where `encryptReferencesJson` is a helper added to `pii.util.ts` (separate task below if not already added):

```typescript
// Add to apps/api/src/utils/pii.util.ts
import { encryptPII } from './crypto.util';

const REFERENCE_PII_FIELDS = ['firstName', 'lastName', 'phone', 'nationalId', 'address'];

export function encryptReferencesJson(refs: unknown, key: string): unknown {
  if (!Array.isArray(refs)) return refs;
  return refs.map((ref) => {
    if (typeof ref !== 'object' || !ref) return ref;
    const out = { ...ref };
    for (const field of REFERENCE_PII_FIELDS) {
      if (typeof out[field] === 'string' && out[field]) {
        out[field] = encryptPII(out[field], key);
      }
    }
    return out;
  });
}
```

- [ ] **Step 3: Wire encryption into `create()` method**

In CustomersService.create():
- Before `prisma.customer.create()`, transform DTO via `this.encryptCustomerPII(dto)`
- Pass result to Prisma create

- [ ] **Step 4: Wire encryption into `update()` method**

Same pattern for update — transform DTO before passing to Prisma.

- [ ] **Step 5: Add unit tests for dual-write**

```typescript
// In customers.service.spec.ts
describe('PII dual-write (Phase 3)', () => {
  beforeEach(() => {
    process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.PII_HASH_SALT = 'b'.repeat(32);
  });

  it('writes both legacy and encrypted columns on create', async () => {
    await service.create({ nationalId: '1234567890123', phone: '0812345678', name: 'Test' } as any);
    const call = (prisma.customer.create as jest.Mock).mock.calls[0][0];
    expect(call.data.nationalId).toBe('1234567890123'); // legacy
    expect(call.data.nationalIdEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // iv:cipher
    expect(call.data.nationalIdHash).toMatch(/^[0-9a-f]{64}$/); // sha256
    expect(call.data.phoneEncrypted).toBeTruthy();
    expect(call.data.phoneHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips encryption for fields not in update payload', async () => {
    await service.update('cust-1', { name: 'NewName' } as any);
    const call = (prisma.customer.update as jest.Mock).mock.calls[0][0];
    expect(call.data.nationalIdEncrypted).toBeUndefined();
    expect(call.data.phoneEncrypted).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run tests**

```bash
cd apps/api && npx jest customers.service.spec
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customers/ apps/api/src/utils/pii.util.ts
git commit -m "feat(pii): dual-write encrypted columns in CustomersService

- create/update populates both legacy and *Encrypted/*Hash columns
- encryptReferencesJson preserves array structure, encrypts inner PII fields
- 2 new unit tests for dual-write behavior"
```

---

### Task 7: Update TradeIn service for dual-write

**Files:**
- Modify: `apps/api/src/modules/trade-in/trade-in.service.ts`

- [ ] **Step 1: Identify create/update methods** (similar to Task 6 step 1)

- [ ] **Step 2: Add helper `encryptTradeInBankPII()`**

```typescript
import { encryptPII } from '../../utils/crypto.util';

private encryptTradeInBankPII(data: any) {
  const key = process.env.PII_ENCRYPTION_KEY || '';
  return {
    ...data,
    transferAccountNumberEncrypted: data.transferAccountNumber
      ? encryptPII(data.transferAccountNumber, key)
      : undefined,
    transferAccountNameEncrypted: data.transferAccountName
      ? encryptPII(data.transferAccountName, key)
      : undefined,
  };
}
```

- [ ] **Step 3: Wire into trade-in create/accept methods where transferAccountNumber is set**

- [ ] **Step 4: Add 1 unit test verifying dual-write**

- [ ] **Step 5: Run tests + commit**

```bash
git add apps/api/src/modules/trade-in/
git commit -m "feat(pii): dual-write encrypted bank account columns in TradeIn"
```

---

### Task 8: Backfill script for existing data

**Files:**
- Create: `apps/api/scripts/backfill-pii-encryption.ts`

- [ ] **Step 1: Implement backfill script**

```typescript
// apps/api/scripts/backfill-pii-encryption.ts
import { PrismaClient } from '@prisma/client';
import { encryptPII } from '../src/utils/crypto.util';
import { hashPII, encryptReferencesJson } from '../src/utils/pii.util';

async function main() {
  const key = process.env.PII_ENCRYPTION_KEY;
  const salt = process.env.PII_HASH_SALT;
  if (!key || !salt) {
    throw new Error('PII_ENCRYPTION_KEY + PII_HASH_SALT required');
  }

  const prisma = new PrismaClient();
  const BATCH_SIZE = 100;
  let cursor: string | undefined;
  let processed = 0;
  let skipped = 0;

  console.log('Starting Customer PII backfill...');

  // Customer backfill
  while (true) {
    const customers = await prisma.customer.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    });
    if (customers.length === 0) break;

    for (const c of customers) {
      // Skip if already backfilled
      if (c.nationalIdEncrypted && c.nationalIdHash) {
        skipped++;
        continue;
      }
      await prisma.customer.update({
        where: { id: c.id },
        data: {
          nationalIdEncrypted: c.nationalId ? encryptPII(c.nationalId, key) : null,
          nationalIdHash: c.nationalId ? hashPII(c.nationalId, salt) : null,
          phoneEncrypted: c.phone ? encryptPII(c.phone, key) : null,
          phoneHash: c.phone ? hashPII(c.phone, salt) : null,
          phoneSecondaryEncrypted: c.phoneSecondary ? encryptPII(c.phoneSecondary, key) : null,
          emailEncrypted: c.email ? encryptPII(c.email, key) : null,
          addressIdCardEncrypted: c.addressIdCard ? encryptPII(c.addressIdCard, key) : null,
          addressCurrentEncrypted: c.addressCurrent ? encryptPII(c.addressCurrent, key) : null,
          addressWorkEncrypted: c.addressWork ? encryptPII(c.addressWork, key) : null,
          guardianNationalIdEncrypted: c.guardianNationalId ? encryptPII(c.guardianNationalId, key) : null,
          guardianPhoneEncrypted: c.guardianPhone ? encryptPII(c.guardianPhone, key) : null,
          guardianAddressEncrypted: c.guardianAddress ? encryptPII(c.guardianAddress, key) : null,
          referencesEncrypted: c.references ? encryptReferencesJson(c.references, key) : null,
        },
      });
      processed++;
    }
    cursor = customers[customers.length - 1].id;
    console.log(`Processed ${processed}, skipped ${skipped}`);
  }

  console.log(`Customer backfill complete: ${processed} updated, ${skipped} skipped`);

  // TradeIn backfill
  console.log('Starting TradeIn PII backfill...');
  cursor = undefined;
  let tradeProcessed = 0;
  while (true) {
    const trades = await prisma.tradeIn.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    });
    if (trades.length === 0) break;
    for (const t of trades) {
      if (t.transferAccountNumberEncrypted) continue;
      await prisma.tradeIn.update({
        where: { id: t.id },
        data: {
          transferAccountNumberEncrypted: t.transferAccountNumber ? encryptPII(t.transferAccountNumber, key) : null,
          transferAccountNameEncrypted: t.transferAccountName ? encryptPII(t.transferAccountName, key) : null,
        },
      });
      tradeProcessed++;
    }
    cursor = trades[trades.length - 1].id;
  }

  console.log(`TradeIn backfill complete: ${tradeProcessed} updated`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Test on dev DB first**

```bash
cd apps/api && PII_ENCRYPTION_KEY=$(openssl rand -hex 32) PII_HASH_SALT=$(openssl rand -hex 32) npx ts-node scripts/backfill-pii-encryption.ts
```

Expected: prints progress, completes without error.

- [ ] **Step 3: Verify backfill via psql**

```sql
SELECT COUNT(*) FROM customers WHERE national_id IS NOT NULL AND national_id_encrypted IS NULL;
-- Expected: 0
SELECT COUNT(*) FROM customers WHERE national_id_hash IS NOT NULL;
-- Expected: matches non-null national_id count
```

- [ ] **Step 4: Document production run procedure in script header comment**

Add to top of file:

```typescript
/**
 * Production run procedure:
 * 1. Set env vars from Secret Manager: PII_ENCRYPTION_KEY, PII_HASH_SALT
 * 2. Take Cloud SQL backup BEFORE running (gcloud sql backups create ...)
 * 3. Run during low-traffic window (post 22:00 ICT)
 * 4. ts-node scripts/backfill-pii-encryption.ts
 * 5. Verify counts via SQL queries above
 * 6. Idempotent: re-running skips already-backfilled rows
 */
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/backfill-pii-encryption.ts
git commit -m "feat(pii): backfill script for existing Customer + TradeIn rows

- Cursor-paginated batch processing (100 rows/batch)
- Idempotent: skips rows where *Encrypted column already set
- Includes prod run procedure in header comment"
```

- [ ] **Step 6: PR + merge**

Open PR for Phase 3 (dual-write + backfill script). After merge:
- **PROD STEP (manual, by owner):** Set env vars in Cloud Run + run backfill script.
- **DO NOT proceed to Phase 5 until backfill verified in production.**

---

## Phase 5: Switch reads + masking + audit log (1 PR)

### Task 9: Update CustomersService reads to use encrypted columns

**Files:**
- Modify: `apps/api/src/modules/customers/customers.service.ts`

- [ ] **Step 1: Add `decryptCustomerPII()` helper**

```typescript
import { decryptPII } from '../../utils/crypto.util';

private decryptCustomerPII(c: Customer): Customer {
  const key = this.piiKey;
  if (!key || !c) return c;

  return {
    ...c,
    nationalId: c.nationalIdEncrypted ? decryptPII(c.nationalIdEncrypted, key) : c.nationalId,
    phone: c.phoneEncrypted ? decryptPII(c.phoneEncrypted, key) : c.phone,
    phoneSecondary: c.phoneSecondaryEncrypted ? decryptPII(c.phoneSecondaryEncrypted, key) : c.phoneSecondary,
    email: c.emailEncrypted ? decryptPII(c.emailEncrypted, key) : c.email,
    addressIdCard: c.addressIdCardEncrypted ? decryptPII(c.addressIdCardEncrypted, key) : c.addressIdCard,
    addressCurrent: c.addressCurrentEncrypted ? decryptPII(c.addressCurrentEncrypted, key) : c.addressCurrent,
    addressWork: c.addressWorkEncrypted ? decryptPII(c.addressWorkEncrypted, key) : c.addressWork,
    guardianNationalId: c.guardianNationalIdEncrypted ? decryptPII(c.guardianNationalIdEncrypted, key) : c.guardianNationalId,
    guardianPhone: c.guardianPhoneEncrypted ? decryptPII(c.guardianPhoneEncrypted, key) : c.guardianPhone,
    guardianAddress: c.guardianAddressEncrypted ? decryptPII(c.guardianAddressEncrypted, key) : c.guardianAddress,
    references: c.referencesEncrypted ? decryptReferencesJson(c.referencesEncrypted, key) : c.references,
  };
}
```

Add `decryptReferencesJson` to `pii.util.ts`:

```typescript
import { decryptPII, isEncrypted } from './crypto.util';

export function decryptReferencesJson(refs: unknown, key: string): unknown {
  if (!Array.isArray(refs)) return refs;
  return refs.map((ref) => {
    if (typeof ref !== 'object' || !ref) return ref;
    const out = { ...ref };
    for (const field of REFERENCE_PII_FIELDS) {
      if (typeof out[field] === 'string' && isEncrypted(out[field])) {
        out[field] = decryptPII(out[field], key);
      }
    }
    return out;
  });
}
```

- [ ] **Step 2: Update `findOne()`, `findAll()`, `findByNationalId()`, search methods**

For each read method:
- After fetching from Prisma, map results through `decryptCustomerPII()`
- For dedup query: change `where: { nationalId: x }` → `where: { nationalIdHash: hashPII(x, this.hashSalt) }`
- For phone search: change `where: { phone: x }` → `where: { phoneHash: hashPII(x, this.hashSalt) }`

Example for `findByNationalId()`:

```typescript
async findByNationalId(nationalId: string): Promise<Customer | null> {
  const hash = hashPII(nationalId, this.hashSalt);
  const customer = await this.prisma.customer.findUnique({
    where: { nationalIdHash: hash, deletedAt: null },
  });
  return customer ? this.decryptCustomerPII(customer) : null;
}
```

- [ ] **Step 3: Add tests for read decryption**

```typescript
it('decrypts PII columns when returning customer', async () => {
  const encrypted = encryptPII('1234567890123', process.env.PII_ENCRYPTION_KEY!);
  (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
    id: 'c1', nationalId: 'legacy-value', nationalIdEncrypted: encrypted,
    phone: 'legacy', phoneEncrypted: encryptPII('0812345678', process.env.PII_ENCRYPTION_KEY!),
  });
  const result = await service.findOne('c1');
  expect(result.nationalId).toBe('1234567890123'); // decrypted from encrypted column
  expect(result.phone).toBe('0812345678');
});

it('uses hash for nationalId lookup', async () => {
  await service.findByNationalId('1234567890123');
  expect(prisma.customer.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ nationalIdHash: expect.any(String) }) })
  );
});
```

- [ ] **Step 4: Run tests + commit**

```bash
git add apps/api/src/modules/customers/ apps/api/src/utils/pii.util.ts
git commit -m "feat(pii): switch CustomersService reads to use encrypted columns

- All read methods decrypt via decryptCustomerPII() before returning
- Dedup queries use nationalIdHash instead of plaintext nationalId
- Phone search uses phoneHash"
```

---

### Task 10: Apply role-based masking + audit log in CustomersController

**Files:**
- Modify: `apps/api/src/modules/customers/customers.controller.ts`

- [ ] **Step 1: Inject `PiiAuditService`**

```typescript
import { PiiAuditService } from '../pii/pii-audit.service';
import { maskNationalId, maskBankAccount } from '../../utils/pii.util';

constructor(
  private customersService: CustomersService,
  private piiAudit: PiiAuditService,
) {}
```

- [ ] **Step 2: Add helper to apply role-based mask**

```typescript
private applyRoleMask(customer: any, userRole: string) {
  // From Q4 matrix: SALES sees masked nationalId only.
  // OWNER, FINANCE_MANAGER, BRANCH_MANAGER, ACCOUNTANT see full data.
  if (userRole === 'SALES') {
    return {
      ...customer,
      nationalId: maskNationalId(customer.nationalId),
      // phone, address, email full per Q1 matrix
    };
  }
  return customer;
}
```

- [ ] **Step 3: Wire into `findOne()` controller method**

```typescript
@Get(':id')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
async findOne(@Param('id') id: string, @Req() req: any) {
  const customer = await this.customersService.findOne(id);
  if (!customer) throw new NotFoundException();

  const isMasked = req.user.role === 'SALES';
  await this.piiAudit.logDecryption({
    userId: req.user.id,
    customerId: id,
    fields: ['nationalId', 'phone', 'address'],
    role: req.user.role,
    masked: isMasked,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return this.applyRoleMask(customer, req.user.role);
}
```

- [ ] **Step 4: For list endpoint (`findAll`), log batch decryption (single audit entry per request)**

```typescript
async findAll(@Query() query, @Req() req: any) {
  const result = await this.customersService.findAll(query);
  await this.piiAudit.logDecryption({
    userId: req.user.id,
    customerId: `BATCH:${result.data.length}`, // batch marker
    fields: ['nationalId', 'phone'],
    role: req.user.role,
    masked: req.user.role === 'SALES',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  return {
    ...result,
    data: result.data.map((c) => this.applyRoleMask(c, req.user.role)),
  };
}
```

- [ ] **Step 5: Add controller tests**

```typescript
it('masks nationalId for SALES role', async () => {
  service.findOne.mockResolvedValue({ nationalId: '1234567890123', phone: '0812345678' });
  const req = { user: { id: 'u1', role: 'SALES' }, ip: '1.2.3.4', headers: {} };
  const result = await controller.findOne('c1', req);
  expect(result.nationalId).toBe('12345-XXXXX-XX-3');
  expect(result.phone).toBe('0812345678'); // not masked per matrix
});

it('returns full nationalId for OWNER', async () => {
  service.findOne.mockResolvedValue({ nationalId: '1234567890123' });
  const req = { user: { id: 'u1', role: 'OWNER' }, ip: '1.2.3.4', headers: {} };
  const result = await controller.findOne('c1', req);
  expect(result.nationalId).toBe('1234567890123');
});

it('logs PII_DECRYPT_MASKED for SALES', async () => {
  service.findOne.mockResolvedValue({ nationalId: '1234567890123' });
  const req = { user: { id: 'u1', role: 'SALES' }, ip: '1.2.3.4', headers: {} };
  await controller.findOne('c1', req);
  expect(piiAudit.logDecryption).toHaveBeenCalledWith(expect.objectContaining({ masked: true, role: 'SALES' }));
});
```

- [ ] **Step 6: Run tests + commit**

```bash
git add apps/api/src/modules/customers/customers.controller.ts apps/api/src/modules/customers/customers.controller.spec.ts
git commit -m "feat(pii): role-based PII masking + audit log on customer endpoints

- SALES sees masked nationalId (1-2345-XXXXX-XX-3)
- OWNER/FM/BM/Accountant see full PII
- Every decryption logged via PiiAuditService"
```

---

### Task 11: Repeat for TradeIn (mask `transferAccountNumber` for non-finance roles)

**Files:**
- Modify: `apps/api/src/modules/trade-in/trade-in.service.ts` (decrypt on read)
- Modify: `apps/api/src/modules/trade-in/trade-in.controller.ts` (mask + audit)

- [ ] **Step 1: Add `decryptTradeInPII()` to service**

Similar pattern to Task 9 but for TradeIn fields.

- [ ] **Step 2: Mask `transferAccountNumber` for SALES + BRANCH_MANAGER per Q1 matrix**

```typescript
private applyRoleMask(trade: any, userRole: string) {
  if (userRole === 'SALES' || userRole === 'BRANCH_MANAGER') {
    return { ...trade, transferAccountNumber: maskBankAccount(trade.transferAccountNumber) };
  }
  return trade;
}
```

- [ ] **Step 3: Wire audit log + tests + commit**

---

### Task 12: PR for Phase 5

```bash
git push -u origin feat/pii-encryption-phase5-reads-mask-audit
gh pr create --title "feat(pii): Phase 5 — switch reads to encrypted columns + role-based mask + audit"
```

After merge: **monitor production for 1 week** before Phase 6 column drop.

---

## Phase 6: Drop legacy plaintext columns (1 PR)

### Task 13: Schema migration to drop legacy columns

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Migration: auto-generated

- [ ] **Step 1: Verify Phase 5 has been in prod for ≥ 7 days with no rollback signals**

Check Sentry, error rates, customer support reports.

- [ ] **Step 2: Remove legacy columns from Customer model**

Delete the lines for: `nationalId`, `phone`, `phoneSecondary`, `email`, `addressIdCard`, `addressCurrent`, `addressWork`, `guardianNationalId`, `guardianPhone`, `guardianAddress`, `references`.

Rename `*Encrypted` columns to drop the suffix:

```prisma
model Customer {
  // BEFORE: nationalIdEncrypted String? @map("national_id_encrypted")
  // AFTER:
  nationalId  String  @map("national_id") // encrypted AES-256-CBC; lookup via nationalIdHash
  // ... etc
}
```

Use `@map("national_id_encrypted")` initially, then rename column in DB.

- [ ] **Step 3: Generate migration with table column renames**

```bash
cd apps/api && npx prisma migrate dev --name drop_pii_legacy_columns
```

Verify generated SQL includes:
- `ALTER TABLE customers DROP COLUMN national_id;`
- `ALTER TABLE customers RENAME COLUMN national_id_encrypted TO national_id;`
- (repeat for all PII columns)

- [ ] **Step 4: Update CustomersService to remove dual-write code**

Remove `nationalIdEncrypted` references — read/write use `nationalId` directly (which now contains encrypted value).

Keep encryption/decryption logic — just point at the renamed column.

- [ ] **Step 5: Run all customer + tradein tests**

```bash
cd apps/api && npx jest customers trade-in pii
```

Expected: all PASS.

- [ ] **Step 6: Run check-types**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/ apps/api/src/modules/customers/ apps/api/src/modules/trade-in/
git commit -m "feat(pii): Phase 6 — drop legacy plaintext columns

- DROP nationalId/phone/email/addresses (plaintext)
- RENAME nationalIdEncrypted → nationalId (now contains encrypted value)
- Service code simplified: no more dual-write conditionals
- All tests green"
```

- [ ] **Step 8: PR — IMPORTANT: pre-deploy backup mandatory**

In PR description add bold warning:
> **PRE-DEPLOY ACTION REQUIRED:** Take Cloud SQL backup immediately before merge. Migration is destructive (DROP COLUMN). Rollback path: restore from backup.

---

## Verification Checklist (after Phase 6 deploy)

- [ ] `psql -c "SELECT COUNT(*) FROM customers WHERE national_id NOT LIKE '%:%'"` returns 0 (all encrypted)
- [ ] `psql -c "SELECT COUNT(*) FROM customers WHERE national_id_hash IS NULL AND national_id IS NOT NULL"` returns 0
- [ ] Login as SALES → open customer detail → confirms masked display
- [ ] Login as OWNER → open same customer → confirms full display
- [ ] Query AuditLog: `SELECT action, COUNT(*) FROM audit_logs WHERE action LIKE 'PII_DECRYPT%' GROUP BY action;` returns rows
- [ ] No customer-facing errors in Sentry for 48 hours

---

## Self-Review Notes

**Spec coverage:**
- Q1 (encrypt list): all Customer columns + TradeIn customer bank → ✅ Tasks 5, 6, 7, 11
- Q2 (hash columns): nationalIdHash + phoneHash → ✅ Task 5 schema, Task 6 dual-write
- Q3 (2-step migration): 4 PRs (Phase 1 foundation, Phase 2 schema, Phase 3 dual-write+backfill, Phase 5 read-switch+mask, Phase 6 drop) → ✅
- Q4 (role-based mask at backend): SALES masked nationalId/bankAccount → ✅ Tasks 10, 11

**Out-of-scope items flagged:**
- Supplier/Company bank account encryption — separate plan
- Key rotation strategy — separate plan
- DSAR/customer self-service decrypt — Phase 3 PDPA work, separate plan

**Dependencies between phases:**
- Phase 2 must merge + deploy before Phase 3 dual-write can run (column doesn't exist yet)
- Phase 3 backfill must complete in prod before Phase 5 read-switch (otherwise reads return null for old rows)
- Phase 5 must run in prod ≥ 7 days before Phase 6 drop (rollback safety window)
