# SP6 — Bank Accounts Dedicated Page (Design Spec)

**Sub-project:** SP6 (of 6, FINAL) — closes the SP1 placeholder `/finance/bank-accounts`
**Status:** Design approved 2026-05-17
**ETA:** 2-3 commits / 1 day

---

## 1. Goals

Currently bank accounts are configured in Settings (`/settings/general`). Owner wants a dedicated `/finance/bank-accounts` page showing:
- List of bank accounts (cash accounts 11-1101..1103 + bank accounts 11-1201..1203)
- Per-account current balance (from JournalLine sum)
- Recent transactions per account
- Simple reconciliation: bank statement import (CSV) + match against journal entries
- Bank account management (add/edit/disable)

**Non-goals:**
- Real bank API integration (Phase 2)
- Full bank reconciliation workflow (deferred)
- PromptPay/PayLater integration (separate concern)

## 2. Scope

### 2.1 New `BankAccount` model

```prisma
model BankAccount {
  id              String   @id @default(uuid())
  accountCode     String   @unique   // '11-1101'..'11-1203'
  accountName     String              // 'KBank ออมทรัพย์ 123-4-56789-0'
  bankName        String              // 'KBank', 'SCB', etc.
  accountNumber   String?             // bank account number (masked PII)
  accountType     String   @default('SAVINGS')  // SAVINGS / CURRENT / FIXED / CASH
  currency        String   @default('THB')
  isActive        Boolean  @default(true)
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  @@index([accountCode])
  @@index([deletedAt])
  @@map("bank_accounts")
}
```

Migration `20260941000000_add_bank_accounts`:
- CREATE TABLE
- Seed 6 default cash/bank accounts matching CoA 11-1101..1103 + 11-1201..1203 from `.claude/rules/accounting.md`

### 2.2 Endpoints

```
GET /bank-accounts                          # list all
GET /bank-accounts/:code                    # single + balance
GET /bank-accounts/:code/transactions       # paginated journal lines for this account
POST /bank-accounts                         # create (OWNER only)
PATCH /bank-accounts/:code                  # update
PATCH /bank-accounts/:code/disable          # soft-delete
```

Roles: OWNER (write), OWNER/FM/ACCOUNTANT (read).

### 2.3 Balance calculation

```ts
balance = sum(JournalLine.debit) - sum(JournalLine.credit)
  for accountCode in ['11-1101', '11-1102', ...]
  where journalEntry.status='POSTED' AND deletedAt:null
```

Dr-normal for cash/bank accounts → positive balance = cash on hand.

### 2.4 Frontend

`apps/web/src/pages/BankAccountsPage.tsx`:
- Grid of bank account cards (logo, name, current balance, last 5 transactions)
- Click card → drawer/dialog with full transaction history (paginated)
- "เพิ่มบัญชี" button (OWNER only)
- "นำเข้า Statement (CSV)" button (Phase 2 placeholder — disabled with tooltip)

## 3. Test Plan

- API: 5 tests (CRUD + balance calc + transaction list)
- Web: 2 tests (page renders, card click opens drawer)
- Playwright: 2 cases (OWNER view + ACCOUNTANT view)

## 4. PR Breakdown

1. Backend: schema + migration + service + controller + tests
2. Frontend: page + tests + route swap + sidebar update
3. Playwright

## 5. Acceptance Criteria

- [ ] OWNER/FM/ACC can view bank accounts list with balances
- [ ] OWNER can create/edit/disable accounts
- [ ] Per-account transaction history paginated
- [ ] Balance matches Trial Balance
- [ ] Account number masked in UI (PDPA)
- [ ] Tests pass, types clean, no emoji
