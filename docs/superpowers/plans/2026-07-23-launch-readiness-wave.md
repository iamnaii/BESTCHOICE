# Launch-Readiness Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดข้อค้างเว็บ shop ให้พร้อมรับลูกค้าจริง: โดเมน `www.bestchoicephone.com` (ฝั่ง code), staff accept/ค้นหา trade-in ได้ครบ, MANUAL re-stamp ราคาสอดคล้องทุกหน้าจอ, ลบซาก 410 stub

**Architecture:** 5 track อิสระต่อกันใน PR เดียว (spec §8): Track E ลบ shop-trade-in stub; Track D re-stamp breakdown ใน MANUAL CAS เดิม; Track B เพิ่ม branch เลือกได้ตอน accept (backend effectiveBranchId + frontend dropdown + เมนู BM); Track C ต่อ search param ที่ server มีอยู่แล้ว; Track A code = SEO/env/CORS/LINE-consolidation (ops ทำแยกแล้ว — รอ owner กด DNS)

**Tech Stack:** NestJS + Prisma (apps/api), React 18 + Vite (apps/web, apps/web-shop), jest --runInBand

**Spec:** `docs/superpowers/specs/2026-07-23-launch-readiness-wave-design.md` (commit `3fe225ee7`)

## Global Constraints

- Branch: `feat/launch-readiness-wave` แตกจาก `origin/main` — ทุก commit อยู่บน branch นี้
- **ห้ามแตะ/commit ไฟล์ WIP ของ user เด็ดขาด:** ทุกไฟล์ใต้ `apps/web/src/components/payment/` และ `apps/web/src/pages/PaymentsPage/` (มี modified/deleted ค้างอยู่ใน working tree) — `git add` เฉพาะ path ที่ระบุในแต่ละ step เท่านั้น **ห้าม `git add -A` / `git add .`**
- เงินใช้ `Prisma.Decimal` เท่านั้น — ห้ามคำนวณราคาแบบ float (เช่น `1 + pct/100`)
- Error messages ภาษาไทย; UI text ภาษาไทย; ใช้ design tokens (ห้าม hardcoded gray/hex)
- jest ฝั่ง api รันด้วย `--runInBand` เสมอ
- **Keep-list Track E (ห้ามแตะ):** `apps/api/src/modules/journal/cpa-templates/shop-trade-in.template.ts`, `journal.module.ts`, spec ของ template (`shop-trade-in.template.spec.ts` ใต้ modules/journal), และทุกอย่างใต้ `apps/api/src/modules/trade-in/` ที่ไม่ได้ระบุใน Track B/D — ลบตาม path ที่ระบุเท่านั้น ห้าม grep-delete
- โดเมนใหม่ = `https://www.bestchoicephone.com` (มี www เสมอ); โดเมนเก่า = `https://shop.bestchoicephone.app`
- เบอร์ `063-134-6356` ใน `chatbot-finance/services/verification.service.ts` — **ห้ามแก้** (รอ owner ยืนยัน)
- คำสั่ง Bash ทุกครั้งเริ่มจาก repo root: `cd /Users/iamnaii/Desktop/App/BESTCHOICE` (cwd reset ได้)

---

### Task 0: สร้าง branch

**Files:** ไม่มี (git เท่านั้น)

- [ ] **Step 1: แตก branch จาก origin/main**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git fetch origin main
git checkout -b feat/launch-readiness-wave origin/main
git status --short   # ต้องเห็นเฉพาะไฟล์ payment WIP ของ user (M/D) — ห้ามแตะ
```

Expected: branch ใหม่ชี้ origin/main; ไฟล์ dirty มีเฉพาะใต้ `apps/web/src/components/payment/` + `apps/web/src/pages/PaymentsPage/`

---

### Task 1: Track E — ลบ shop-trade-in 410 stub (ครบกำหนด)

**Files:**
- Delete: `apps/api/src/modules/shop-trade-in/` (2 ไฟล์: `shop-trade-in.controller.ts`, `shop-trade-in.module.ts`)
- Modify: `apps/api/src/app.module.ts` (import :123 + registration :355)
- Modify: `apps/api/src/modules/shop-buyback/shop-buyback.controller.ts` (route `quick-quote` :42-46 + `GoneException` import :1)
- Modify: `apps/api/src/modules/shop-buyback/shop-buyback.routing.spec.ts` (case 410 :54-60)
- Modify: `apps/api/src/modules/shop-buyback/shop-buyback.service.ts` (comment :31-33)
- Modify: `.claude/rules/security.md` (:33)

**Interfaces:**
- Consumes: ไม่มี
- Produces: route `POST /shop/buyback/quick-quote` และ module `shop-trade-in` หายไปถาวร (ไม่มี task อื่นพึ่ง)

- [ ] **Step 1: ลบ test case 410 ใน routing spec**

ใน `shop-buyback.routing.spec.ts` ลบ block นี้ทั้งก้อน (บรรทัด ~54-60):

```ts
  it('POST /shop/buyback/quick-quote → 410 Gone', async () => {
    await request(app.getHttpServer())
      .post('/shop/buyback/quick-quote')
      .send({})
      .expect(410);
  });
```

- [ ] **Step 2: ลบ route quick-quote + GoneException import ใน controller**

ใน `shop-buyback.controller.ts`:

บรรทัด 1 เปลี่ยนจาก:
```ts
import { Body, Controller, Get, GoneException, Param, Post, Req, UseGuards } from '@nestjs/common';
```
เป็น:
```ts
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
```

ลบ block นี้ทั้งก้อน (ระหว่าง `submit()` กับ comment `⚠️ ต้องอยู่ท้ายสุดเสมอ`):
```ts
  /** Endpoint เก่า — คงไว้ 1 release เป็น 410 กัน SPA bundle เก่าใน cache แล้วค่อยลบ */
  @Post('quick-quote')
  quickQuoteGone() {
    throw new GoneException('เวอร์ชันหน้าเว็บเก่าเกินไป กรุณารีเฟรชหน้า (Ctrl+R) แล้วลองใหม่');
  }
```

- [ ] **Step 3: ลบ module dir + ถอดจาก app.module.ts**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git rm -r apps/api/src/modules/shop-trade-in
```

ใน `apps/api/src/app.module.ts` ลบ 2 บรรทัด:
- บรรทัด 123: `import { ShopTradeInModule } from './modules/shop-trade-in/shop-trade-in.module';`
- บรรทัด 355: `    ShopTradeInModule,`

- [ ] **Step 4: reword comment ใน shop-buyback.service.ts**

เปลี่ยน comment บรรทัด ~31-33 จาก:
```ts
/**
 * Engine เดียวของหน้า /sell (ขาย/เทิร์น iPhone) — intake engine เก่าของ
 * shop-trade-in ถูกปลดระวางแล้ว (spec /sell 2026-07-18) เหลือแค่ 410 stub
 */
```
เป็น:
```ts
/**
 * Engine เดียวของหน้า /sell (ขาย/เทิร์น iPhone) — intake engine เก่าของ
 * shop-trade-in ถูกปลดระวางและลบออกแล้ว (launch-readiness wave 2026-07-23)
 */
```

- [ ] **Step 5: ถอด shop-trade-in จาก security.md public list**

ใน `.claude/rules/security.md` บรรทัด 33 เปลี่ยนจาก:
```
- `shop-*` storefront family (`shop-catalog`, `shop-reviews` read, `shop-trade-in`, `shop-buyback`, `shop-installment-apply` submit/status, `shop/promotions`) — public ตาม design ของ web-shop สำหรับ anonymous shoppers; ทุกตัว guard ด้วย `ShopBotDefenseGuard` + throttle และ response ต้อง PII-redacted / display-safe fields เท่านั้น
```
เป็น:
```
- `shop-*` storefront family (`shop-catalog`, `shop-reviews` read, `shop-buyback`, `shop-installment-apply` submit/status, `shop/promotions`) — public ตาม design ของ web-shop สำหรับ anonymous shoppers; ทุกตัว guard ด้วย `ShopBotDefenseGuard` + throttle และ response ต้อง PII-redacted / display-safe fields เท่านั้น
```

- [ ] **Step 6: ตรวจ keep-list ยังอยู่ครบ + รัน suites**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
ls apps/api/src/modules/journal/cpa-templates/shop-trade-in.template.ts          # ต้องยังอยู่
grep -c "ShopTradeInTemplate" apps/api/src/modules/journal/journal.module.ts     # ต้อง > 0
grep -rn "shop-trade-in/" apps/api/src --include="*.ts" | grep -v cpa-templates  # ต้องว่าง (ไม่มี import ค้าง)
cd apps/api && npx jest src/modules/shop-buyback --runInBand
npx jest shop-trade-in.template --runInBand
npx tsc --noEmit
```

Expected: shop-buyback ทุก spec PASS (รวม routing spec ที่ไม่มี case 410 แล้ว), template spec PASS, tsc 0 error

- [ ] **Step 7: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/src/app.module.ts apps/api/src/modules/shop-buyback .claude/rules/security.md
git commit -m "chore(shop): remove shop-trade-in 410 stub — retirement window elapsed (Track E)"
```

(`git rm` จาก Step 3 stage ให้แล้ว)

---

### Task 2: Track D — MANUAL re-stamp breakdown (ทั้งสอง flow) + audit หลัง CAS

**Files:**
- Modify: `apps/api/src/modules/trade-in/services/online-appraisal.service.ts` (MANUAL branch ~:112-137 + หลัง CAS ~:175)
- Test: `apps/api/src/modules/trade-in/services/online-appraisal.service.spec.ts`

**Interfaces:**
- Consumes: `tradeIn.quoteBreakdown` snapshot (`price/cashPrice/exchangePrice/bonusPct` เป็น string), CAS `updateMany` + `whereGuard` เดิม
- Produces: MANUAL เขียน `estimatedValue` (Decimal) + `quoteBreakdown` ใหม่ลง `extraData`; auditLog `TRADE_IN_ONLINE_MANUAL_PRICE` เขียน**หลัง** CAS สำเร็จเท่านั้น (Task ไม่มีผู้บริโภคอื่น — accept() อ่าน `breakdown.cashPrice` อยู่แล้วได้ค่าถูกอัตโนมัติ)

- [ ] **Step 1: เขียน failing tests**

เพิ่ม describe block นี้ท้ายไฟล์ `online-appraisal.service.spec.ts` (ใน describe `OnlineAppraisalService` — ใช้ fixture `ONLINE_TRADEIN`/`EXCHANGE_TRADEIN` และ `prisma` mock ที่มีอยู่แล้ว):

```ts
  describe('MANUAL re-stamp (launch-wave Track D)', () => {
    const manualDto = (price: number) => ({
      mode: 'MANUAL' as const,
      offeredPrice: price,
      reason: 'ปรับราคาตามสภาพจริง',
    });

    it('BUYBACK: estimatedValue + breakdown.price + cashPrice = ราคาใหม่ทั้งหมด', async () => {
      await service.appraiseOnline('ti-1', manualDto(11000), 'u1', 'OWNER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.estimatedValue.toString()).toBe('11000');
      expect(data.quoteBreakdown.price).toBe('11000.00');
      expect(data.quoteBreakdown.cashPrice).toBe('11000.00');
    });

    it('EXCHANGE: exchangePrice = manual, cashPrice inverse จาก snapshot bonusPct (floor to tens)', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...EXCHANGE_TRADEIN });
      await service.appraiseOnline('ti-1', manualDto(14000), 'u1', 'OWNER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.estimatedValue.toString()).toBe('14000');
      expect(data.quoteBreakdown.price).toBe('14000.00');
      expect(data.quoteBreakdown.exchangePrice).toBe('14000.00');
      // 14000 × 100 ÷ 110 = 12727.27… → floor to tens = 12720
      expect(data.quoteBreakdown.cashPrice).toBe('12720.00');
    });

    it('EXCHANGE record เก่าไม่มี bonusPct → cashPrice = manual ตรงๆ', async () => {
      const legacy = { ...EXCHANGE_TRADEIN, quoteBreakdown: { maxPrice: '14500.00', price: '13660.00', lines: [] } };
      prisma.tradeIn.findFirst.mockResolvedValue(legacy);
      await service.appraiseOnline('ti-1', manualDto(13000), 'u1', 'OWNER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.quoteBreakdown.cashPrice).toBe('13000.00');
      expect(data.quoteBreakdown.price).toBe('13000.00');
    });

    it('walk-in ไม่มี quoteBreakdown → stamp เฉพาะ estimatedValue', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, quoteBreakdown: null });
      await service.appraiseOnline('ti-1', manualDto(9000), 'u1', 'OWNER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.estimatedValue.toString()).toBe('9000');
      expect(data.quoteBreakdown).toBeUndefined();
    });

    it('audit เขียนหลัง CAS สำเร็จ — race-loser (count=0) ต้องไม่มี audit', async () => {
      prisma.tradeIn.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.appraiseOnline('ti-1', manualDto(9000), 'u1', 'OWNER'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('CAS สำเร็จ → audit ถูกเขียน 1 ครั้งพร้อม oldValue/newValue', async () => {
      await service.appraiseOnline('ti-1', manualDto(11000), 'u1', 'OWNER');
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const arg = prisma.auditLog.create.mock.calls[0][0].data;
      expect(arg.action).toBe('TRADE_IN_ONLINE_MANUAL_PRICE');
      expect(arg.newValue.offeredPrice).toBe(11000);
    });
  });
```

- [ ] **Step 2: รันให้เห็น fail**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest src/modules/trade-in/services/online-appraisal.service.spec.ts --runInBand
```

Expected: FAIL — เคสใหม่ทั้ง 6 แดง (breakdown ไม่ถูก stamp / audit ถูกเรียกก่อน CAS)

- [ ] **Step 3: แก้ online-appraisal.service.ts**

**3a — MANUAL branch:** แทน block เดิม (else-branch `// MANUAL` ที่จบด้วย `await this.prisma.auditLog.create({...});`) ด้วย:

```ts
    } else {
      // MANUAL
      if (userRole !== 'OWNER') {
        throw new ForbiddenException('ราคานอกระบบประเมิน — เฉพาะเจ้าของร้าน (OWNER) เท่านั้น');
      }
      if (dto.offeredPrice === undefined || dto.offeredPrice <= 0) {
        throw new BadRequestException('กรุณาระบุราคาที่เสนอ');
      }
      if (!dto.reason || dto.reason.trim().length < 3) {
        throw new BadRequestException('ต้องระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)');
      }
      offeredPrice = new Prisma.Decimal(dto.offeredPrice);

      // Re-stamp ราคาลง estimatedValue + breakdown ให้ invariant
      // price == estimatedValue == offeredPrice กลับมาถูกทุกหน้าจอ (รวมหน้า status
      // ลูกค้า) หลัง OWNER แก้ราคามือ — ก่อนหน้านี้ MANUAL ไม่แตะ breakdown เลย
      // ทำให้ลูกค้าเห็นราคาเก่าค้าง
      const oldBreakdown = tradeIn.quoteBreakdown as Record<string, unknown> | null;
      if (oldBreakdown) {
        const newBreakdown: Record<string, unknown> = {
          ...oldBreakdown,
          price: offeredPrice.toFixed(2),
        };
        if (tradeIn.flow === 'EXCHANGE') {
          // ราคาเครดิตที่ตกลงกับลูกค้าคือตัวจริง — inverse หา cashPrice จาก snapshot
          // bonusPct (ไม่ใช่ config ปัจจุบัน); floor to tens เหมือน pricing เดิม
          // label "+X%" จึงคลาดได้ ~1% บน record ที่แก้มือ (ยอมรับตาม spec launch-wave §4)
          newBreakdown.exchangePrice = offeredPrice.toFixed(2);
          const pctRaw = oldBreakdown.bonusPct;
          const bonusPct =
            typeof pctRaw === 'string' || typeof pctRaw === 'number'
              ? new Prisma.Decimal(pctRaw)
              : null;
          if (bonusPct && bonusPct.gt(0)) {
            const HUNDRED = new Prisma.Decimal(100);
            const rawCash = offeredPrice.mul(HUNDRED).div(HUNDRED.plus(bonusPct));
            newBreakdown.cashPrice = rawCash.div(10).floor().mul(10).toFixed(2);
          } else {
            // record เก่าก่อน dual-price ไม่มีโบนัส
            newBreakdown.cashPrice = offeredPrice.toFixed(2);
          }
        } else {
          newBreakdown.cashPrice = offeredPrice.toFixed(2);
        }
        extraData = {
          estimatedValue: offeredPrice,
          quoteBreakdown: newBreakdown as Prisma.InputJsonValue,
        };
      } else {
        extraData = { estimatedValue: offeredPrice };
      }
    }
```

**3b — audit หลัง CAS:** หลัง block `if (result.count === 0) { throw ... }` และก่อน `return this.prisma.tradeIn.findUnique(...)` เพิ่ม:

```ts
    // MANUAL: เขียน audit หลัง CAS สำเร็จเท่านั้น — race-loser ต้องไม่ทิ้ง audit
    // ของราคาที่ไม่เคยเกิดจริง (hardening ตาม spec launch-wave §4)
    if (dto.mode === 'MANUAL') {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'TRADE_IN_ONLINE_MANUAL_PRICE',
          entity: 'trade_in',
          entityId: id,
          oldValue: {
            estimatedValue: tradeIn.estimatedValue?.toString() ?? null,
            offeredPrice: tradeIn.offeredPrice?.toString() ?? null,
          },
          newValue: { offeredPrice: dto.offeredPrice, reason: dto.reason },
        },
      });
    }
```

- [ ] **Step 4: รันให้เขียว**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest src/modules/trade-in/services/online-appraisal.service.spec.ts --runInBand
npx tsc --noEmit
```

Expected: PASS ทุกเคส (เดิม + ใหม่ 6), tsc 0 error

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/src/modules/trade-in/services/online-appraisal.service.ts apps/api/src/modules/trade-in/services/online-appraisal.service.spec.ts
git commit -m "fix(trade-in): MANUAL re-stamps estimatedValue+breakdown both flows; audit only after CAS success (Track D)"
```

---

### Task 3: Track B backend — accept() effectiveBranchId

**Files:**
- Modify: `apps/api/src/modules/trade-in/dto/trade-in.dto.ts` (`AcceptTradeInDto` :145-175)
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts` (accept() :339-478)
- Modify: `apps/api/src/modules/trade-in/services/trade-in-query.service.ts` (comment note ใน findAll)
- Test: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts`

**Interfaces:**
- Consumes: `AcceptTradeInDto` เดิม, `shopAccountResolver.resolveOutflowCashAccount(branchId, paymentMethod, tx)`
- Produces: `AcceptTradeInDto.branchId?: string` (optional) — Task 4 (frontend) ส่ง field นี้เมื่อ record ไม่มีสาขา; error 400 ข้อความ `'รายการนี้ผูกสาขาแล้ว'` (ชนกัน) และ `'รายการเทรดอินไม่มีข้อมูลสาขา — กรุณาเลือกสาขาที่รับเครื่อง'` (ไม่มีสาขา)

- [ ] **Step 1: เขียน failing tests**

เพิ่ม describe block นี้ท้ายไฟล์ `trade-in-lifecycle.service.spec.ts` (ใน describe หลัก — ใช้ `makeTx`/`prisma`/`shopAccountResolver` ที่มีอยู่):

```ts
  describe('accept effectiveBranchId (launch-wave Track B)', () => {
    const ONLINE_NO_BRANCH = {
      id: 'ti-9',
      status: 'APPRAISED',
      deletedAt: null,
      flow: 'BUYBACK',
      branchId: null,
      offeredPrice: new Decimal(5000),
      estimatedValue: null,
      imei: null,
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 12',
      deviceColor: null,
      deviceStorage: null,
      deviceCondition: 'A',
      notes: null,
      quoteBreakdown: null,
      firstAppraisedAt: null,
    };
    const BASE_DTO = {
      idCardVerified: true,
      sellerConsentSigned: true,
      paymentMethod: 'CASH' as const,
    };

    it('record ออนไลน์ (branchId null) + dto.branchId → product/JE/persist ใช้สาขาที่เลือก', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH });
      tx.product.create.mockResolvedValue({ id: 'p-1' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-9', status: 'ACCEPTED' });
      shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1101');

      await service.accept('ti-9', { ...BASE_DTO, branchId: 'br-7' }, 'u1');

      expect(tx.product.create.mock.calls[0][0].data.branchId).toBe('br-7');
      expect(tx.tradeIn.update.mock.calls[0][0].data.branchId).toBe('br-7');
      expect(shopAccountResolver.resolveOutflowCashAccount).toHaveBeenCalledWith('br-7', 'CASH', tx);
    });

    it('record ออนไลน์ไม่มีสาขา + ไม่ส่ง dto.branchId → 400', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH });
      await expect(service.accept('ti-9', { ...BASE_DTO }, 'u1')).rejects.toThrow(
        'รายการเทรดอินไม่มีข้อมูลสาขา — กรุณาเลือกสาขาที่รับเครื่อง',
      );
    });

    it('walk-in (branchId ผูกแล้ว) ไม่ส่ง dto → ใช้สาขาเดิม (back-compat)', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH, branchId: 'br-1' });
      tx.product.create.mockResolvedValue({ id: 'p-2' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-9', status: 'ACCEPTED' });
      shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1101');

      await service.accept('ti-9', { ...BASE_DTO }, 'u1');

      expect(tx.product.create.mock.calls[0][0].data.branchId).toBe('br-1');
      expect(shopAccountResolver.resolveOutflowCashAccount).toHaveBeenCalledWith('br-1', 'CASH', tx);
    });

    it('ผูกสาขาแล้ว + dto.branchId ต่างค่า → 400 รายการนี้ผูกสาขาแล้ว', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH, branchId: 'br-1' });
      await expect(
        service.accept('ti-9', { ...BASE_DTO, branchId: 'br-2' }, 'u1'),
      ).rejects.toThrow('รายการนี้ผูกสาขาแล้ว');
    });

    it('ผูกสาขาแล้ว + dto.branchId ค่าเดียวกัน → ผ่าน (idempotent)', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH, branchId: 'br-1' });
      tx.product.create.mockResolvedValue({ id: 'p-3' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-9', status: 'ACCEPTED' });
      shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1101');

      await service.accept('ti-9', { ...BASE_DTO, branchId: 'br-1' }, 'u1');
      expect(tx.product.create.mock.calls[0][0].data.branchId).toBe('br-1');
    });
  });
```

- [ ] **Step 2: รันให้เห็น fail**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts --runInBand
```

Expected: FAIL — เคส branchId null โดน 400 ข้อความเก่า, เคส dto.branchId ไม่มีผล

- [ ] **Step 3: เพิ่ม branchId ใน AcceptTradeInDto**

ใน `dto/trade-in.dto.ts` เพิ่มท้าย class `AcceptTradeInDto` (หลัง `sellerSignatureBase64`):

```ts
  /**
   * สาขาที่รับเครื่อง — ใช้เฉพาะ record ออนไลน์ที่ยังไม่ผูกสาขา (branchId null)
   * record ที่ผูกสาขาแล้วส่งค่าต่างมา = 400 (กัน re-home ข้ามสาขาเงียบๆ)
   */
  @IsString()
  @IsOptional()
  branchId?: string;
```

- [ ] **Step 4: แก้ accept() ใน trade-in-lifecycle.service.ts**

แทน null-guard เดิม:

```ts
      if (!tradeIn.branchId) {
        throw new BadRequestException(
          'รายการเทรดอินไม่มีข้อมูลสาขา — ไม่สามารถรับเข้าสต๊อคได้',
        );
      }
```

ด้วย:

```ts
      // Record ออนไลน์เกิดมา branchId=null — ให้ staff เลือกสาขาตอน accept ได้
      // (BranchGuard เช็ค body.branchId ไปแล้วก่อนถึงตรงนี้ — BM เลือกสาขาอื่น = 403)
      if (tradeIn.branchId && dto.branchId && dto.branchId !== tradeIn.branchId) {
        throw new BadRequestException('รายการนี้ผูกสาขาแล้ว');
      }
      const effectiveBranchId = tradeIn.branchId ?? dto.branchId ?? null;
      if (!effectiveBranchId) {
        throw new BadRequestException(
          'รายการเทรดอินไม่มีข้อมูลสาขา — กรุณาเลือกสาขาที่รับเครื่อง',
        );
      }
```

แล้วใช้ `effectiveBranchId` แทน `tradeIn.branchId` ที่ **3 จุด**:
1. `product.create` → `branchId: effectiveBranchId,`
2. `tx.tradeIn.update` → เพิ่ม `branchId: effectiveBranchId,` ใน `data` (บรรทัดแรกๆ ของ data ก่อน `status: 'ACCEPTED'`)
3. `resolveOutflowCashAccount(effectiveBranchId, dto.paymentMethod, tx)`

- [ ] **Step 5: เพิ่ม comment note ใน findAll (trade-in-query.service.ts)**

เหนือบรรทัด `if (branchId) where.branchId = branchId;` ใน `findAll` เพิ่ม:

```ts
    // NOTE (launch-wave §2): findAll ไม่ scope ตามสาขาโดยเจตนา — record ออนไลน์
    // เกิดมา branchId=null; ถ้าอนาคตเพิ่ม branch scoping ต้อง OR branchId=null เสมอ
    // ไม่งั้นรายการออนไลน์หายจากตา BRANCH_MANAGER ก่อนได้ accept
```

- [ ] **Step 6: รันให้เขียว**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest src/modules/trade-in --runInBand
npx tsc --noEmit
```

Expected: PASS ทั้ง module (lifecycle เดิม+ใหม่ 5, online-appraisal, controller, routing, service), tsc 0

- [ ] **Step 7: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/src/modules/trade-in
git commit -m "feat(trade-in): accept online records with staff-chosen branch (effectiveBranchId, Track B backend)"
```

---

### Task 4: Track B frontend — เมนู BM + AcceptModal branch dropdown

**Files:**
- Modify: `apps/web/src/config/menu.ts` (BRANCH_MANAGER_CONFIG `bm-sales` items ~:220)
- Modify: `apps/web/src/components/CommandPalette.tsx` (pages list ~:55 + lucide import)
- Modify: `apps/web/src/pages/TradeInPage/types.ts` (TradeIn interface + AcceptModal body type)
- Modify: `apps/web/src/pages/TradeInPage/components/AcceptModal.tsx`
- Modify: `apps/web/src/pages/TradeInPage/index.tsx` (acceptMutation body type)

**Interfaces:**
- Consumes: `POST /trade-ins/:id/accept` รับ `branchId?` (Task 3), `GET /branches` → `{id,name}[]`, `useAuth().user` (`role`, `branchId`)
- Produces: `onConfirm(id, body: AcceptFormState & { branchId?: string })`

- [ ] **Step 1: เพิ่มเมนู /trade-in ให้ BRANCH_MANAGER**

ใน `menu.ts` section `bm-sales` (BRANCH_MANAGER_CONFIG) เพิ่มบรรทัดนี้ต่อจาก `{ label: 'เช็คเครดิตลูกค้าใหม่', path: '/customer-intake', icon: UserSearch },`:

```ts
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
```

(label/icon เดียวกับ SALES:158 และ OWNER:494; `Smartphone` import อยู่แล้ว)

- [ ] **Step 2: เพิ่มรายการใน CommandPalette**

ใน `CommandPalette.tsx` array `pages` เพิ่มต่อจากบรรทัด `{ label: 'รายชื่อผู้ติดต่อ', ... }`:

```ts
  { label: 'รับซื้อมือสอง / เทิร์น', path: '/trade-in', icon: Smartphone, keywords: 'trade-in buyback sell รับซื้อ เทิร์น มือสอง', roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'] },
```

ถ้า `Smartphone` ยังไม่อยู่ใน lucide-react import ของไฟล์นี้ → เพิ่มเข้า import list

- [ ] **Step 3: เพิ่ม branchId ใน types.ts**

ใน `TradeInPage/types.ts` interface `TradeIn` เพิ่ม (ใกล้ field อื่นระดับบนสุด ก่อน `quoteBreakdown`):

```ts
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
```

- [ ] **Step 4: AcceptModal — branch dropdown**

ใน `AcceptModal.tsx`:

**4a imports** — เพิ่มบนสุด:
```ts
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
```

**4b prop type** — เปลี่ยน `onConfirm` ใน `AcceptModalProps`:
```ts
  onConfirm: (id: string, body: AcceptFormState & { branchId?: string }) => void;
```

**4c state + query** — ใน component body ก่อน `handleConfirm`:
```ts
  const { user } = useAuth();
  // Mirror CROSS_BRANCH_ROLES ฝั่ง backend (branch-access.util.ts) — role อื่นล็อกสาขาตัวเอง
  const canPickBranch = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');
  const needBranch = !!item && !item.branchId;
  const [branchId, setBranchId] = useState<string>('');
  useEffect(() => {
    if (item) setBranchId(item.branchId ?? user?.branchId ?? '');
  }, [item, user?.branchId]);
  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: needBranch && canPickBranch,
  });
```

**4d validation** — ใน `handleConfirm` เพิ่มก่อนเช็ค `idCardVerified`:
```ts
    if (needBranch && !branchId) {
      toast.error('กรุณาเลือกสาขาที่รับเครื่อง');
      return;
    }
```
และเปลี่ยนบรรทัดสุดท้ายของ `handleConfirm` เป็น:
```ts
    onConfirm(item.id, needBranch ? { ...form, branchId } : form);
```

**4e UI** — เพิ่ม block นี้หลัง `</div>` ของ block ข้อมูลอุปกรณ์/ราคาตกลง (ก่อน checkbox แรก):
```tsx
          {needBranch && (
            <div>
              <Label>สาขาที่รับเครื่อง *</Label>
              {canPickBranch ? (
                <select
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  <option value="">-- เลือกสาขา --</option>
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  รับเข้าสาขาของคุณโดยอัตโนมัติ (รายการออนไลน์ยังไม่ผูกสาขา)
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 5: ปรับ acceptMutation ใน index.tsx**

ใน `TradeInPage/index.tsx` เปลี่ยน type ของ `acceptMutation`:
```ts
  const acceptMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: AcceptFormState & { branchId?: string } }) =>
      api.post(`/trade-ins/${id}/accept`, body),
```
(ที่เหลือเหมือนเดิม — `onConfirm={(id, body) => acceptMutation.mutate({ id, body })}` ใช้ได้เลย)

- [ ] **Step 6: typecheck + build**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web
npx tsc --noEmit
npx eslint src/config/menu.ts src/components/CommandPalette.tsx src/pages/TradeInPage
```

Expected: 0 error

- [ ] **Step 7: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/web/src/config/menu.ts apps/web/src/components/CommandPalette.tsx apps/web/src/pages/TradeInPage
git commit -m "feat(trade-in): BM menu entry + branch picker in AcceptModal for online records (Track B frontend)"
```

---

### Task 5: Track C — ค้นหาตาราง trade-in (frontend-only)

**Files:**
- Modify: `apps/web/src/pages/TradeInPage/index.tsx` (search state + params)
- Modify: `apps/web/src/pages/TradeInPage/components/TradeInTable.tsx` (ถอด client-filter :344-345)

**Interfaces:**
- Consumes: `GET /trade-ins?search=` (server ครอบ sellerName/sellerPhone/imei/device/voucher/customer อยู่แล้ว — **ห้ามแตะ backend**)
- Produces: ไม่มี

- [ ] **Step 1: เพิ่ม search state + debounce ใน index.tsx**

**1a** — import `useEffect` (แก้บรรทัดแรก):
```ts
import { useState, useEffect } from 'react';
```

**1b** — เพิ่ม state หลัง `const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');`:
```ts
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 400);
  // ค่า search เปลี่ยน → กลับหน้า 1 เสมอ (กันหน้าเกินจำนวนผลลัพธ์ใหม่)
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);
```

**1c** — query: เปลี่ยน `queryKey` และเพิ่ม param:
```ts
    queryKey: ['trade-ins', page, sourceFilter, flowFilter, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 50 };
      if (sourceFilter !== 'ALL') params.submissionSource = sourceFilter;
      if (flowFilter !== 'ALL') params.flow = flowFilter;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const res = await api.get('/trade-ins', { params });
      return res.data;
    },
```

- [ ] **Step 2: เพิ่มช่องค้นหาใน filter row**

**2a** — import Input (บนสุดของ index.tsx):
```ts
import { Input } from '@/components/ui/input';
```

**2b** — ใน `<div className="flex flex-wrap items-center gap-4 mb-4">` (filter row ของ tab list) เพิ่มเป็น child แรกก่อน block "ที่มา:":
```tsx
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ค้นหา ชื่อ/เบอร์ผู้ขาย, IMEI, รุ่น, เลขใบสำคัญ..."
              className="h-8 w-full sm:w-72"
            />
```

- [ ] **Step 3: ถอด client-filter พังใน TradeInTable.tsx**

ลบ 2 บรรทัดนี้จาก `<DataTable ...>` (:344-345):
```tsx
            searchable
            searchPlaceholder="ค้นหาลูกค้า, ยี่ห้อ, รุ่น..."
```

- [ ] **Step 4: typecheck**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web
npx tsc --noEmit
npx eslint src/pages/TradeInPage
```

Expected: 0 error

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/web/src/pages/TradeInPage
git commit -m "feat(trade-in): server-side search box (name/phone/imei/voucher) replaces broken client filter (Track C)"
```

---

### Task 6: Track A code — SEO/env/CORS/LINE consolidation

**Files:**
- Modify: `apps/web-shop/index.html` (:17, :18, :35)
- Modify: `apps/web-shop/public/sitemap.xml` (11 loc), `apps/web-shop/public/robots.txt` (Sitemap line)
- Modify: `apps/web-shop/src/hooks/usePageMeta.ts` (canonical per-route)
- Modify: `.github/workflows/deploy-gcp.yml` (env block + comment :448)
- Modify: `.env.example` (:142)
- Modify: `apps/api/src/main.ts` (CORS ~:111)
- Modify: `apps/api/src/modules/integrations/integration-registry.ts` (:405)
- Modify: `apps/web-shop/src/lib/api.ts` (comment :12)
- Modify (LINE consolidation — 9 ไฟล์ 10 จุด): `HomeHero.tsx`, `InstallmentTermsPage.tsx`, `ContactPage.tsx`, `ReturnsPage.tsx`, `PromotionsPage.tsx`, `ApplyStatusPage.tsx`, `ApplySuccessPage.tsx`, `SellStatusPage.tsx` (2 จุด), `SellQuotePage.tsx`

**Interfaces:**
- Consumes: `shopInfo.lineUrl` จาก `apps/web-shop/src/lib/copy.ts` (มีอยู่แล้ว — ไม่ต้องแก้ copy.ts)
- Produces: ไม่มี

- [ ] **Step 1: index.html — โดเมนใหม่**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
grep -c "shop.bestchoicephone.app" apps/web-shop/index.html   # expect 3
```

แทนทั้ง 3 จุด (og:url :17, canonical :18, JSON-LD "url" :35): `https://shop.bestchoicephone.app` → `https://www.bestchoicephone.com`

หมายเหตุ: `"telephone": "+66955678887"` มีใน JSON-LD อยู่แล้ว (PR #1374) — แค่ verify ว่ายังอยู่ ไม่ต้องเพิ่ม

- [ ] **Step 2: sitemap.xml + robots.txt**

- `sitemap.xml`: แทน `https://shop.bestchoicephone.app` → `https://www.bestchoicephone.com` ทั้ง 11 `<loc>`
- `robots.txt` บรรทัดสุดท้าย: `Sitemap: https://www.bestchoicephone.com/sitemap.xml`

```bash
grep -c "www.bestchoicephone.com" apps/web-shop/public/sitemap.xml   # expect 11
grep "shop.bestchoicephone.app" apps/web-shop/public/sitemap.xml apps/web-shop/public/robots.txt   # expect empty
```

- [ ] **Step 3: usePageMeta — canonical per-route**

แทนทั้งไฟล์ `apps/web-shop/src/hooks/usePageMeta.ts` ด้วย:

```ts
import { useEffect } from 'react';

const BASE_TITLE = 'BESTCHOICE — ร้านขายไอโฟนผ่อนได้ลพบุรี';
const CANONICAL_BASE = 'https://www.bestchoicephone.com';

/** ตั้ง document.title + meta description + canonical ต่อหน้า (คืนค่าเดิมเมื่อ unmount) */
export function usePageMeta(title?: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title ? `${title} | BESTCHOICE ลพบุรี` : BASE_TITLE;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.content;
    if (meta && description) meta.content = description;
    // canonical per-route — index.html ตั้ง base ไว้ที่ /; SPA ต้อง stamp path ปัจจุบันเอง
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevHref = link?.getAttribute('href') ?? undefined;
    if (link) link.setAttribute('href', `${CANONICAL_BASE}${window.location.pathname}`);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
      if (link && prevHref !== undefined) link.setAttribute('href', prevHref);
    };
  }, [title, description]);
}
```

- [ ] **Step 4: deploy-gcp.yml — SHOP_BASE_URL + comment**

ใน `--set-env-vars` block (:333-363) เพิ่มบรรทัดนี้ต่อจาก `API_BASE_URL=https://api.bestchoicephone.app,\`:

```
          SHOP_BASE_URL=https://www.bestchoicephone.com,\
```

และ comment/step name บรรทัด :448 `- name: Deploy shop hosting (shop.bestchoicephone.app)` → `- name: Deploy shop hosting (www.bestchoicephone.com)`

- [ ] **Step 5: .env.example**

บรรทัด 142: `SHOP_BASE_URL=https://shop.bestchoicephone.app` → `SHOP_BASE_URL=https://www.bestchoicephone.com`

- [ ] **Step 6: main.ts CORS**

ใน `apps/api/src/main.ts` หลัง block `// Online Shop subdomain` (:110-114) เพิ่ม:

```ts
  // Online Shop custom domain (launch 2026-07) — defensive: flow ปกติใช้
  // same-origin rewrite ผ่าน Firebase Hosting แต่กัน direct-call ไว้ด้วย
  if (!allowedOrigins.includes('https://www.bestchoicephone.com')) {
    allowedOrigins.push('https://www.bestchoicephone.com');
  }
```

- [ ] **Step 7: comment sweeps**

- `integration-registry.ts` :405: `description: 'วัดพฤติกรรมผู้ใช้ในหน้าร้านออนไลน์ (bestchoicephone.app)'` → `(www.bestchoicephone.com)`
- `apps/web-shop/src/lib/api.ts` :12 comment: `// Prod: Firebase Hosting on shop.bestchoicephone.app rewrites /api/** to the` → `// Prod: Firebase Hosting on www.bestchoicephone.com rewrites /api/** to the`

- [ ] **Step 8: LINE consolidation — 10 จุด/9 ไฟล์**

ทุกไฟล์ต่อไปนี้: (1) เพิ่ม `import { shopInfo } from '@/lib/copy';` ถ้ายังไม่มี import จาก `@/lib/copy` (ถ้ามีอยู่แล้วให้เพิ่ม `shopInfo` เข้า import เดิม), (2) แทน string literal `"https://line.me/R/ti/p/@bestchoice"` ที่เป็นค่า `href` ด้วย `{shopInfo.lineUrl}`:

1. `src/components/hero/HomeHero.tsx` (1 จุด)
2. `src/pages/InstallmentTermsPage.tsx` (1)
3. `src/pages/ContactPage.tsx` (1)
4. `src/pages/ReturnsPage.tsx` (1)
5. `src/pages/PromotionsPage.tsx` (1)
6. `src/pages/apply/ApplyStatusPage.tsx` (1)
7. `src/pages/apply/ApplySuccessPage.tsx` (1)
8. `src/pages/sell/SellStatusPage.tsx` (2)
9. `src/pages/sell/SellQuotePage.tsx` (1)

ตัวอย่าง (HomeHero): `<a href="https://line.me/R/ti/p/@bestchoice" target="_blank" rel="noopener">` → `<a href={shopInfo.lineUrl} target="_blank" rel="noopener">`

Gate:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
grep -rn "line.me/R/ti/p/@bestchoice" apps/web-shop/src | grep -v "lib/copy.ts"   # expect empty
```

- [ ] **Step 9: build + typecheck ทั้งสองแอป**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web-shop && npx tsc --noEmit && npm run build
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx tsc --noEmit
grep -rn "shop.bestchoicephone.app" apps/web-shop/index.html apps/web-shop/public apps/web-shop/src
```

Expected: build ผ่าน, tsc 0, grep สุดท้ายว่าง (โดเมนเก่าหมดจาก web-shop; ที่อื่นในระบบ admin/api ที่ไม่อยู่ใน scope spec ไม่แตะ)

- [ ] **Step 10: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/web-shop/index.html apps/web-shop/public apps/web-shop/src .github/workflows/deploy-gcp.yml .env.example apps/api/src/main.ts apps/api/src/modules/integrations/integration-registry.ts
git commit -m "feat(shop): move storefront to www.bestchoicephone.com (SEO/env/CORS) + centralize LINE url via shopInfo (Track A)"
```

---

### Task 7: Final verification + PR

**Files:** ไม่มีไฟล์ใหม่ (ยกเว้นแก้ตามที่ verification เจอ)

- [ ] **Step 1: รัน gate ทั้งหมดเหมือน CI**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx eslint . && npx tsc --noEmit
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx eslint . && npx tsc --noEmit && npm run build
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web-shop && npm run build
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/trade-in src/modules/shop-buyback --runInBand && npx jest shop-trade-in.template --runInBand
```

Expected: ทุกอย่างเขียว 0 error

- [ ] **Step 2: Browser pass (local dev — ทำโดย main agent/มนุษย์ ไม่ใช่ subagent ก็ได้)**

1. `npm run dev` แล้วเข้า `http://localhost:5173`
2. Login BM: `manager.ladprao@bestchoice.com / admin1234` → เมนู "ขาย" ต้องมี "รับซื้อมือสอง" → เปิด `/trade-in` ได้
3. สร้าง record ออนไลน์ (ผ่าน `http://localhost:5174/sell` submit) → appraise → กด "รับซื้อ" → modal ต้องโชว์ "สาขาที่รับเครื่อง" (BM = ล็อกสาขาตัวเอง) → ยืนยัน → สำเร็จ ไม่ 400
4. ช่องค้นหา: พิมพ์เบอร์ผู้ขาย → รายการกรองจาก server (network tab เห็น `?search=`)
5. Login OWNER → MANUAL แก้ราคา record เทิร์น → เปิดหน้า status ลูกค้า (`/sell/status/:id` ฝั่ง web-shop) → ราคาใหม่ต้องแสดง
6. Mobile viewport 375px: AcceptModal + ช่องค้นหาไม่ overflow

- [ ] **Step 3: เปิด PR (ห้าม merge เอง — user จะสั่ง admin merge)**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git push -u origin feat/launch-readiness-wave
gh pr create --title "Launch-readiness wave: www domain (code), BM accept+search, MANUAL re-stamp, remove 410 stub" --body "$(cat <<'EOF'
## Summary
- **Track A (code):** ย้าย storefront SEO/env ไป `www.bestchoicephone.com` (index.html/sitemap/robots/canonical per-route/deploy env `SHOP_BASE_URL`/CORS) + รวมลิงก์ LINE 10 จุดเข้า `shopInfo.lineUrl`
- **Track B:** BRANCH_MANAGER มีเมนู /trade-in; accept record ออนไลน์เลือกสาขาได้ (`effectiveBranchId` ใช้ที่ product/JE/persist; ชนกัน → 400)
- **Track C:** ช่องค้นหาต่อ server-side `?search=` (ชื่อ/เบอร์/IMEI/ใบสำคัญ) แทน client-filter ที่พัง
- **Track D:** OWNER MANUAL re-stamp `estimatedValue`+`quoteBreakdown` ทั้ง BUYBACK/EXCHANGE (inverse cashPrice จาก snapshot bonusPct, Decimal ล้วน) + audit หลัง CAS สำเร็จเท่านั้น
- **Track E:** ลบ `shop-trade-in` 410 stub ครบกำหนด (module+route+spec+security.md)

Spec: `docs/superpowers/specs/2026-07-23-launch-readiness-wave-design.md`

## Test plan
- [x] jest trade-in + shop-buyback + journal shop-trade-in.template (--runInBand) เขียว
- [x] eslint + tsc + build ทั้ง apps/api, apps/web, apps/web-shop
- [x] browser pass: BM accept online record + search + MANUAL re-stamp โชว์หน้า status ลูกค้า

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: อัปเดต ledger + รายงาน**

สรุปผลทุก track + ลิงก์ PR + สิ่งที่ต้องรอ owner (Cloudflare records → cert ACTIVE → `/qa` โดเมนจริง)

---

## หลัง merge (main agent — ไม่ใช่ subagent)

1. รอ deploy เขียว (filter run ด้วย headSha ของ merge commit — `gh run list -L1` เฉยๆ จับ run เก่าได้)
2. Verify: `https://bestchoicephone-shop.web.app/sell` 200 + view-source เห็น canonical www
3. เมื่อ owner เพิ่ม Cloudflare records แล้ว: poll Firebase customDomains จน cert ACTIVE → verify `https://www.bestchoicephone.com/sell` + apex redirect → รัน `/qa` รอบสุดท้ายบนโดเมนจริง
