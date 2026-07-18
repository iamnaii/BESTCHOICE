# รวมขาย/เทิร์น iPhone ที่ /sell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/sell` เดียว — ลูกค้าเห็น 2 ราคา (เงินสด / เทิร์น +โบนัส%) เลือกทางแล้ว submit; ปลดระวาง shop-trade-in module เก่า

**Architecture:** ขยาย shop-buyback (engine เดียว): `applyExchangeBonus` + SystemConfig `sell_exchange_bonus_pct` + `flow` ใน submit; invariant `quoteBreakdown.price` = ราคาทางที่เลือกเสมอ; REVISED/accept ฝั่ง staff เป็น flow-aware; web-shop ย้าย routes เป็น `/sell` + redirect 7 เส้น (ส่งต่อ query) + ลบ trade-in เก่าทั้งยวง; shop-trade-in เหลือ 410 stub

**Tech Stack:** เดิมทั้งหมด (NestJS+Prisma / React19+Vite / React18 / Jest) — **ไม่มี migration**

**Spec:** `docs/superpowers/specs/2026-07-18-sell-unified-instant-quote-design.md` (อ่านก่อนเริ่ม)

## Global Constraints

- สูตร: `exchangePrice = floor(cashPrice × (100+bonusPct)/100 / 10) × 10` Decimal ล้วน (ห้ามสร้าง Decimal จาก float `1+pct/100`); golden 12,420 @10% → **13,660**
- **Invariant:** `quoteBreakdown.price` == `estimatedValue` == ราคาทาง flow เสมอ; `cashPrice`/`exchangePrice`/`bonusPct`/`chosenFlow` เก็บแยกใน breakdown
- `bonusPct` อ่านผ่าน `readNumberFlag` (`apps/api/src/utils/config.util.ts`) default 10, นอกช่วง 0–100 → 10
- **ขอบเขตการลบ = ชื่อไฟล์ระบุใน plan เท่านั้น** — ห้าม grep-delete คำว่า `shop-trade-in`/`trade-in`: ห้ามแตะ `apps/api/src/modules/journal/**` (มี `cpa-templates/shop-trade-in.template.ts` = JE ของ walk-in, red line บัญชี), `apps/api/src/modules/trade-in/**` (แก้เฉพาะไฟล์ที่ plan ระบุ), e2e staff 3 ไฟล์ (`trade-in-flow`, `advanced-operations`, `page-health-check`)
- `app.module.ts` **ห้ามแตะ** (ShopTradeInModule อยู่ต่อเป็นโฮสต์ 410 stub)
- Redirect ทุกตัวส่งต่อ `location.search` (utm)
- Lead event คง `type: 'buyback'` + เพิ่ม field `flow` (ห้าม re-key GA4/Pixel)
- Error message ไทย, soft delete เท่านั้น, UI ไทย `leading-snug`, apps/web ใช้ semantic tokens
- Branch: `feat/sell-unified-instant-quote` จาก origin/main; working tree มีไฟล์ payments dirty ~9 ไฟล์ (`apps/web/src/components/payment/**`, `apps/web/src/pages/PaymentsPage/**`) — **ห้าม add/commit เด็ดขาด** (ห้าม `git add -A`)
- Test: `cd apps/api && npx jest <path> --runInBand`; web-shop gate = `cd apps/web-shop && npm run build`

---

## Phase A — Backend

### Task 0: Branch

- [ ] **Step 0.1:** `cd /Users/iamnaii/Desktop/App/BESTCHOICE && git checkout -b feat/sell-unified-instant-quote origin/main`
  (ห้ามใช้ `git reset --hard`/`git clean` ตลอดงาน — ไฟล์ payments dirty เป็นงานค้างของ user)

### Task 1: `applyExchangeBonus` (TDD)

**Files:**
- Modify: `apps/api/src/modules/shop-buyback/buyback-pricing.service.ts` (ต่อท้าย class)
- Test: `apps/api/src/modules/shop-buyback/buyback-pricing.service.spec.ts` (เพิ่ม describe)

**Interfaces:**
- Produces: `BuybackPricingService.applyExchangeBonus(cash: Prisma.Decimal, bonusPct: Prisma.Decimal): Prisma.Decimal`

- [ ] **Step 1.1: เพิ่ม failing tests** — ต่อท้าย describe เดิมใน spec:

```ts
  describe('applyExchangeBonus', () => {
    it('golden: 12,420 @10% → 13,660 (13,662 ปัดลงหลักสิบ)', () => {
      expect(svc.applyExchangeBonus(D(12420), D(10)).toNumber()).toBe(13660);
    });

    it('@0% → เท่าราคาเงินสด', () => {
      expect(svc.applyExchangeBonus(D(12420), D(0)).toNumber()).toBe(12420);
    });

    it('ปัดลงหลักสิบเสมอ', () => {
      // 9995 × 1.1 = 10994.5 → 10990
      expect(svc.applyExchangeBonus(D(9995), D(10)).toNumber()).toBe(10990);
    });

    it('cash 0 → 0', () => {
      expect(svc.applyExchangeBonus(D(0), D(10)).toNumber()).toBe(0);
    });
  });
```

- [ ] **Step 1.2: รันให้ fail** — `cd apps/api && npx jest src/modules/shop-buyback/buyback-pricing.service.spec.ts --runInBand` → FAIL (method ไม่มี)

- [ ] **Step 1.3: Implement** — ต่อท้าย class `BuybackPricingService` (ก่อน `gradeFromPct` หรือหลังก็ได้):

```ts
  /**
   * ราคาเทิร์น = เงินสด × (1 + โบนัส%) ปัดลงหลักสิบ (spec /sell §3)
   * ห้ามสร้าง Decimal จาก float (1 + pct/100) — คูณ/หารด้วย 100 ตรงๆ
   */
  applyExchangeBonus(cash: Prisma.Decimal, bonusPct: Prisma.Decimal): Prisma.Decimal {
    const HUNDRED = new Prisma.Decimal(100);
    const raw = cash.mul(HUNDRED.plus(bonusPct)).div(HUNDRED);
    return Prisma.Decimal.max(raw.div(10).floor().mul(10), new Prisma.Decimal(0));
  }
```

- [ ] **Step 1.4: รันให้ผ่าน** → PASS ทุกข้อ (ของเดิม 13 + ใหม่ 4)

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/modules/shop-buyback/buyback-pricing.service*.ts
git commit -m "feat(api): applyExchangeBonus — ราคาเทิร์น Decimal ปัดหลักสิบ (TDD)"
```

### Task 2: Dual-price quote/submit + flow + flex per-flow

**Files:**
- Modify: `apps/api/src/modules/shop-buyback/shop-buyback.service.ts`
- Modify: `apps/api/src/modules/shop-buyback/dto/quote.dto.ts` (เพิ่ม `flow` ใน SubmitBuybackDto)
- Test: `apps/api/src/modules/shop-buyback/shop-buyback.service.spec.ts`

**Interfaces:**
- Consumes: `applyExchangeBonus` (Task 1), `readNumberFlag(prisma, key, fallback)` จาก `../../utils/config.util`
- Produces (Task 4/9/10/11 ใช้):
  - `getBonusPct(): Promise<Prisma.Decimal>` (default 10, นอกช่วง 0–100 → 10)
  - `quoteForAnswers(model, storage, answers, flow: 'BUYBACK' | 'EXCHANGE' = 'BUYBACK')` → เพิ่ม `cashPrice`, `exchangePrice`, `bonusPct` (string ทั้งหมด); `price` = ราคาทาง flow; `breakdown` เพิ่ม `cashPrice/exchangePrice/bonusPct/chosenFlow` และ `breakdown.price` = ราคาทาง flow
  - `getQuestions()` ตอบเพิ่ม `bonusPct: string`
  - `submit(dto)` — `dto.flow?: 'BUYBACK'|'EXCHANGE'` default BUYBACK; `TradeIn.flow` ตามเลือก; flex per-flow; response `price` = ราคาทาง flow

- [ ] **Step 2.1: DTO** — ใน `dto/quote.dto.ts` เพิ่มใน `SubmitBuybackDto` (ท้าย class) + import `IsIn`:

```ts
  /** ทางที่ลูกค้าเลือก — bundle เก่า (#1360) ไม่ส่ง = BUYBACK พฤติกรรมเดิมเป๊ะ */
  @IsOptional()
  @IsIn(['BUYBACK', 'EXCHANGE'], { message: 'ประเภทรายการไม่ถูกต้อง' })
  flow?: 'BUYBACK' | 'EXCHANGE';
```

- [ ] **Step 2.2: เขียน failing tests** — ใน `shop-buyback.service.spec.ts`:
  1. เพิ่ม mock systemConfig ใน `prisma` fixture (ใน `beforeEach`): เปิด `apps/api/src/utils/config.util.ts` ดู `readRawValue` ว่า query `systemConfig` รูปไหน (findUnique/findFirst + field ไหน) แล้ว mock ให้คืน `{ value: '10', deletedAt: null }` ตาม shape จริง เช่น:

```ts
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: '10', deletedAt: null }) },
```
  (ถ้า readRawValue ใช้ findFirst ให้ mock ชื่อนั้นแทน — ยึดตามโค้ดจริง)
  2. เพิ่ม tests ใหม่:

```ts
  describe('dual price (flow)', () => {
    it('quote default (BUYBACK): price=cash, มี exchangePrice/bonusPct ครบ', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', answers);
      expect(r.price).toBe('14000.00'); // cash เดิม
      expect(r.cashPrice).toBe('14000.00');
      expect(r.exchangePrice).toBe('15400.00'); // 14000×1.1
      expect(r.bonusPct).toBe('10');
      expect(r.breakdown!.price).toBe('14000.00');
      expect(r.breakdown!.chosenFlow).toBe('BUYBACK');
      expect(r.breakdown!.cashPrice).toBe('14000.00');
      expect(r.breakdown!.exchangePrice).toBe('15400.00');
    });

    it('quote flow=EXCHANGE: price=exchange + invariant breakdown.price', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', answers, 'EXCHANGE');
      expect(r.price).toBe('15400.00');
      expect(r.breakdown!.price).toBe('15400.00');
      expect(r.breakdown!.chosenFlow).toBe('EXCHANGE');
      expect(r.cashPrice).toBe('14000.00');
    });

    it('bonus config นอกช่วง → default 10', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: '250', deletedAt: null });
      const r = await service.quoteForAnswers('iPhone 15', '128GB', answers, 'EXCHANGE');
      expect(r.bonusPct).toBe('10');
    });

    it('getQuestions ตอบ bonusPct', async () => {
      const r = await service.getQuestions();
      expect(r.bonusPct).toBe('10');
    });

    it('submit flow=EXCHANGE: estimatedValue=exchange, TradeIn.flow=EXCHANGE, flex มีราคาเทิร์น+คำว่าเทิร์น', async () => {
      const r = await service.submit({ ...dto, flow: 'EXCHANGE' }, undefined);
      expect(r.price).toBe('15400.00');
      const data = prisma.tradeIn.create.mock.calls[0][0].data;
      expect(data.flow).toBe('EXCHANGE');
      expect(data.estimatedValue.toString()).toBe('15400');
      expect(data.quoteBreakdown.price).toBe('15400.00');
      expect(data.quoteBreakdown.chosenFlow).toBe('EXCHANGE');
      const flex = JSON.stringify(line.sendFlexMessage.mock.calls[0][1]);
      expect(flex).toContain('15,400');
      expect(flex).toContain('เทิร์น');
    });

    it('submit ไม่ส่ง flow → BUYBACK เดิมเป๊ะ (back-compat bundle เก่า)', async () => {
      await service.submit(dto, undefined);
      const data = prisma.tradeIn.create.mock.calls[0][0].data;
      expect(data.flow).toBe('BUYBACK');
      expect(data.estimatedValue.toString()).toBe('14000');
      expect(data.quoteBreakdown.chosenFlow).toBe('BUYBACK');
    });
  });
```
  (fixture `answers`/`dto` มีอยู่แล้วในไฟล์; ของเดิมที่ assert `price: '14000.00'`/flex `14,000` ยังผ่านเพราะ default BUYBACK)

- [ ] **Step 2.3: รันให้ fail** — `npx jest src/modules/shop-buyback/shop-buyback.service.spec.ts --runInBand` → FAIL

- [ ] **Step 2.4: Implement ใน `shop-buyback.service.ts`:**
  1. import: `import { readNumberFlag } from '../../utils/config.util';`
  2. เพิ่ม method:

```ts
  /** โบนัสเทิร์น % จาก SystemConfig — default 10, นอกช่วง 0–100 → 10 (spec /sell §3) */
  async getBonusPct(): Promise<Prisma.Decimal> {
    const n = await readNumberFlag(this.prisma, 'sell_exchange_bonus_pct', 10);
    if (n < 0 || n > 100) {
      this.logger.warn(`sell_exchange_bonus_pct=${n} นอกช่วง 0–100 — ใช้ default 10`);
      return new Prisma.Decimal(10);
    }
    return new Prisma.Decimal(n);
  }
```
  3. `getQuestions()` — เปลี่ยน return เป็น:

```ts
    const bonusPct = await this.getBonusPct();
    return {
      bonusPct: bonusPct.toString(),
      questions: questions.map((q) => ({ /* ...เดิมทุกอย่าง... */ })),
    };
```
  4. `quoteForAnswers` — เพิ่ม param `flow: 'BUYBACK' | 'EXCHANGE' = 'BUYBACK'` แล้วแทน block return ท้าย (ตั้งแต่ `const maxPrice = ...`):

```ts
    const maxPrice = new Prisma.Decimal(valuation.basePrice);
    const comp = this.pricing.compute(maxPrice, selections);
    const bonusPct = await this.getBonusPct();
    const exchangePrice = this.pricing.applyExchangeBonus(comp.price, bonusPct);
    const flowPrice = flow === 'EXCHANGE' ? exchangePrice : comp.price;
    return {
      available: true as const,
      model: valuation.model as string,
      storage: valuation.storage as string,
      price: flowPrice.toFixed(2),
      cashPrice: comp.price.toFixed(2),
      exchangePrice: exchangePrice.toFixed(2),
      bonusPct: bonusPct.toString(),
      maxPrice: maxPrice.toFixed(2),
      grade: this.pricing.gradeFromPct(comp.pctTotal),
      breakdown: {
        maxPrice: maxPrice.toFixed(2),
        fixedTotal: comp.fixedTotal.toFixed(2),
        pctTotal: comp.pctTotal.toString(),
        // invariant (spec §3): price = ราคาทาง flow เสมอ (== estimatedValue ตอน submit)
        price: flowPrice.toFixed(2),
        cashPrice: comp.price.toFixed(2),
        exchangePrice: exchangePrice.toFixed(2),
        bonusPct: bonusPct.toString(),
        chosenFlow: flow,
        lines: comp.lines,
      },
      conditionAnswers,
    };
```
  5. `submit` — `const flow = dto.flow ?? 'BUYBACK';` → `quoteForAnswers(dto.model, dto.storage, dto.answers, flow)`; ใน create: `flow,` (แทน hardcode `'BUYBACK'`); flex call → `this.buildQuoteFlex(tradeIn.id, quote.price!, flow)`
  6. `buildQuoteFlex(id, price, flow: 'BUYBACK' | 'EXCHANGE')` — แทนทั้ง method:

```ts
  private buildQuoteFlex(
    id: string,
    price: string,
    flow: 'BUYBACK' | 'EXCHANGE',
  ): FlexMessagePayload {
    const pretty = Number(price).toLocaleString('th-TH', { maximumFractionDigits: 0 });
    const isExchange = flow === 'EXCHANGE';
    return {
      type: 'flex',
      altText: isExchange ? 'ยืนยันมูลค่าเทิร์นแล้ว' : 'ยืนยันราคารับซื้อแล้ว',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: isExchange ? 'เครดิตเทิร์นแลกเครื่องใหม่' : 'ราคาที่ประเมิน',
              weight: 'bold',
              size: 'lg',
            },
            { type: 'text', text: `฿${pretty}`, weight: 'bold', size: 'xxl', margin: 'md' },
            { type: 'text', text: `รหัส ${id.slice(0, 8).toUpperCase()}`, margin: 'md' },
            {
              type: 'text',
              text: isExchange
                ? 'มาเลือกเครื่องที่ร้าน — ใช้เป็นส่วนลดซื้อเครื่อง ไม่จ่ายเป็นเงินสด'
                : 'ทีมงานจะติดต่อนัดวันเข้าร้าน — ยืนยันราคาจริงตอนตรวจเครื่อง',
              size: 'xs',
              color: '#888888',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }
```
  7. `getStatus` where → `findFirst({ where: { id, deletedAt: null }, select: {...เดิม} })` (spec §5.1 — เปลี่ยนจาก findUnique; เพิ่ม test สั้น: `prisma.tradeIn.findFirst` ถูกเรียกด้วย `deletedAt: null` — แก้ mock getStatus เดิมจาก findUnique เป็น findFirst)

- [ ] **Step 2.5: รันให้ผ่านทั้ง module + typecheck**

```bash
cd apps/api && npx jest src/modules/shop-buyback --runInBand && cd .. && ./tools/check-types.sh api
```

- [ ] **Step 2.6: Commit**

```bash
git add apps/api/src/modules/shop-buyback/
git commit -m "feat(api): dual-price quote/submit + flow + flex per-flow + invariant breakdown.price (spec /sell §3)"
```

### Task 3: sell-config endpoint (โบนัส % แอดมิน)

**Files:**
- Modify: `apps/api/src/modules/trade-in/services/buyback-question-admin.service.ts`
- Modify: `apps/api/src/modules/trade-in/dto/buyback-question.dto.ts` (เพิ่ม DTO)
- Modify: `apps/api/src/modules/trade-in/trade-in.controller.ts` (2 routes เหนือ `@Get(':id')` — วางใน block buyback-questions)
- Test: `apps/api/src/modules/trade-in/trade-in.routing.spec.ts` (เพิ่ม case) + `apps/api/src/modules/trade-in/services/buyback-question-admin.service.spec.ts` (สร้างถ้ายังไม่มี / เพิ่มถ้ามี)

**Interfaces:**
- Produces (Task 11 ใช้): `GET /trade-ins/sell-config` → `{ exchangeBonusPct: number }` (roles OWNER/BM/SALES); `PUT /trade-ins/sell-config` body `{ exchangeBonusPct: number }` (OWNER/BM)

- [ ] **Step 3.1: DTO** — ต่อท้าย `buyback-question.dto.ts` (import `Max` เพิ่ม):

```ts
export class UpdateSellConfigDto {
  @IsNumber({}, { message: 'กรุณาระบุโบนัสเทิร์นเป็นตัวเลข' })
  @Min(0, { message: 'โบนัสต้องไม่ติดลบ' })
  @Max(100, { message: 'โบนัสต้องไม่เกิน 100%' })
  exchangeBonusPct!: number;
}
```

- [ ] **Step 3.2: Failing tests** — routing spec เพิ่ม (mock `adminService.getSellConfig`):

```ts
  it('GET /trade-ins/sell-config ไม่โดน :id กลืน', async () => {
    await request(app.getHttpServer()).get('/trade-ins/sell-config').expect(200);
    expect(adminService.getSellConfig).toHaveBeenCalled();
    expect(tradeInService.findOne).not.toHaveBeenCalled();
  });
```
  (เพิ่ม `getSellConfig: jest.fn().mockResolvedValue({ exchangeBonusPct: 10 })` ใน adminService mock)
  Service spec (mock prisma.systemConfig):

```ts
  it('getSellConfig: ไม่มี row → default 10; updateSellConfig upsert พร้อม deletedAt:null', async () => {
    prisma.systemConfig = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    };
    expect(await service.getSellConfig()).toEqual({ exchangeBonusPct: 10 });
    await service.updateSellConfig({ exchangeBonusPct: 15 });
    const call = prisma.systemConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ key: 'sell_exchange_bonus_pct' });
    expect(call.update).toEqual({ value: '15', deletedAt: null });
    expect(call.create.value).toBe('15');
  });
```
  (ปรับ shape mock ตาม readNumberFlag จริงเหมือน Task 2)

- [ ] **Step 3.3: Implement**
  Service (`buyback-question-admin.service.ts` — import `readNumberFlag`):

```ts
  private static readonly BONUS_KEY = 'sell_exchange_bonus_pct';

  async getSellConfig() {
    const n = await readNumberFlag(this.prisma, BuybackQuestionAdminService.BONUS_KEY, 10);
    return { exchangeBonusPct: n >= 0 && n <= 100 ? n : 10 };
  }

  async updateSellConfig(dto: UpdateSellConfigDto) {
    await this.prisma.systemConfig.upsert({
      where: { key: BuybackQuestionAdminService.BONUS_KEY },
      // deletedAt: null — กัน row ที่เคยถูก soft-delete ค้างทำให้ reader มองไม่เห็น
      update: { value: String(dto.exchangeBonusPct), deletedAt: null },
      create: {
        key: BuybackQuestionAdminService.BONUS_KEY,
        value: String(dto.exchangeBonusPct),
        label: 'โบนัสเทิร์น % (ราคาเทิร์น = เงินสด × (1+โบนัส))',
      },
    });
    return { exchangeBonusPct: dto.exchangeBonusPct };
  }
```
  Controller — วางใน block buyback-questions (เหนือ `@Get(':id')`), import `UpdateSellConfigDto` + `Put` :

```ts
  @Get('sell-config')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getSellConfig() {
    return this.buybackAdmin.getSellConfig();
  }

  @Put('sell-config')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateSellConfig(@Body() dto: UpdateSellConfigDto) {
    return this.buybackAdmin.updateSellConfig(dto);
  }
```

- [ ] **Step 3.4: รันให้ผ่าน** — `npx jest src/modules/trade-in --runInBand` ทั้ง module PASS

- [ ] **Step 3.5: Commit** — `git add apps/api/src/modules/trade-in/ && git commit -m "feat(api): sell-config endpoint — โบนัสเทิร์น % (SystemConfig + กัน soft-delete ค้าง)"`

### Task 4: appraise-online flow-aware (REVISED + useCashPrice)

**Files:**
- Modify: `apps/api/src/modules/trade-in/services/online-appraisal.service.ts`
- Modify: `apps/api/src/modules/trade-in/dto/appraise-online.dto.ts` (เพิ่ม `useCashPrice`)
- Test: `apps/api/src/modules/trade-in/services/online-appraisal.service.spec.ts`

**Interfaces:**
- Consumes: `quoteForAnswers(..., flow)` (Task 2)
- Produces: `PATCH /trade-ins/:id/appraise-online` body เพิ่ม `useCashPrice?: boolean` (AS_ANSWERED บน record EXCHANGE เท่านั้น)

- [ ] **Step 4.1: DTO** — เพิ่มใน `AppraiseOnlineDto` (import `IsBoolean` มีแล้วหรือเพิ่ม):

```ts
  /** AS_ANSWERED บน record เทิร์น: ลูกค้าไม่ซื้อเครื่อง → ถอยเป็นราคาเงินสด + flip flow เป็น BUYBACK */
  @IsOptional()
  @IsBoolean()
  useCashPrice?: boolean;
```

- [ ] **Step 4.2: Failing tests** — เพิ่มใน spec (fixture EXCHANGE ใหม่):

```ts
const EXCHANGE_TRADEIN = {
  ...ONLINE_TRADEIN,
  flow: 'EXCHANGE',
  estimatedValue: D(13660),
  quoteBreakdown: {
    maxPrice: '14500.00', price: '13660.00', cashPrice: '12420.00',
    exchangePrice: '13660.00', bonusPct: '10', chosenFlow: 'EXCHANGE', lines: [],
  },
};

describe('flow-aware (spec /sell §7.2)', () => {
  it('REVISED บน EXCHANGE: ส่ง flow เข้า engine + ราคา/chosenFlow ตาม flow', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...EXCHANGE_TRADEIN });
    shopBuyback.quoteForAnswers.mockResolvedValue({
      available: true, price: '9990.00', maxPrice: '14500.00', grade: 'C',
      breakdown: { maxPrice: '14500.00', price: '9990.00', cashPrice: '9080.00',
        exchangePrice: '9990.00', bonusPct: '10', chosenFlow: 'EXCHANGE', lines: [] },
      conditionAnswers: [],
    });
    const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
    await service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'BRANCH_MANAGER');
    expect(shopBuyback.quoteForAnswers).toHaveBeenCalledWith('iPhone 15', '128GB', answers, 'EXCHANGE');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('9990');
    expect(data.estimatedValue.toString()).toBe('9990');
    expect(data.quoteBreakdown.chosenFlow).toBe('EXCHANGE');
  });

  it('AS_ANSWERED useCashPrice บน EXCHANGE: ราคา cash + flip flow → BUYBACK + invariant breakdown', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...EXCHANGE_TRADEIN });
    await service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED', useCashPrice: true }, 'u1', 'BRANCH_MANAGER');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('12420');
    expect(data.flow).toBe('BUYBACK');
    expect(data.estimatedValue.toString()).toBe('12420');
    expect(data.quoteBreakdown.price).toBe('12420.00');
    expect(data.quoteBreakdown.chosenFlow).toBe('BUYBACK');
  });

  it('useCashPrice บน record BUYBACK → BadRequestException', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED', useCashPrice: true }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });
});
```
  (ONLINE_TRADEIN เดิม flow ไม่ถูก set — เพิ่ม `flow: 'BUYBACK'` เข้า fixture เดิมด้วยถ้ายังไม่มี)

- [ ] **Step 4.3: Implement** ใน `online-appraisal.service.ts`:
  1. REVISED branch — เปลี่ยน call:

```ts
      const recordFlow = tradeIn.flow === 'EXCHANGE' ? ('EXCHANGE' as const) : ('BUYBACK' as const);
      const quote = await this.shopBuyback.quoteForAnswers(
        tradeIn.deviceModel,
        tradeIn.deviceStorage ?? '',
        dto.answers,
        recordFlow,
      );
```
  (ที่เหลือของ branch เดิม — quote.price ตอนนี้ = ราคาทาง flow และ breakdown ใหม่มี chosenFlow จาก engine แล้ว)
  2. AS_ANSWERED branch — แทนทั้ง branch:

```ts
    if (dto.mode === 'AS_ANSWERED') {
      if (tradeIn.estimatedValue === null) {
        throw new BadRequestException('รายการนี้ไม่มีราคาที่เสนอออนไลน์');
      }
      if (dto.useCashPrice) {
        // ลูกค้าเทิร์นแต่ไม่ซื้อเครื่อง → ถอยเป็นราคาเงินสด + flip flow (spec /sell §7.2)
        if (tradeIn.flow !== 'EXCHANGE') {
          throw new BadRequestException('ใช้ราคาเงินสดได้เฉพาะรายการเทิร์น');
        }
        const cash = breakdown.cashPrice;
        if (!cash) {
          throw new BadRequestException('รายการนี้ไม่มีราคาเงินสดในใบเสนอ');
        }
        offeredPrice = new Prisma.Decimal(cash);
        extraData = {
          flow: 'BUYBACK',
          estimatedValue: new Prisma.Decimal(cash),
          quoteBreakdown: {
            ...breakdown,
            price: cash,
            chosenFlow: 'BUYBACK',
          } as Prisma.InputJsonValue,
        };
      } else {
        offeredPrice = new Prisma.Decimal(tradeIn.estimatedValue);
      }
    } else if (dto.mode === 'REVISED') {
```

- [ ] **Step 4.4: รันให้ผ่าน + regression** — `npx jest src/modules/trade-in src/modules/shop-buyback --runInBand` ทั้งหมด PASS

- [ ] **Step 4.5: Commit** — `git add apps/api/src/modules/trade-in/ && git commit -m "feat(api): appraise-online flow-aware — REVISED คิดโบนัสตาม flow + useCashPrice ถอยเงินสด"`

### Task 5: accept() ต้นทุนสต็อกของ record เทิร์น

**Files:**
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts` (จุดเดียว: บรรทัด `const costPrice = ...` ใน accept())
- Test: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts` (เพิ่ม cases)

**Interfaces:**
- Produces: `Product.costPrice` ของ record **EXCHANGE instant** = `quoteBreakdown.cashPrice`; record อื่นทั้งหมด (BUYBACK instant ที่จ่ายสดจริง, walk-in, legacy) = เดิม (`offeredPrice ?? estimatedValue`)

⚠️ หมายเหตุ deviation จาก spec §7.4 (จงใจ — บันทึกไว้): spec เขียน "instant ทุก flow → cashPrice" แต่ record BUYBACK ที่ OWNER ปรับราคา MANUAL จะทำให้ **เงินที่จ่ายจริง ≠ cashPrice ใน breakdown** — ต้นทุนของการซื้อเงินสดต้องเท่าเงินที่จ่ายจริง (และ JE ของ BUYBACK accept post ตามเงินจ่ายจริง — cost ≠ paid จะทำ JE เพี้ยน) จึงใช้ cashPrice เฉพาะ **EXCHANGE** ตามเจตนา §1.5 (โบนัสไม่เข้าต้นทุน) — reviewer โปรดตัดสินตามเจตนานี้

- [ ] **Step 5.1: Failing tests** — เพิ่มใน lifecycle spec (ตาม pattern accept test เดิมในไฟล์ — เปิดดู fixture ที่มีอยู่แล้ว mirror):

```ts
  describe('accept costPrice (spec /sell §7.4)', () => {
    it('EXCHANGE instant: costPrice = cashPrice ไม่ใช่ราคารวมโบนัส', async () => {
      // fixture: tradeIn APPRAISED, flow EXCHANGE, offeredPrice 13660,
      // quoteBreakdown { cashPrice: '12420.00', chosenFlow: 'EXCHANGE' }
      // ...เรียก accept ตาม pattern เดิมของไฟล์...
      // assert: tx.product.create ถูกเรียกด้วย costPrice ที่ toString() === '12420'
    });

    it('BUYBACK instant: costPrice = offeredPrice (เงินที่จ่ายจริง) เหมือนเดิม', async () => {
      // fixture flow BUYBACK, offered 12420, breakdown.cashPrice '12420.00' → 12420
    });

    it('walk-in (ไม่มี quoteBreakdown): costPrice = offeredPrice เดิม', async () => {});
  });
```
  (โครง test จริงให้ mirror จาก accept() test ที่มีอยู่ในไฟล์นั้น — mock `$transaction`/`tx.product.create` แบบเดียวกัน; assertion หลักคือค่า costPrice ที่ส่งเข้า create)

- [ ] **Step 5.2: Implement** — Edit จุดเดียว:

old_string:
```ts
      const costPrice = tradeIn.offeredPrice ?? tradeIn.estimatedValue ?? new Prisma.Decimal(0);
```
new_string:
```ts
      // เทิร์น (EXCHANGE instant): ต้นทุนสต็อก = ราคาเงินสด — โบนัสเทิร์นเป็นส่วนลด
      // ฝั่งเครื่องใหม่ ไม่ใช่ต้นทุนเครื่องเก่า (spec /sell §1.5/§7.4) ไม่งั้น COGS
      // บวมเท่าโบนัสทุกเครื่อง; BUYBACK/walk-in = เงินที่จ่ายจริงเหมือนเดิม
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exchangeCash = tradeIn.flow === 'EXCHANGE' ? (tradeIn.quoteBreakdown as any)?.cashPrice : null;
      const costPrice = exchangeCash
        ? new Prisma.Decimal(exchangeCash)
        : (tradeIn.offeredPrice ?? tradeIn.estimatedValue ?? new Prisma.Decimal(0));
```

- [ ] **Step 5.3: ตรวจ JE seam** — เปิด `trade-in-lifecycle.service.ts` บริเวณบรรทัด ~450-470 (`shop-trade-in:${id}` idempotencyKey): ยืนยันว่า JE post เกิด**เฉพาะ flow BUYBACK** (มีเงินสดจ่ายจริง) — record EXCHANGE ไม่ post JE ณ accept ⇒ การ override costPrice ไม่กระทบสมดุลบัญชี ถ้าพบว่า post ทุก flow ให้ **หยุดและรายงาน BLOCKED** (อย่าแก้เอง — red line บัญชี)

- [ ] **Step 5.4: รันให้ผ่าน** — `npx jest src/modules/trade-in --runInBand` PASS ทั้งหมด

- [ ] **Step 5.5: Commit** — `git add apps/api/src/modules/trade-in/services/trade-in-lifecycle.service*.ts && git commit -m "feat(api): accept EXCHANGE instant — costPrice ใช้ cashPrice กัน COGS บวมโบนัส"`

### Task 6: ปลดระวาง shop-trade-in + ถอด TRADE_IN_PHOTO

**Files:**
- Delete (6 ไฟล์เท่านั้น — ห้าม glob): `apps/api/src/modules/shop-trade-in/shop-trade-in.service.ts`, `shop-trade-in.service.spec.ts`, `trade-in-intake.service.ts`, `trade-in-intake.module.ts`, `dto/estimate.dto.ts`, `dto/submit.dto.ts`
- Rewrite: `apps/api/src/modules/shop-trade-in/shop-trade-in.controller.ts`, `shop-trade-in.module.ts`
- Modify: `apps/api/src/modules/storage/shop-upload.controller.ts` + `shop-upload.controller.spec.ts`
- Modify (comment เท่านั้น): `apps/api/src/modules/shop-buyback/shop-buyback.service.ts:29-33`, `buyback-pricing.service.ts:27`, `shop-buyback.module.ts:9`
- **ห้ามแตะ:** `app.module.ts`, `modules/journal/**`, `modules/trade-in/**`

- [ ] **Step 6.1: Stub controller** — แทนทั้งไฟล์ `shop-trade-in.controller.ts`:

```ts
import { Controller, Get, GoneException, Post, UseGuards } from '@nestjs/common';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

const GONE_MSG = 'เวอร์ชันหน้าเว็บเก่าเกินไป กรุณารีเฟรชหน้า (Ctrl+R) แล้วลองใหม่';

/**
 * RETIRED (spec /sell 2026-07-18): flow เก่าแลกใหม่แบบเก่าถูกยุบเข้า /sell —
 * ตอบ 410 คงไว้ 1 release กัน SPA bundle เก่าค้าง cache แล้วลบ module ทิ้งใน
 * release ถัดไป (นัดรวมกับ quick-quote 410 + อัปเดต .claude/rules/security.md)
 * สถานะ record เก่า: ลูกค้าเข้าผ่าน /sell/:id → GET /shop/buyback/:id แทน
 */
@Controller('shop/trade-in')
@UseGuards(ShopBotDefenseGuard)
export class ShopTradeInController {
  @Post('estimate')
  estimate() {
    throw new GoneException(GONE_MSG);
  }

  @Post('submit')
  submit() {
    throw new GoneException(GONE_MSG);
  }

  @Get(':id')
  getStatus() {
    throw new GoneException(GONE_MSG);
  }
}
```

- [ ] **Step 6.2: Module** — แทนทั้งไฟล์ `shop-trade-in.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ShopTradeInController } from './shop-trade-in.controller';

/** RETIRED — โฮสต์ 410 stub เท่านั้น (app.module ยัง import module นี้อยู่ ห้ามถอด ไม่งั้น 404) */
@Module({ controllers: [ShopTradeInController] })
export class ShopTradeInModule {}
```

- [ ] **Step 6.3: ลบ 6 ไฟล์**

```bash
git rm apps/api/src/modules/shop-trade-in/shop-trade-in.service.ts \
  apps/api/src/modules/shop-trade-in/shop-trade-in.service.spec.ts \
  apps/api/src/modules/shop-trade-in/trade-in-intake.service.ts \
  apps/api/src/modules/shop-trade-in/trade-in-intake.module.ts \
  apps/api/src/modules/shop-trade-in/dto/estimate.dto.ts \
  apps/api/src/modules/shop-trade-in/dto/submit.dto.ts
```

- [ ] **Step 6.4: อัปเดต comment 3 จุด** (พันธะ "ห้ามแตะ intake" สิ้นสุด):
  - `shop-buyback.service.ts` หัว class (บรรทัด ~29-33) แทน comment block ด้วย:
```ts
/**
 * Engine เดียวของหน้า /sell (ขาย/เทิร์น iPhone) — TradeInIntakeService เดิม
 * ถูกปลดระวางแล้ว (spec /sell 2026-07-18); shop-trade-in เหลือแค่ 410 stub
 */
```
  - `buyback-pricing.service.ts` doc comment บรรทัดที่กล่าวถึง TradeInIntakeService → ลบประโยคนั้น (คงส่วนสูตรไว้)
  - `shop-buyback.module.ts` comment `// จงใจไม่ import TradeInIntakeModule...` → `// TradeInIntakeModule ถูกลบแล้ว (spec /sell 2026-07-18)`

- [ ] **Step 6.5: Upload allowlist + spec**
  - `shop-upload.controller.ts` — `PUBLIC_UPLOAD_KINDS` เหลือ `[UploadKind.BANK_SLIP, UploadKind.REVIEW_PHOTO]` + ปรับ comment ว่า TRADE_IN_PHOTO/BUYBACK_PHOTO ถูกถอด (enum คงอยู่เพื่อ record เก่า)
  - `shop-upload.controller.spec.ts` — ย้าย `UploadKind.TRADE_IN_PHOTO` จาก accept `it.each` ไป reject `it.each` (ข้าง BUYBACK_PHOTO) และ**เปลี่ยน MIME-whitelist test** (บรรทัด ~163-170) จาก TRADE_IN_PHOTO เป็น `UploadKind.REVIEW_PHOTO` (ยังเป็น kind สาธารณะ → MIME branch ยังถูก test จริง)

- [ ] **Step 6.6: Verify + gates**

```bash
cd apps/api && npx jest src/modules/storage src/modules/shop-buyback --runInBand
cd .. && ./tools/check-types.sh api
grep -rn "TradeInIntakeService\|trade-in-intake" apps/api/src || echo "GREP-CLEAN"
```
Expected: tests PASS, typecheck 0, GREP-CLEAN (comment 3 จุดแก้แล้ว)

- [ ] **Step 6.7: Commit**

```bash
git add apps/api/src/modules/shop-trade-in/ apps/api/src/modules/storage/ apps/api/src/modules/shop-buyback/
git commit -m "feat(api): ปลดระวาง shop-trade-in → 410 stub + ลบ intake engine + ถอด TRADE_IN_PHOTO presign"
```

---

## Phase B — web-shop

### Task 7: copy → sell + types + landing + nav/home + sitemap

**Files:**
- Modify: `apps/web-shop/src/lib/copy.ts` (block `buyback:` → `sell:` + home keys)
- Modify: `apps/web-shop/src/types/buyback.ts`
- Rewrite: `apps/web-shop/src/pages/buyback/BuybackLandingPage.tsx` (เนื้อหา /sell — ย้าย/rename ไฟล์ใน Task 8)
- Modify: `apps/web-shop/src/components/layout/ShopHeader.tsx`, `ShopFooter.tsx`, `apps/web-shop/src/pages/HomePage.tsx`, `apps/web-shop/public/sitemap.xml`

**Interfaces:**
- Produces: `copy.sell.*` keys (ตามโค้ดข้างล่าง — Task 9/10 ใช้ชื่อเป๊ะ), types `Buyback.flow`, `BuybackBreakdown.{cashPrice?,exchangePrice?,bonusPct?,chosenFlow?}`, `BuybackQuoteResult.{cashPrice?,exchangePrice?,bonusPct?}`, `BuybackQuestionsResponse = { bonusPct: string; questions: BuybackQuestion[] }`

- [ ] **Step 7.1: copy.ts** — แทน block `buyback: { ... }` ทั้งก้อนด้วย:

```ts
  sell: {
    pageTitle: 'ขาย/เทิร์น iPhone',
    description:
      'ขายหรือเทิร์น iPhone รู้ราคาทันทีใน 1 นาที เลือกได้ทั้งรับเงินสด หรือเทิร์นแลกเครื่องใหม่ได้ราคาเพิ่ม',
    quoteCta: 'เช็คราคา ขาย/เทิร์น',
    sellerName: 'ชื่อ-นามสกุล',
    sellerPhone: 'เบอร์โทร (10 หลัก)',
    submitSuccessCash: 'ยืนยันการขายแล้ว ทีมงานจะติดต่อนัดวันเข้าร้าน',
    submitSuccessExchange: 'ยืนยันเทิร์นแล้ว ทีมงานจะติดต่อนัดวัน มาเลือกเครื่องใหม่ที่ร้านได้เลย',
    submitError: 'ส่งเรื่องไม่สำเร็จ กรุณาลองใหม่',
    quoteError: 'ประเมินราคาไม่สำเร็จ',
    priceCondition:
      'ราคานี้ยืนยันจริงตอนตรวจเครื่องที่ร้าน หากสภาพตรงตามที่ตอบ — ปฏิเสธได้ ไม่มีค่าใช้จ่าย',
    modelUnavailable: 'รุ่นนี้ยังไม่เปิดรับซื้อออนไลน์ ทักไลน์สอบถามราคาได้เลย',
    statusTitle: 'สถานะรายการ',
    statusNotFound: 'ไม่พบข้อมูลรายการ',
    acceptPrice: 'ยอมรับราคา',
    rejectPrice: 'ปฏิเสธ',
    followUp: 'ทีมงานจะติดต่อนัดวันเข้าร้านทาง LINE/โทรศัพท์',
    quotedTitle: 'ราคาที่ยืนยันแล้ว',
    cashOption: 'ขายรับเงินสด',
    exchangeOption: 'เทิร์นแลกเครื่องใหม่',
    exchangeCreditNote: 'เครดิตเทิร์นใช้เป็นส่วนลดซื้อเครื่องในร้าน ไม่จ่ายเป็นเงินสด',
  },
```
  แล้ว sweep: `grep -rln "copy.buyback" apps/web-shop/src` → แก้ทุกไฟล์เป็น `copy.sell` (BuybackQuotePage, BuybackStatusPage, BuybackLandingPage) — key ที่หาย (`submitCta`, `submitSuccess`, `visitStep`) มีผู้ใช้ที่ Task 9/10 จะแทนอยู่แล้ว; ถ้าเจอ compile error ให้แก้ตาม Task 9/10

- [ ] **Step 7.2: home keys** — แทน 6 บรรทัด serviceTradeIn*/serviceBuyback* ด้วย:

```ts
    serviceSellTitle: 'ขาย/เทิร์น iPhone',
    serviceSellDescription:
      'รู้ราคาทันทีออนไลน์ เลือกได้ทั้งขายรับเงินสด หรือเทิร์นแลกเครื่องใหม่ได้ราคาเพิ่ม',
    serviceSellCta: 'เช็คราคา',
```

- [ ] **Step 7.3: types/buyback.ts** — เพิ่ม/แก้:

```ts
export interface BuybackQuestionsResponse {
  bonusPct: string;
  questions: BuybackQuestion[];
}
```
  ใน `BuybackBreakdown` เพิ่ม: `cashPrice?: string; exchangePrice?: string; bonusPct?: string; chosenFlow?: 'BUYBACK' | 'EXCHANGE';`
  ใน `BuybackQuoteResult` เพิ่ม: `cashPrice?: string; exchangePrice?: string; bonusPct?: string;`
  ใน `Buyback` เพิ่ม: `flow: 'BUYBACK' | 'EXCHANGE';`

- [ ] **Step 7.4: Landing** — แทนทั้งไฟล์ `BuybackLandingPage.tsx`:

```tsx
import { Banknote, ClipboardCheck, Repeat, Store } from 'lucide-react';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import { Card, CardBody, Container, LandingHero } from '@/components';
import { usePageMeta } from '@/hooks/usePageMeta';

const OPTIONS = [
  {
    icon: <Banknote className="size-7" aria-hidden="true" />,
    title: copy.sell.cashOption,
    description: 'ตกลงราคาออนไลน์ มารับเงินสด/โอนที่ร้านทันทีหลังตรวจเครื่อง',
  },
  {
    icon: <Repeat className="size-7" aria-hidden="true" />,
    title: copy.sell.exchangeOption,
    description: 'ได้มูลค่าสูงกว่าขายสด — ใช้เป็นส่วนลดเลือกซื้อเครื่องใหม่ในร้าน',
  },
];

const TRUST_POINTS = [
  { title: 'ราคามาตรฐาน ไม่ต้องต่อรอง', description: 'ทุกคำตอบมีราคากำกับชัดเจน เห็นที่หักทุกรายการ' },
  { title: 'ตรวจเครื่องต่อหน้า ปฏิเสธได้', description: 'ยืนยันราคาจริงตอนตรวจเครื่องที่ร้าน ไม่พอใจยกเลิกได้ ฟรี' },
  { title: 'ลบข้อมูลให้ฟรี ปลอดภัย', description: 'ทีมงานช่วยสำรอง/ลบข้อมูลก่อนขาย ใช้บัตรประชาชนใบเดียว' },
];

export default function SellLandingPage() {
  usePageMeta(
    copy.sell.pageTitle,
    'ขายหรือเทิร์น iPhone ลพบุรี รู้ราคาทันทีออนไลน์ รับเงินสดหรือเทิร์นแลกเครื่องใหม่ได้ราคาเพิ่ม',
  );

  return (
    <ShopLayout>
      <LandingHero
        eyebrow="บริการเสริม"
        title="ขาย/เทิร์น iPhone รู้ราคาใน 1 นาที"
        description={copy.sell.description}
        cta={{ label: copy.sell.quoteCta, to: '/sell/quote' }}
        steps={[
          {
            icon: <ClipboardCheck className="size-8" aria-hidden="true" />,
            title: 'เช็คราคาออนไลน์',
            description: 'เลือกรุ่น ตอบแบบประเมิน เห็น 2 ราคาทันที',
          },
          {
            icon: <Repeat className="size-8" aria-hidden="true" />,
            title: 'เลือกทางที่ชอบ',
            description: 'รับเงินสด หรือเทิร์นได้ราคาเพิ่ม',
          },
          {
            icon: <Store className="size-8" aria-hidden="true" />,
            title: 'มาที่ร้าน',
            description: 'ตรวจเครื่องต่อหน้า จ่ายสด/เลือกเครื่องใหม่',
          },
        ]}
      />
      <Container narrow className="py-8 md:py-12 space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <Card key={o.title} variant="elevated">
              <CardBody className="space-y-2 leading-snug">
                <div className="flex items-center gap-2 font-semibold leading-snug">
                  {o.icon}
                  {o.title}
                </div>
                <p className="text-sm text-muted-foreground leading-snug">{o.description}</p>
              </CardBody>
            </Card>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {TRUST_POINTS.map((t) => (
            <Card key={t.title} variant="outlined">
              <CardBody className="space-y-1 leading-snug">
                <div className="font-semibold leading-snug">{t.title}</div>
                <p className="text-sm text-muted-foreground leading-snug">{t.description}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </Container>
    </ShopLayout>
  );
}
```

- [ ] **Step 7.5: Nav/Footer/Home/sitemap**
  - `ShopHeader.tsx` NAV_LINKS: ลบ `{ to: '/trade-in', label: 'เก่าแลกใหม่' }` และ `{ to: '/buyback', label: 'รับซื้อ iPhone' }` → แทนด้วย `{ to: '/sell', label: 'ขาย/เทิร์น iPhone' }` ตัวเดียว (ตำแหน่งเดิมของ trade-in)
  - `ShopFooter.tsx`: 2 `<li>` เดิม → `<li><Link to="/sell">ขาย/เทิร์น iPhone</Link></li>`
  - `HomePage.tsx`: SERVICE_ITEMS เหลือ 2 ตัว (ซื้อ/ผ่อน + `{ icon: <Repeat .../>, title: copy.home.serviceSellTitle, description: copy.home.serviceSellDescription, cta: copy.home.serviceSellCta, to: '/sell' }`) — ลบ import `Banknote` ถ้าไม่ใช้แล้ว + **แก้ grid `sm:grid-cols-3` → `sm:grid-cols-2`** (บรรทัด ~174)
  - `public/sitemap.xml`: แทน `<loc>...trade-in</loc>` + `<loc>...buyback</loc>` (2 url block) ด้วย block เดียว `https://shop.bestchoicephone.app/sell`

- [ ] **Step 7.6:** build จะยังแดง (หน้า quote/status ใช้ key เก่า) — ทำ Task 8-10 ต่อแล้ว commit รวมท้าย Task 10

### Task 8: Routes /sell + redirects + ลบ trade-in เก่า

**Files:**
- Rename: `apps/web-shop/src/pages/buyback/` → `apps/web-shop/src/pages/sell/` (git mv; component names → SellLandingPage/SellQuotePage/SellStatusPage)
- Modify: `apps/web-shop/src/App.tsx`
- Delete: `apps/web-shop/src/pages/trade-in/` (3 ไฟล์), `apps/web-shop/src/components/device-submit/` (4 ไฟล์), `apps/web-shop/src/types/trade-in.ts`, `apps/web-shop/src/hooks/useSignedUpload.ts`
- Modify: `apps/web/e2e/shop-phase3-apply.spec.ts` (ลบ block trade-in ใน describe.skip — **ห้ามแตะ e2e อื่น**)

- [ ] **Step 8.1: Rename + component names**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git mv apps/web-shop/src/pages/buyback apps/web-shop/src/pages/sell
git mv apps/web-shop/src/pages/sell/BuybackLandingPage.tsx apps/web-shop/src/pages/sell/SellLandingPage.tsx
git mv apps/web-shop/src/pages/sell/BuybackQuotePage.tsx apps/web-shop/src/pages/sell/SellQuotePage.tsx
git mv apps/web-shop/src/pages/sell/BuybackStatusPage.tsx apps/web-shop/src/pages/sell/SellStatusPage.tsx
```
  แก้ชื่อ function ภายใน 3 ไฟล์: `BuybackLandingPage`→`SellLandingPage` (Task 7 ตั้งแล้ว), `BuybackQuotePage`→`SellQuotePage`, `BuybackStatusPage`→`SellStatusPage`

- [ ] **Step 8.2: App.tsx** — แก้ imports (ลบ TradeIn* 3 ตัว + Buyback* → Sell* จาก `./pages/sell/...`), เพิ่ม `useParams` ใน import react-router, เพิ่ม helper 2 ตัวเหนือ `function RouteTracker()`:

```tsx
function RedirectPreserveSearch({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search }} replace />;
}

function RedirectWithId({ base }: { base: string }) {
  const { id } = useParams();
  const location = useLocation();
  return <Navigate to={{ pathname: `${base}/${id ?? ''}`, search: location.search }} replace />;
}
```
  แทน block routes เดิม (trade-in 3 + buyback 4 บรรทัด) ด้วย:

```tsx
        <Route path="/sell" element={<SellLandingPage />} />
        <Route path="/sell/quote" element={<SellQuotePage />} />
        <Route path="/sell/:id" element={<SellStatusPage />} />
        {/* ลิงก์เก่าทุกเส้น (LINE/โฆษณา/bookmark) — ส่งต่อ query string (utm) ด้วย */}
        <Route path="/buyback" element={<RedirectPreserveSearch to="/sell" />} />
        <Route path="/buyback/quote" element={<RedirectPreserveSearch to="/sell/quote" />} />
        <Route path="/buyback/submit" element={<RedirectPreserveSearch to="/sell/quote" />} />
        <Route path="/buyback/:id" element={<RedirectWithId base="/sell" />} />
        <Route path="/trade-in" element={<RedirectPreserveSearch to="/sell" />} />
        <Route path="/trade-in/submit" element={<RedirectPreserveSearch to="/sell/quote" />} />
        <Route path="/trade-in/:id" element={<RedirectWithId base="/sell" />} />
```

- [ ] **Step 8.3: ลบไฟล์**

```bash
git rm -r apps/web-shop/src/pages/trade-in apps/web-shop/src/components/device-submit
git rm apps/web-shop/src/types/trade-in.ts apps/web-shop/src/hooks/useSignedUpload.ts
```

- [ ] **Step 8.4: e2e cleanup** — ใน `apps/web/e2e/shop-phase3-apply.spec.ts` ลบเฉพาะ test ที่ goto `/trade-in/submit` (บรรทัด ~17-29 ใน describe.skip) พร้อม comment ว่า flow ถูกยุบเข้า /sell — ไฟล์ e2e อื่นห้ามแตะ

- [ ] **Step 8.5: grep gates** (จะผ่านสมบูรณ์หลัง Task 9-10 แก้หน้า quote/status เสร็จ):

```bash
grep -rn "TRADE_IN_PHOTO\|device-submit\|types/trade-in\|useSignedUpload" apps/web-shop/src || echo CLEAN
grep -rn "'/trade-in'\|\"/trade-in\"\|'/buyback'" apps/web-shop/src | grep -v "App.tsx" || echo CLEAN-LINKS
```

### Task 9: Wizard dual-price (`SellQuotePage.tsx`)

**Files:**
- Modify: `apps/web-shop/src/pages/sell/SellQuotePage.tsx`

**Interfaces:**
- Consumes: quote/questions response ใหม่ (Task 2), `copy.sell.*` (Task 7), types (Task 7)
- Produces: submit payload + `flow`; Lead event + `flow`

- [ ] **Step 9.1: แก้ไฟล์ตามรายการ (โค้ดชิ้นสำคัญให้ครบ):**
  1. state เพิ่ม: `const [chosenFlow, setChosenFlow] = useState<'BUYBACK' | 'EXCHANGE' | null>(null);`
  2. ทุกจุดที่เรียก `setQuote(null)` (ใน `pick`, model onChange, storage onChange) เพิ่ม `setChosenFlow(null);` ติดกัน
  3. questions query type → `BuybackQuestionsResponse`; `const bonusPct = questionsQ.data?.bonusPct ?? '10';`
  4. preview block เทิร์น — แทน block `preview && preview.complete && !quote` เดิมด้วย:

```tsx
              {preview && preview.complete && !quote && (
                <div className="rounded-xl bg-muted p-3 text-sm leading-snug space-y-0.5">
                  <div>ขายรับเงินสด ~฿{preview.price.toLocaleString()}</div>
                  <div>
                    เทิร์นแลกเครื่องใหม่ ~฿
                    {Math.max(
                      Math.floor((preview.price * (100 + Number(bonusPct))) / 100 / 10) * 10,
                      0,
                    ).toLocaleString()}{' '}
                    <span className="text-emerald-700">(+{Number(bonusPct)}%)</span>
                  </div>
                  <div className="text-xs text-muted-foreground">กด "ดูราคา" เพื่อยืนยัน</div>
                </div>
              )}
```
  5. CTA label ทั้ง 2 จุด (inline + sticky) → `{quote ? 'เลื่อนลงเพื่อยืนยัน' : preview?.complete ? 'ดูราคา' : 'ตอบแบบประเมินให้ครบก่อน'}`
  6. Step 3 — แทน header + การ์ดราคาเดิม (block `<h2>3. ราคารับซื้อของคุณ` + emerald card) ด้วย dual-price radio-cards:

```tsx
              <h2 className="font-semibold leading-snug">3. เลือกทางที่ต้องการ</h2>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="เลือกวิธีขาย">
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosenFlow === 'BUYBACK'}
                  onClick={() => setChosenFlow('BUYBACK')}
                  className={`rounded-xl border p-4 text-left leading-snug transition-colors ${
                    chosenFlow === 'BUYBACK'
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-zinc-200 hover:bg-accent'
                  }`}
                >
                  <div className="text-sm text-muted-foreground">💵 {copy.sell.cashOption}</div>
                  <div className="text-3xl font-bold text-emerald-600">
                    ฿{Number(quote.cashPrice ?? quote.price).toLocaleString()}
                  </div>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosenFlow === 'EXCHANGE'}
                  onClick={() => setChosenFlow('EXCHANGE')}
                  className={`rounded-xl border p-4 text-left leading-snug transition-colors ${
                    chosenFlow === 'EXCHANGE'
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-zinc-200 hover:bg-accent'
                  }`}
                >
                  <div className="text-sm text-muted-foreground">
                    🔄 {copy.sell.exchangeOption}{' '}
                    {Number(quote.bonusPct ?? 0) > 0 && (
                      <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                        +{Number(quote.bonusPct)}%
                      </span>
                    )}
                  </div>
                  <div className="text-3xl font-bold text-emerald-600">
                    ฿{Number(quote.exchangePrice ?? quote.price).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">{copy.sell.exchangeCreditNote}</div>
                </button>
              </div>
```
  7. breakdown เดิมคงไว้ (รวมเป็น cash) + ต่อท้าย lines เพิ่มบรรทัดโบนัสเมื่อเลือกเทิร์น:

```tsx
                {chosenFlow === 'EXCHANGE' && quote.cashPrice && quote.exchangePrice && (
                  <div className="flex justify-between font-medium text-emerald-700">
                    <span>โบนัสเทิร์น +{Number(quote.bonusPct)}%</span>
                    <span>
                      +฿{(Number(quote.exchangePrice) - Number(quote.cashPrice)).toLocaleString()}
                    </span>
                  </div>
                )}
```
  8. Step 4 header → `4. ยืนยัน — นัดเข้าร้าน`; submit payload เพิ่ม `flow: chosenFlow ?? 'BUYBACK'`; ปุ่ม submit:
     - `disabled={!sellerReady || !chosenFlow || submitMutation.isPending}`
     - label: `{chosenFlow === 'EXCHANGE' ? 'ยืนยันเทิร์น — มาเลือกเครื่องที่ร้าน' : 'ยืนยันขาย — รับเงินสดที่ร้าน'}`
  9. `onSuccess`: `track('Lead', { type: 'buyback', model, storage, grade: quote?.grade, flow: chosenFlow ?? 'BUYBACK' });` toast → `chosenFlow === 'EXCHANGE' ? copy.sell.submitSuccessExchange : copy.sell.submitSuccessCash`; `nav(\`/sell/${data.id}\`)`
  10. breadcrumbs → `[{ label: copy.sell.pageTitle, to: '/sell' }, { label: 'เช็คราคา' }]`; `copy.buyback.*` ที่เหลือ → `copy.sell.*`

### Task 10: Status page flow-aware (`SellStatusPage.tsx`)

**Files:**
- Modify: `apps/web-shop/src/pages/sell/SellStatusPage.tsx`

- [ ] **Step 10.1: แก้:**
  1. `const flow = data.flow ?? data.quoteBreakdown?.chosenFlow ?? 'BUYBACK';` `const isExchange = flow === 'EXCHANGE';` (วางหลัง `const estimated = ...`)
  2. Stepper instant: `[{ label: 'ยืนยันราคาแล้ว' }, { label: isExchange ? 'เข้าร้านเลือกเครื่องใหม่' : 'เข้าร้านตรวจเครื่อง' }, { label: 'เสร็จสิ้น' }]`
  3. Badge PENDING_APPRAISAL instant: `isExchange ? 'ยืนยันมูลค่าเทิร์นแล้ว — รอนัดเข้าร้าน' : 'ยืนยันราคาแล้ว — รอนัดเข้าร้าน'`; REJECTED: แทน `STATUS_LABEL[data.status]` lookup ด้วย wrapper — เมื่อ `data.status === 'REJECTED' && isExchange` → `'ไม่รับเทิร์น'`
  4. การ์ดราคา instant: title → `isExchange ? 'มูลค่าเทิร์นที่ยืนยันแล้ว' : copy.sell.quotedTitle`; ใน breakdown ต่อท้าย lines เพิ่ม:

```tsx
                    {isExchange && data.quoteBreakdown.cashPrice && data.quoteBreakdown.exchangePrice && (
                      <div className="flex justify-between font-medium">
                        <span>โบนัสเทิร์น +{Number(data.quoteBreakdown.bonusPct ?? 0)}%</span>
                        <span>
                          +฿{(
                            Number(data.quoteBreakdown.exchangePrice) -
                            Number(data.quoteBreakdown.cashPrice)
                          ).toLocaleString()}
                        </span>
                      </div>
                    )}
```
     และใต้ `priceCondition` เพิ่ม `{isExchange && <p className="text-xs text-emerald-800 leading-snug">{copy.sell.exchangeCreditNote}</p>}`
  5. breadcrumbs → `{ label: copy.sell.pageTitle, to: '/sell' }`; `copy.buyback.*` → `copy.sell.*`
  6. ลบ dead block `data.notes` (บรรทัด ~190)

- [ ] **Step 10.2: Build + commit Tasks 7-10**

```bash
cd apps/web-shop && npm run build
```
Expected: 0 errors →
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/web-shop/src apps/web-shop/public/sitemap.xml apps/web/e2e/shop-phase3-apply.spec.ts
git commit -m "feat(web-shop): /sell dual-price wizard + redirects 7 เส้น + ลบ trade-in เก่าทั้งยวง"
```
(ตรวจ `git status` ก่อน add — ห้ามติดไฟล์ payments)

---

## Phase C — staff (apps/web)

### Task 11: Staff UI flow-aware

**Files:**
- Modify: `apps/web/src/pages/TradeInPage/components/TradeInTable.tsx` (badge ในคอลัมน์ราคา)
- Modify: `apps/web/src/pages/TradeInPage/components/OnlineAppraiseModal.tsx`
- Modify: `apps/web/src/pages/TradeInPage/components/TradeInDetailDialog.tsx`
- Modify: `apps/web/src/pages/TradeInPage/components/QuestionnaireTab.tsx` (กล่องโบนัส %)
- Modify: `apps/web/src/pages/TradeInPage/types.ts` (breakdown fields ใหม่)

**Interfaces:**
- Consumes: `GET/PUT /trade-ins/sell-config` (Task 3), `useCashPrice` (Task 4), breakdown fields (Task 2)

- [ ] **Step 11.1: types.ts** — ใน `quoteBreakdown` type เพิ่ม: `cashPrice?: string; exchangePrice?: string; bonusPct?: string; chosenFlow?: 'BUYBACK' | 'EXCHANGE';`

- [ ] **Step 11.2: TradeInTable** — ในคอลัมน์ `estimatedValue` render, ใต้ `methodLabel` block เพิ่ม badge (import Badge จาก `@/components/ui/badge` ตามที่ไฟล์ใช้อยู่แล้ว — เช็ค import เดิมของไฟล์):

```tsx
            <div className="text-xs">
              {item.flow === 'EXCHANGE' ? (
                <span className="text-warning font-medium">เทิร์น (เครดิต)</span>
              ) : (
                <span className="text-muted-foreground">รับซื้อ</span>
              )}
            </div>
```
  (แสดงเสมอ — walk-in เดิมส่วนใหญ่เป็น BUYBACK; ใช้ text ธรรมดาถ้า Badge component ไม่มีในไฟล์)

- [ ] **Step 11.3: OnlineAppraiseModal**
  1. หัว modal (`rounded-lg bg-muted p-3` block) — แทนด้วย:

```tsx
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <div className="font-semibold">
              {item.deviceBrand} {item.deviceModel} {item.deviceStorage ?? ''}
              <span className={`ml-2 text-xs font-medium ${item.flow === 'EXCHANGE' ? 'text-warning' : 'text-muted-foreground'}`}>
                {item.flow === 'EXCHANGE' ? 'เทิร์นแลกเครื่องใหม่ (เครดิต)' : 'รับซื้อเงินสด'}
              </span>
            </div>
            {quoted !== null && (
              <div className="text-lg font-bold">ราคาที่เสนอออนไลน์: ฿{quoted.toLocaleString()}</div>
            )}
            {item.quoteBreakdown?.cashPrice && item.quoteBreakdown?.exchangePrice && (
              <div className="text-xs text-muted-foreground">
                เงินสด ฿{Number(item.quoteBreakdown.cashPrice).toLocaleString()} · เทิร์น ฿
                {Number(item.quoteBreakdown.exchangePrice).toLocaleString()} (+
                {Number(item.quoteBreakdown.bonusPct ?? 0)}%)
              </div>
            )}
          </div>
```
  2. copy AS_ANSWERED (บรรทัด ~111-113) — ใช้ estimatedValue จริง: แทนด้วย

```tsx
          {mode === 'AS_ANSWERED' && (
            <p className="text-muted-foreground">
              ยืนยัน{item.flow === 'EXCHANGE' ? 'มูลค่าเทิร์น (เครดิตซื้อเครื่องใหม่)' : 'รับซื้อ'}ที่ ฿
              {Number(item.estimatedValue ?? quoted ?? 0).toLocaleString()} ตามใบเสนอ
            </p>
          )}
```
  3. ปุ่มโหมดแถวเดิม — เพิ่มปุ่มที่ 4 (เฉพาะเทิร์น) หลัง REVISED:

```tsx
            {item.flow === 'EXCHANGE' && (
              <Button
                variant={cashFallback ? 'primary' : 'outline'}
                size="sm"
                onClick={() => { setMode('AS_ANSWERED'); setCashFallback(true); }}
              >
                ลูกค้าไม่ซื้อเครื่อง — ใช้ราคาเงินสด
              </Button>
            )}
```
     + state `const [cashFallback, setCashFallback] = useState(false);` (reset ใน `handleClose` และเมื่อกดปุ่มโหมดอื่น: ใน onClick ของ 3 ปุ่มเดิมเพิ่ม `setCashFallback(false);`) + แสดงคำอธิบายเมื่อ active:

```tsx
          {cashFallback && item.quoteBreakdown?.cashPrice && (
            <p className="text-muted-foreground">
              ถอยเป็นขายเงินสด ฿{Number(item.quoteBreakdown.cashPrice).toLocaleString()} — ระบบจะเปลี่ยนรายการเป็น "รับซื้อ"
            </p>
          )}
```
  4. `confirm()` AS_ANSWERED → `appraise.mutate(cashFallback ? { mode, useCashPrice: true } : { mode });`

- [ ] **Step 11.4: TradeInDetailDialog** — ใน block `ใบเสนอราคาออนไลน์`:
  - ใต้ `<div className="font-medium">ใบเสนอราคาออนไลน์</div>` เพิ่ม:

```tsx
              {data.quoteBreakdown.chosenFlow && (
                <div className="text-xs text-muted-foreground">
                  ประเภท: {data.quoteBreakdown.chosenFlow === 'EXCHANGE' ? 'เทิร์นแลกเครื่องใหม่ (เครดิต)' : 'รับซื้อเงินสด'}
                </div>
              )}
```
  - ก่อนบรรทัดสรุป `ราคาที่เสนอ` เพิ่มบรรทัดโบนัส (เมื่อ chosenFlow=EXCHANGE):

```tsx
              {data.quoteBreakdown.chosenFlow === 'EXCHANGE' &&
                data.quoteBreakdown.cashPrice &&
                data.quoteBreakdown.exchangePrice && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>โบนัสเทิร์น +{Number(data.quoteBreakdown.bonusPct ?? 0)}%</span>
                    <span>
                      +฿{(
                        Number(data.quoteBreakdown.exchangePrice) -
                        Number(data.quoteBreakdown.cashPrice)
                      ).toLocaleString()}
                    </span>
                  </div>
                )}
```

- [ ] **Step 11.5: QuestionnaireTab โบนัส %** — วางกล่อง config เหนือ `{(data?.questions ?? []).map(...)}` (ใต้ p อธิบาย):

```tsx
      <SellConfigBox />
```
  และเพิ่ม component ท้ายไฟล์ (หรือไฟล์ใหม่ `SellConfigBox.tsx` ข้างกัน — เลือกไฟล์ใหม่ให้ QuestionnaireTab ไม่บวม):

```tsx
// apps/web/src/pages/TradeInPage/components/SellConfigBox.tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** โบนัสเทิร์น % — ราคาเทิร์นบนเว็บ = เงินสด × (1+โบนัส) มีผล quote ถัดไปทันที */
export default function SellConfigBox() {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  const { data } = useQuery<{ exchangeBonusPct: number }>({
    queryKey: ['sell-config'],
    queryFn: () => api.get('/trade-ins/sell-config').then((r) => r.data),
  });
  useEffect(() => {
    if (data) setValue(String(data.exchangeBonusPct));
  }, [data]);

  const save = useMutation({
    mutationFn: (exchangeBonusPct: number) =>
      api.put('/trade-ins/sell-config', { exchangeBonusPct }),
    onSuccess: () => {
      toast.success('บันทึกโบนัสเทิร์นแล้ว');
      queryClient.invalidateQueries({ queryKey: ['sell-config'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const dirty = data !== undefined && value !== String(data.exchangeBonusPct);

  return (
    <div className="rounded-lg border border-border p-3 flex flex-wrap items-end gap-3">
      <div>
        <Label>โบนัสเทิร์น (%)</Label>
        <Input
          className="mt-1 w-28"
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground leading-snug flex-1 min-w-48">
        ราคาเทิร์นบนเว็บ = ราคาเงินสด × (1 + โบนัส) — เครดิตใช้เป็นส่วนลดซื้อเครื่องในร้านเท่านั้น
      </p>
      {dirty && (
        <Button
          size="sm"
          onClick={() => {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0 || n > 100) {
              toast.error('โบนัสต้องอยู่ระหว่าง 0–100');
              return;
            }
            save.mutate(n);
          }}
          disabled={save.isPending}
        >
          บันทึก
        </Button>
      )}
    </div>
  );
}
```
  (import `SellConfigBox` ใน QuestionnaireTab)

- [ ] **Step 11.6: Typecheck + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/TradeInPage/
git commit -m "feat(web): staff flow-aware — badge เทิร์น/รับซื้อ + 2 ราคาใน modal/detail + ปุ่มถอยเงินสด + กล่องโบนัส %"
```

---

## Phase D — CI + Verification

### Task 12: CI build web-shop ใน Lint & Test

**Files:**
- Modify: `.github/workflows/deploy-gcp.yml` (job `lint-and-test` — หลัง step "Build Web")

- [ ] **Step 12.1:** เปิดดู step "Build customer shop" ใน deploy job (บรรทัด ~425) ว่าใช้ env อะไร แล้วเพิ่ม step ใหม่ต่อจาก "Build Web" ใน `lint-and-test` (mirror env ที่จำเป็นของ build shop ถ้ามี — ถ้า build ได้โดยไม่มี env ให้ minimal):

```yaml
      # /sell rework ลบไฟล์จำนวนมากใน web-shop — ก่อนหน้านี้ CI ไม่เคย build
      # web-shop เลย (พังจะไปโผล่ตอน deploy บน main) จึงเพิ่ม gate ที่ PR
      - name: Build Web-Shop (customer storefront)
        run: npm run build --workspace=apps/web-shop
```

- [ ] **Step 12.2:** validate YAML (`npx yaml-lint .github/workflows/deploy-gcp.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-gcp.yml'))"`) + commit:

```bash
git add .github/workflows/deploy-gcp.yml
git commit -m "ci: build web-shop ใน Lint & Test — ปิดช่อง PR ผ่านแต่ deploy พัง"
```

### Task 13: Full verification + browser pass + PR

- [ ] **Step 13.1: Automated ทั้งชุด**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh all          # 0 errors
cd apps/api && npx jest src/modules/shop-buyback src/modules/trade-in src/modules/storage --runInBand
cd ../web-shop && npm run build
git log --oneline origin/main..HEAD -- apps/api/src/modules/journal/ | wc -l   # ต้อง = 0 (red line)
```

- [ ] **Step 13.2: Browser pass (local dev, Playwright จริง)** — servers: api :3000 + web-shop :5174 (+ apps/web :5173 สำหรับ staff):
1. `/sell` landing ใหม่ (2 option cards + trust); nav/footer = "ขาย/เทิร์น iPhone" ลิงก์เดียว; HomePage 2 การ์ด grid ไม่มีคอลัมน์ว่าง
2. `/sell/quote`: iPhone 15/128GB → ตอบครบ (หมดประกัน+ไม่มีกล่อง+รอยนิดหน่อย ที่เหลือดี) → "ดูราคา" → เห็น 2 ราคา: เงินสด **฿17,480** / เทิร์น **฿19,220** (@10%: 17,480×1.1=19,228→19,220) → เลือกเทิร์น → บรรทัดโบนัสแสดง → submit (ปุ่ม label เทิร์น) → `/sell/:id` แสดง "ยืนยันมูลค่าเทิร์นแล้ว" + breakdown + โบนัสบรรทัด
3. เลือกเงินสด → submit → status label รับซื้อ (อีก record — เปลี่ยน IMEI/เบอร์กัน dup 24h)
4. Redirect ทั้ง 7: `/buyback`, `/buyback/quote`, `/buyback/submit`, `/buyback/<id>`, `/trade-in`, `/trade-in/submit`, `/trade-in/<id>` → ไป `/sell*` ถูกเส้น + ลอง `?utm_source=test` ติดไปด้วย
5. API: `POST /api/shop/trade-in/estimate` → **410**; `POST /api/shop/buyback/submit` แบบไม่มี flow → 200 + record BUYBACK (back-compat)
6. Staff: `/trade-in` → ตาราง badge เทิร์น/รับซื้อ; record เทิร์นที่เพิ่ง submit → "ประเมิน" → modal โชว์ 2 ราคา + badge เทิร์น → "สภาพตรงตามที่ตอบ" ยืนยัน → APPRAISED ที่ราคาเทิร์น; อีก record เทิร์น → ปุ่ม "ลูกค้าไม่ซื้อเครื่อง" → ยืนยัน → ราคา cash + badge เปลี่ยนเป็นรับซื้อ; "ดู" → detail มีบรรทัดโบนัส; แท็บแบบประเมิน → แก้โบนัส 10→15 → เว็บ quote ใหม่เทิร์นเปลี่ยน (แล้วตั้งกลับ 10)
7. accept record เทิร์น (กรอก accept form) → ตรวจ DB: `Product.costPrice` = ราคาเงินสด ไม่ใช่ราคาเทิร์น
8. Mobile 390px: dual-price cards ไม่ล้น, sticky bar ทำงาน

- [ ] **Step 13.3: PR**

```bash
git push -u origin feat/sell-unified-instant-quote
gh pr create --title "feat: รวมขาย/เทิร์น iPhone เป็น /sell — dual-price instant quote + ปลดระวาง shop-trade-in" --body "$(cat <<'EOF'
## Summary
- `/sell` หน้าเดียว: ตอบแบบประเมิน → เห็น 2 ราคา (เงินสด / เทิร์น +โบนัส% ตั้งค่าได้ใน SystemConfig) → เลือกทาง → นัดเข้าร้าน; `/buyback*`+`/trade-in*` redirect ครบ 7 เส้น (ส่งต่อ utm)
- นโยบายเทิร์น = เครดิตส่วนลดซื้อเครื่องในร้าน: `Product.costPrice` ของเทิร์น = ราคาเงินสด (COGS ไม่บวมโบนัส), staff มีปุ่มถอยเงินสด, badge เทิร์น/รับซื้อทุกจุด
- Invariant: `quoteBreakdown.price` == `estimatedValue` == ราคาทางที่เลือก; REVISED คิดโบนัสตาม flow (% ปัจจุบัน) + คง chosenFlow
- ปลดระวาง `shop-trade-in`: 410 stub 1 release, ลบ `TradeInIntakeService` (เอนจินเหลือตัวเดียว), ถอด `TRADE_IN_PHOTO` presign
- CI: เพิ่ม build web-shop ใน Lint & Test (เดิมไม่เคย build — ช่องโหว่จริง)
- **ไม่มี migration**; ไม่แตะบัญชี/journal, walk-in staff เดิม
- Spec: docs/superpowers/specs/2026-07-18-sell-unified-instant-quote-design.md

## Test plan
- Jest: bonus goldens (12,420@10→13,660), dual-price invariant, submit 2 flow + back-compat ไม่ส่ง flow, REVISED/useCashPrice, accept costPrice 3 เคส, sell-config, 410 stubs
- Browser pass 8 ข้อ (2 viewport) รวม redirect 7 เส้น + staff ครบ

⚠️ หลัง merge: owner ตั้งโบนัสเทิร์น % จริง + แจ้ง staff ว่าเทิร์น = เครดิต ห้ามจ่ายสด (มีปุ่มถอยเงินสดใน modal)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Execution note

- ลำดับ: T1→T2→T3→T4→T5→T6 (backend เรียงตามนี้), T7→T8→T9→T10 (web-shop, commit รวมท้าย T10), T11, T12, T13
- ห้ามแตะ: `app.module.ts`, `modules/journal/**`, e2e staff 3 ไฟล์, ไฟล์ payments dirty
- ทุก task จบด้วย test เขียว; task ที่ยังไม่ commit (7-9) ให้รัน typecheck เท่าที่ compile ได้แล้วไปต่อตามที่ระบุ
