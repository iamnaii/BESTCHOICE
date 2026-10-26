# เงินสดย่อยหน้าร้าน S11-1106 — เมนูเติม/คืน + วงเงิน (ข้อ 20.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้าใหม่ `/shop/petty-cash` ให้ OWNER/ผจก.การเงิน เติมและคืนเงินสดย่อย S11-1106 ของสมุด SHOP ภายใต้วงเงินที่ตั้งค่าได้ โดยยอดคงเหลือ = ยอดสุทธิบัญชีในสมุดบัญชี (ตัวเดียวกับด่านจ่ายผู้จัดจำหน่าย) · ทุกการเติม/คืนลงรายการบัญชีอัตโนมัติ

**Architecture:** โมดูลใหม่ `apps/api/src/modules/shop-petty-cash/` (controller → service → Prisma) + template `journal/cpa-templates/shop-petty-cash.template.ts` (ลง `Dr S11-1106 / Cr ธนาคาร` หรือกลับกัน) + ตาราง `shop_petty_cash_movements` (บันทึกคำขอ · หลักฐาน · requestId) · วงเงินเป็น `SystemConfig` key `shop_petty_cash_limit` (ไม่มี = 20,000) · หน้าเว็บ `pages/ShopPettyCashPage/` อ่าน summary/movements และเปิดกล่อง เติม/คืน/ตั้งวงเงิน

**Tech Stack:** NestJS + Prisma (PostgreSQL) · React + React Query + shadcn · jest (unit) · vitest DB (integration ใน `__tests__/` — ต้องเติม glob ใน `deploy-gcp.yml`)

**Spec:** mockup canvas `https://claude.ai/artifact/Q9YhHKUhw7kkawVfcu6yZz` (เจ้าของเคาะ 18/10/2569: วงเงินเริ่มต้น 20,000 · มีปุ่มคืน) + คำตอบฝ่ายบัญชี 16/10 ข้อ 20.1–20.4 (คง S11-1106 · วงเงิน=ค่าตั้งค่า · เลือกธนาคารต้นทางได้ · ไม่ระบุผู้ถือ · หลักฐานเงินสดไม่บังคับ · ธนาคาร+เงินสดย่อยพอ)

## Global Constraints

- สมุด SHOP เท่านั้น (`CompanyResolverService.getShopCompanyId`) · บัญชี `S11-1106` (`SHOP_PETTY_CASH_ACCOUNT`) · ธนาคารต้นทาง/ปลายทาง = `S11-1202` ธนาคารหน้าร้าน (จ่ายออก) ค่าเริ่มต้นตอนเติม · `S11-1201` ธนาคารหน้าร้าน (รับเข้า) ค่าเริ่มต้นตอนคืน
- เติม: `0 < amount ≤ limit − balance` · คืน: `0 < amount ≤ balance` · ทศนิยม 2 ตำแหน่ง · วันที่ ≤ วันนี้ ย้อนหลัง ≤ 365 วัน (`parsePaidAt`) · งวดปิดแล้ว → ลงวันที่บันทึก + Todo แจ้งฝ่ายบัญชี (แบบเดียวกับจ่ายผู้จัดจำหน่าย)
- หลักฐานไม่บังคับ · รูป JPEG/PNG/WEBP ≤ 5MB · เก็บเป็น key `shop-petty-cash/<yyyymmdd>/<uuid>.<ext>` ใน StorageService (ไม่ใช่ data URI)
- สิทธิ์: อ่าน OWNER/FINANCE_MANAGER/ACCOUNTANT/VIEWER · เติม/คืน OWNER/FINANCE_MANAGER · ตั้งวงเงิน OWNER
- กดซ้ำ (requestId เดิม + ชนิด/ยอด/บัญชีเดิม) = คืนรายการเดิม · ค่าต่าง = 409 · บันทึกแล้วแก้ไม่ได้ (ไม่มี void — ผิดให้คืน/เติมกลับ)
- audit หลัง commit (`AuditService.log`) · ไม่มี cron · ไม่มีช่องผู้ถือ
- web bump `26.10.38` · ข้อความ error "เงินสดไม่พอ" ของเมนูจ่ายผู้จัดจำหน่ายชี้มาที่เมนูนี้

## Review Focus

1. กดเติมพร้อมกันสองคน — advisory lock `shop-petty-cash` ใน tx กันยอดรวมเกินวงเงิน (ปักที่ integration spec)
2. ลดวงเงินต่ำกว่ายอดคงเหลือ — หน้าแสดง "เกินวงเงิน" · เติมไม่ได้ (headroom 0) · คืนได้
3. งวดบัญชีของวันที่เลือกปิดแล้ว — ลงวันที่บันทึก + Todo (ไม่ปฏิเสธ)
4. รายการของบัญชีเดียวกันที่ไม่ได้มาจากเมนูนี้ (จ่ายผู้จัดจำหน่าย · JE มือ) — ตารางต้องแสดงเป็น "อื่น ๆ" ไม่หาย ไม่พัง
5. ไฟล์หลักฐานอัปโหลดแล้ว tx ล้ม — ลบ key ทิ้ง ไม่ค้างใน storage

---

### Task 1: Prisma — ตาราง `shop_petty_cash_movements` + enum
Files: `apps/api/prisma/schema.prisma` · `apps/api/prisma/migrations/20261028000000_shop_petty_cash_movements/migration.sql` · `.claude/mcp/sql/grants.sql` (ถ้ามีรายการตารางให้ MCP)
Produces: model `ShopPettyCashMovement { id kind(TOP_UP|RETURN) amount bankAccountCode movedAt postedAt note evidenceKey journalEntryId@unique requestId createdById createdAt updatedAt deletedAt }`

### Task 2: `ShopPettyCashTemplate` (journal) — TDD
Files: `journal/cpa-templates/shop-petty-cash.template.ts` · `journal/__tests__/shop-petty-cash.template.spec.ts` · `journal/journal.module.ts`
Produces: `execute({ idempotencyKey, kind, movementId, amount: Decimal, bankAccountCode, postedAt?, description? }, tx?) → { entryNo, journalEntryId }` · metadata tag `SHOP_PETTY_CASH` flow `shop-petty-cash`

### Task 3: `ShopPettyCashService` — summary/movements (อ่าน) — TDD unit (mock prisma)
Files: `shop-petty-cash/shop-petty-cash.constants.ts` · `shop-petty-cash.service.ts` · `__tests__/shop-petty-cash.service.spec.ts`
Produces: `getSummary()` · `listMovements(month)` (shape ใน types ของเว็บ)

### Task 4: `ShopPettyCashService` — เติม/คืน/ตั้งวงเงิน — TDD unit + integration (DB)
Files: service เดิม · `dto/record-petty-cash-movement.dto.ts` · `dto/set-petty-cash-limit.dto.ts` · `__tests__/shop-petty-cash.integration.spec.ts` · `.github/workflows/deploy-gcp.yml` (PETTY_FILES glob)

### Task 5: Controller + Module + app.module + ข้อความ error เมนูจ่ายผู้จัดจำหน่าย
Files: `shop-petty-cash.controller.ts` · `shop-petty-cash.module.ts` · `app.module.ts` · `purchase-orders/services/supplier-payment.service.ts` · `journal/supplier-payment-accounts.ts` (คอมเมนต์)

### Task 6: Web — types/hook/page/กล่อง 3 ใบ + route + เมนู + acceptance-routes + bump — vitest
Files: `apps/web/src/pages/ShopPettyCashPage/{index.tsx,types.ts,hooks/usePettyCash.ts,components/*.tsx,__tests__/*.test.tsx}` · `App.tsx` · `config/menu.ts` · `docs/reports/uxui-2026-10-14/acceptance-routes.json` · `apps/web/package.json`

### Task 7: เอกสาร + เช็ครวม
Files: `.claude/rules/accounting.md` (หัวข้อใหม่) · `.claude/CLAUDE.md` · check-types all · jest/vitest ที่เกี่ยว · eslint --no-fix · ผู้ตรวจอิสระ → PR
