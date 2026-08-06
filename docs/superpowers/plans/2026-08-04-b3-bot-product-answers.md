# B3 — บอทตอบสินค้าได้เท่าแอดมิน Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้บอททั้ง 2 ตัว (บอทขาย = `sales-bot` บน LINE_SHOP/FACEBOOK/WEB และ **น้องเบส** = `chatbot-finance` บน LINE_FINANCE) ตอบคำถามสินค้าได้ครบเท่าแอดมิน — รุ่น/ความจุ/สี/สภาพ/แบต/ประกัน/อุปกรณ์/ตำหนิ/สาขา/จำนวนเครื่อง/ราคาเงินสด/ค่างวดจริง — **จากคอลัมน์ราคาเดียวกับเว็บ** พร้อมส่งรูป+ลิงก์สินค้าให้ลูกค้า และตัวเลขค่างวดต้องตรงกับ engine ที่ทำสัญญาจริง — spec: `docs/superpowers/specs/2026-08-04-product-answering-readiness-design.md` §5 (บริบท §0/§1/§8/§9/§10)

**Architecture:** ตรรกะที่ "ทั้งสองบอท + เว็บ + inbox" ต้องใช้ร่วมกัน ถูกดันลงเป็น **pure util ใน `apps/api/src/utils/`** (ไม่มี DI, import ข้าม module ได้โดยไม่ต้อง import NestJS module) — 3 ตัวใหม่: `price-grounding.util.ts` (ยก `collectGroundedPrices`/`guardGrounding` ออกจาก `SalesBotService` เพื่อให้ `FinanceAiService` ใช้ตัวเดียวกัน), `bc-installment-config.util.ts` (resolve `InterestConfig` แบบเดียวกับ engine ที่ทำสัญญาจริง), `kb-match.util.ts` (สกอร์ KB). ส่วน tool ของบอทขายคง pattern เดิม (`@Injectable` + `PrismaService`) และ **น้องเบสใช้ tool class เดียวกันโดย import class ตรง ๆ ไม่ import `SalesBotModule`** (PrismaModule เป็น `@Global()` — `apps/api/src/prisma/prisma.module.ts:5 — ประกาศ provider ซ้ำได้เลย)

**Tech Stack:** NestJS + Prisma (apps/api), React + React Query (apps/web), Postgres migration `20260983000000`, jest (api) / vitest (web)

## Global Constraints

- **Branch:** `feat/pa-b3-bot-product-answers` (ต่อจาก B0/B1/B2 — **B3 ขึ้นกับ B0 อย่างหนัก**: ใช้ `device-query-normalize.util.ts` + คอลัมน์ `accessoriesIncluded`/`cosmeticNotes` + `Product.conditionGrade` ที่มี writer จริง; **ห้ามเริ่ม B3 ก่อน B0 merge**)
- **Migration:** `20260983000000_kb_channel_nullable` — max บน main วันนี้ = `20260981000000_add_credit_note_source_fields`, B0 จอง `20260985000000` → `20260983000000` ว่างจริง. ก่อนสร้างให้รัน `ls apps/api/prisma/migrations | sort | tail -3` ยืนยันอีกครั้ง แล้วเลื่อนเลขถ้าชน
- **เนื้อ migration = `ALTER COLUMN ... DROP NOT NULL` เท่านั้น** — คอลัมน์ `chat_knowledge_base.channel` **มีอยู่แล้ว** (`schema.prisma:5177` `channel ChatChannel @default(LINE_FINANCE)` + `@@index([channel, intent])`) ห้าม `ADD COLUMN`
- **Red line:**
  - ห้ามแตะ `apps/api/src/modules/journal/`, `apps/api/src/modules/accounting/`, `apps/api/src/modules/payments/` (JE ทั้งหมด)
  - **ตัวเลขที่ลูกค้าเห็นต้องตรงกับ engine จริง** — Task 4 มี golden test เทียบ `calculate_installment` กับ `InstallmentPreviewService.preview()` ที่ input เดียวกัน **ต้องเขียวก่อน** ถึงจะถือว่า Task 4 เสร็จ
  - Task 4 แก้ `installment-preview.service.ts` ด้วย (ดึง config-resolution ออกเป็น util) — **ต้อง behavior-preserving**: `apps/api/src/modules/shop-catalog/*.spec.ts` เดิมต้องเขียวโดยไม่แก้ assertion (ข้อยกเว้นที่ documented ไว้จุดเดียว = เพิ่ม `orderBy: { createdAt: 'asc' }` ให้ deterministic — spec เดิมไม่ assert args ของ `findFirst` จึงยังเขียว)
- **ข้อตกลงข้าม batch (เจ้าของทับกัน — ต้องบังคับใช้ ไม่งั้น red line พัง):**
  - `apps/api/src/utils/bc-installment-config.util.ts` (Task 4) = **resolver `InterestConfig` → `BcConfig` ตัวเดียวของ repo**. แผน B4 (`2026-08-04-b4-web-shop-share-og.md:1437-1564`) วางแผนสร้าง `shop-catalog/bc-installment-config.service.ts` ที่ทำงานเดียวกันแทนบล็อกเดียวกัน **และเปลี่ยน constructor ของ `InstallmentPreviewService` เป็น 2 อาร์กิวเมนต์** ⇒ ต้องตัดออกจาก B4 แล้ว import util ของ B3 แทน (golden parity test ของ Task 4 สร้าง service ด้วย 1 อาร์กิวเมนต์)
  - `product-detect.service.ts` / `ai-suggest.service.ts` / `ProductContextCard.tsx` = **ของ B2 (Task 10)** — B3 ห้ามแตะ; Task 14 ของ B3 เหลือแค่ให้ `ProductQuoteService` ของ B2 ใช้ resolver ตัวเดียวกัน
- **Grounding guard = definition-of-done ของ batch** (spec §5): Task 1 ต้องเสร็จ+เขียว **ก่อน** Task 3/4 เปลี่ยน shape ผลลัพธ์ tool. บทเรียน #1064/#1337: เปลี่ยน shape โดยไม่อัปเดต `GROUNDED_PRICE_KEYS` = บอทโดน block เงียบ ๆ (confidence 0.3 → handoff) ไม่มี error ให้เห็น
- **Runner ฝั่ง api = jest เท่านั้น**: `cd apps/api && npx jest src/modules/sales-bot` (config อยู่ใน `apps/api/package.json:145`, `rootDir: src`, `testRegex .*\.spec\.ts$`) → **spec ทุกไฟล์ต้องอยู่ใต้ `apps/api/src/`**
- **⚠️ Runner ฝั่ง web = vitest ไม่ใช่ jest**: `cd apps/web && npx vitest run src/pages/AiSettingsPage.test.tsx` (`apps/web/vitest.config.ts`, jsdom, globals)
- **Type check:** `./tools/check-types.sh api` (= `cd apps/api && npx tsc --noEmit`) และ `./tools/check-types.sh web` → **0 error**
  ⚠️ **ต้อง `cd apps/api && npx prisma generate` ก่อนวัด baseline เสมอ** — บน working copy ที่ Prisma client ยังไม่ถูก generate ใหม่ `tsc --noEmit` จะพ่น error ~20 จุดที่ **ไม่เกี่ยวกับ B3 เลย** (ฟิลด์ `cnSource`/`publicToken` ของ `Receipt` จาก migration `20260981000000`) → ถ้าไม่ generate ก่อน จะแยกไม่ออกว่าอันไหนเป็นของเรา. Task 7 แก้ `schema.prisma` ด้วย ⇒ ต้อง generate ซ้ำหลัง Task 7
- **Lint (คำสั่งที่ใช้ได้จริง):**
  - api: `cd apps/api && npx eslint src/<path ที่แก้>`; gate ของ CI = `npm run lint --workspace=apps/api`
    ⚠️ **ห้ามใช้ `npx eslint .` เป็น gate** — มี **34 error ค้างก่อน B3** ทั้งหมดเป็น `Parsing error` ของไฟล์นอก `tsconfig.include` (`e2e/*.e2e-spec.ts`, `scripts/*.ts`, `eslint.config.mjs`) → เป้าหมายคือ **ไม่เพิ่ม error ใหม่** ไม่ใช่ 0 สัมบูรณ์
  - web: `cd apps/web && npx eslint .` → 0 error จริง (มี warning ค้างเยอะ — ปล่อยได้)
- **เงิน = `Prisma.Decimal` / `decimal.js`** ในเส้นทางคำนวณ; `Number()` ใช้ได้เฉพาะตอนแปลงออกเป็นผลลัพธ์ tool (JSON ที่ส่งให้ LLM)
- **UI copy + error message ภาษาไทย** (`.claude/rules/backend.md`)
- ทุก commit ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **ห้าม `git commit` โดย agent ที่เขียนแผน** — commit เกิดตอน execute เท่านั้น (แต่ละ Task ปิดด้วย 1 commit)
- QA เบราว์เซอร์ทำบน **local env เท่านั้น** (prod ปฏิเสธ seed accounts — memory `qa-prod-creds-and-purchasing-v2-result`)
- **ops step บังคับหลัง deploy:** อัปเดต **system prompt ของน้องเบส** ให้รู้จัก 3 tool ใหม่
  ⚠️ **ยืนยันกับโค้ดแล้ว: ไม่มีหน้าแอดมิน/endpoint สำหรับแก้ prompt เลย** — `FinanceConfigService.updateSystemPrompt()` (`finance-config.service.ts:116-122`) และ `FinanceAiService.invalidatePromptCache()` (`finance-ai.service.ts:243`) **ไม่มี caller ที่ไหนทั้งสิ้น**, `UpdatePromptDto` (`dto/admin.dto.ts:40-45`) เป็น DTO ตาย, และ `chatbot-finance-admin.controller.ts` ไม่มี route `prompt`
  ⚠️ และ `getSystemPrompt()` (`finance-config.service.ts:108-113`) = `systemConfig.findUnique({key:'finance_bot_system_prompt'})` **แล้ว `|| FINANCE_BOT_SYSTEM_PROMPT`** → ถ้าแถวนี้ **ยังไม่มี** ใน DB การแก้ constant **rollout จริง**; ถ้ามีแถวแล้ว constant จะไม่มีผลเลย
  → **วิธีที่ปลอดภัยกับทั้งสองกรณี = แก้ทั้ง 2 ที่**: (ก) แก้ constant `FINANCE_BOT_SYSTEM_PROMPT` ใน `prompts/system-prompt.ts` ในคอมมิตของ Task 10 และ (ข) รัน SQL upsert บน prod หลัง deploy — ขั้นตอนเต็มใน Deployment & Verification
  🚩 **ต้องให้ owner เคาะ:** จะสร้างหน้าแก้ prompt จริง (endpoint `GET/PUT admin/prompt` + textarea + เรียก `invalidatePromptCache`) ใน batch นี้เลยไหม หรือรับ SQL runbook ไปก่อน — **แผนนี้ตั้งต้นที่ "SQL runbook" (ไม่มีงานโค้ดเพิ่ม)**

---

## File Structure

**สร้างใหม่ (apps/api)**
| ไฟล์ | หน้าที่ |
|---|---|
| `src/utils/price-grounding.util.ts` (+`.spec.ts`) | `GROUNDED_PRICE_KEYS` (บอทขาย) / `FINANCE_GROUNDED_PRICE_KEYS` (น้องเบส, Task 11) / `collectGroundedPrices(value, into, keys?)` / `collectGroundedPricesFromText` / `collectGroundedPricesFromToolText` / `guardGrounding` — ยกออกจาก `SalesBotService` ให้ทั้ง 2 บอทใช้ตัวเดียว **แต่คนละ key-set** |
| `src/utils/bc-installment-config.util.ts` (+`.spec.ts`) | resolve `InterestConfig` → `BcConfig` แบบ **productCategories** (แบบเดียวกับ `sale-writer` / `contract-lifecycle` / `installment-preview`) |
| `src/utils/kb-match.util.ts` (+`.spec.ts`) | tokenize ไทย + สกอร์ KB (ยกจาก `knowledge.service.ts:58-143`) ให้บอทขายใช้ได้โดยไม่ import module การเงิน |
| `src/modules/sales-bot/__fixtures__/tool-results.fixture.ts` | **contract ของ shape ผลลัพธ์ tool ใหม่** (frozen) ใช้โดย grounding spec + tool spec |
| `src/modules/sales-bot/tools/search-knowledge-base.tool.ts` (+`.spec.ts`) | tool `search_knowledge_base` ของบอทขาย (Prisma-only, channel = LINE_SHOP/FACEBOOK/WEB + null) |
| `prisma/migrations/20260983000000_kb_channel_nullable/migration.sql` | `ALTER TABLE chat_knowledge_base ALTER COLUMN channel DROP NOT NULL` |
| `src/modules/sales-bot/tools/search-products.tool.spec.ts` | spec ใหม่ (วันนี้ tool นี้ **ไม่มี spec เลย**) |
| `src/modules/sales-bot/tools/list-promotions.tool.spec.ts` | spec ใหม่ (วันนี้ไม่มี spec) |

**สร้างใหม่ (apps/web)**
| ไฟล์ | หน้าที่ |
|---|---|
| `src/pages/AiSettingsPage.status.test.tsx` | vitest ของ status strip (env flags → badge) |

**แก้ไข (apps/api)**
| ไฟล์ | แก้อะไร |
|---|---|
| `src/modules/sales-bot/sales-bot.service.ts` (`SalesBotResult` :30-37, `runTool` :240-274, guard :292-369) | `attachments` ใน result + เก็บ attachment แบบ deterministic + ลบ guard เดิมมาใช้ util + ลงทะเบียน tool ใหม่ |
| `src/modules/sales-bot/tools/search-products.tool.ts` (ทั้งไฟล์ 91 บรรทัด) | ยกเครื่อง: parse ด้วย util B0 / widen select / group / RESERVED / คอลัมน์ราคา / photoAvailable |
| `src/modules/sales-bot/tools/calculate-installment.tool.ts` (ทั้งไฟล์ 118 บรรทัด) | ใช้ `calcBcInstallment` + config-resolution ร่วม + downPct จาก config |
| `src/modules/sales-bot/tools/get-installment-rates.tool.ts:76-85,101-103,126` | เลิกนิยาม `extractStorageToken`/`normalizeStorage` เอง → import จาก B0 util |
| `src/modules/sales-bot/tools/list-promotions.tool.ts:22-49` | implement `productId` / `categories` filter จริงจาก `conditions` JSON |
| `src/modules/sales-bot/sales-bot.module.ts:20-32` | +`SearchKnowledgeBaseTool` ใน providers/exports |
| `src/modules/shop-catalog/installment-preview.service.ts:56-97` | `previewBc` เรียก util config-resolution ตัวเดียวกัน (behavior-preserving) |
| `src/modules/staff-chat/services/ai-auto-reply.service.ts:103-146` | `autoReply` ส่ง `attachments` ต่อออกไป |
| `src/modules/chat-engine/services/message-router.service.ts:180-200` | ส่ง TEXT ก่อน (ใช้ replyToken) แล้วตามด้วย IMAGE bubble + persist `type`/`mediaUrl` |
| `src/modules/staff-chat/staff-chat.controller.ts:669-685` | +`GET ai/status` (OWNER) |
| `src/modules/chatbot-finance/services/knowledge.service.ts:43-56,150-192,194-210` | รับ `channel` เป็นพารามิเตอร์ + `OR:[{channel:null},{channel}]` + ใช้ `kb-match.util` |
| `src/modules/chatbot-finance/tools/tool-definitions.ts:11-124` | +3 product tools + `ToolName` union |
| `src/modules/chatbot-finance/tools/tool-input-schemas.ts:90-98` | +3 validator ใน `TOOL_INPUT_VALIDATORS` |
| `src/modules/chatbot-finance/tools/tool-executor.ts:35-112` | +3 tool ใน constructor + switch |
| `src/modules/chatbot-finance/chatbot-finance.module.ts:54-80` | +3 tool class ใน providers (import จาก sales-bot ตรง ๆ) |
| `src/modules/chatbot-finance/services/finance-ai.service.ts:99-199` | port grounding guard (+ seed ledger จาก history + `HandoffService` ในทางที่บล็อก) + คืน `attachments` |
| `src/modules/chatbot-finance/services/chatbot-finance.service.ts:319-325,490-542` | `replyAndSave` รับ `images[]` → LINE image message ตามหลัง text |
| `src/modules/chatbot-finance/chatbot-finance-admin.controller.ts:113-135` | KB CRUD ส่ง `channel` ต่อ |
| `src/modules/chatbot-finance/dto/admin.dto.ts:27-57` | `CreateKbDto`/`UpdateKbDto` +`channel?` |
| `src/modules/staff-chat/services/product-quote.service.ts` (`computeProductQuote`) | เลิกก็อปตรรกะ resolve config → เรียก `toBcConfig` ของ util Task 4 (Task 14) |
| `apps/api/prisma/schema.prisma:5177` | `channel ChatChannel? @default(LINE_FINANCE)` |

**แก้ไข (apps/web)**
| ไฟล์ | แก้อะไร |
|---|---|
| `src/pages/AiSettingsPage.tsx:22-27,96-121,404-441` | status strip (env flags) + annotate checkbox `LINE_FINANCE`/`TIKTOK` ที่เป็น no-op |
| `src/pages/ChatbotFinanceKnowledgePage.tsx:12-37,110-123,250-290` | เลือกช่องของ FAQ (รวม "ทุกช่อง" = null) |

> ⚠️ B3 **ไม่แก้ `apps/web` ฝั่ง inbox เลย** — `ProductContextCard.tsx` (รวมป้าย `(ดาวน์ …%)` ที่ผิดหน่วย) ถูกเขียนใหม่ทั้งไฟล์ไปแล้วใน **B2 Task 10** ห้ามแตะซ้ำ

**spec เดิมที่ "จะแดง" เพราะพฤติกรรมเปลี่ยน (ตรวจกับโค้ดจริงแล้ว — ห้ามข้าม)**
| ไฟล์ spec | เคสที่ต้องแก้ | Task |
|---|---|---|
| `src/modules/sales-bot/tools/calculate-installment.tool.spec.ts` | **แทบทั้งไฟล์** — goldens ปัจจุบันคิดจาก `prices[isDefault]` + ไม่มี commission/VAT (`:56-70` monthlyThb 3067, `:135-144` rate 0, `:146-160` error strings) และ mock prisma ไม่มี `interestConfig.findFirst({productCategories})` shape ใหม่ | 4 |
| `src/modules/chatbot-finance/services/knowledge.service.spec.ts` | **น่าจะเขียวอยู่** — mock `findMany` (:49-56) คืน entries เสมอโดยไม่ assert `where` และ `:117-139` assert `create` ด้วย `expect.objectContaining({channel:'LINE_FINANCE'})` ซึ่ง default ใหม่ยังให้ค่าเดิม → **ต้องรันยืนยันหลังแก้** ถ้าแดงแปลว่า default เพี้ยน; Task 7 เพิ่มเคสใหม่ 3 เคส (where มี `OR`, channel=null, listAll ตาม channel) | 7 |
| `src/modules/chatbot-finance/tools/tool-executor.spec.ts` | `:39-45` `Test.createTestingModule` มีแค่ 3 provider — constructor เพิ่ม 3 tool → Nest resolve ไม่ได้ = ทุกเคสแดง | 10 |
| `src/modules/chatbot-finance/services/finance-ai.service.spec.ts` | **แดงแน่นอน** — Task 11 เพิ่ม `HandoffService` เข้า constructor แต่ `Test.createTestingModule` ทั้ง 2 จุด (`:48-73`, `:262-276`) ไม่มี provider ตัวนี้ → Nest resolve ไม่ได้ = ทุกเคสในไฟล์แดง ⇒ ต้องเพิ่ม `{ provide: HandoffService, useValue: { handoff: jest.fn() } }` ทั้งคู่. **บวกอีกจุดที่ไม่แดงแต่ต้องแก้**: `:261` mock `toolExecutor.execute → { ok:true, data:{ ok:1 } }` (ไม่มีเลขเงิน) แล้วเคส `:291-300` ให้โมเดลตอบ `'ยอดคงเหลือของคุณคือ 5,000 บาทค่ะ'` → guard block → คืนข้อความ handoff (model/toolsUsed เท่าเดิม ⇒ assert เดิมยัง**ผ่านแบบหลอก**) ⇒ แก้เป็น `data: { totalAmount: 5000 }` + assert `handoffTriggered === false`. ห้ามปิด guard | 11 |
| `src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | **แดงแน่นอน** — Task 12 เขียน `replyAndSave` ให้เรียก `lineClient.replyMessage()` เสมอ (เลิกใช้ `replyText`/`replyWithQuickReply`) แต่เคสเดิม `:119` `expect(lineClient.replyText).toHaveBeenCalledWith('rt-1','สวัสดีค่ะ')` และ `:154` (fallback `'ระบบขัดข้อง'`) ยัง assert `replyText` → ต้องแปลงเป็น `replyMessage(replyToken, [{type:'text', text:...}])`; เคส `:146` (`replyText` **ไม่** ถูกเรียกตอน handoff) ผ่านต่อได้ทั้งที่ไม่มีความหมาย → เปลี่ยนเป็น `replyMessage` ด้วยเพื่อให้ยังกันของจริง | 12 |
| `src/modules/chat-engine/services/message-router.service.spec.ts` | `:57,:65,:101` ใช้ `toHaveBeenCalledWith` (ไม่ใช่ `Times`) → **ควรเขียวอยู่** แต่ต้องรันยืนยันหลัง Task 9 (IMAGE bubble เป็น call เพิ่ม) | 9 |
| `src/modules/sales-bot/sales-bot.service.spec.ts` | mock ผลลัพธ์ tool เป็น shape เก่า (`products:[{priceThb}]`) — `collectGroundedPrices` เดิน object recursive → **ต้องเขียวโดยไม่แก้**; ถ้าแดงแปลว่า Task 1 ทำ regression | 1 |
| `src/modules/shop-catalog/*.spec.ts` | ต้องเขียว **โดยไม่แก้ assertion** — พิสูจน์ว่า Task 4 behavior-preserving ฝั่ง preview | 4 |

---

### Task 1: ยกกฎ grounding ออกเป็น util + ปักหมุด shape ผลลัพธ์ tool ใหม่ (definition-of-done ของ batch)

> **ทำก่อนทุกอย่าง** — spec §5 ระบุชัดว่า grounding guard คือ definition-of-done. เป้าหมาย: มีเทสต์ที่รัน `collectGroundedPrices` + `guardGrounding` กับ **shape ใหม่** (fixture) แล้วเขียว **ก่อน** ที่ Task 3/4 จะเปลี่ยน tool จริง — ถ้าเปลี่ยน shape ก่อนแล้วลืม key บอทจะ "โง่ลงเงียบ ๆ" (confidence 0.3 → handoff) โดยไม่มี error

**Files:**
- Create: `apps/api/src/utils/price-grounding.util.ts`
- Create: `apps/api/src/utils/price-grounding.util.spec.ts`
- Create: `apps/api/src/modules/sales-bot/__fixtures__/tool-results.fixture.ts`
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.ts` (ลบบล็อก `GROUNDED_PRICE_KEYS` :304-314, `collectGroundedPrices` :316-334, `guardGrounding` :336-369 → import util; call sites :155, :197)

**Interfaces:**
- Consumes: ตรรกะเดิมทั้งดุ้นจาก `sales-bot.service.ts:304-369` (ห้ามเปลี่ยนพฤติกรรม: ข้ามเลข `< 1000`, ยอมรับ ±5%, `grounded.size === 0` + มีเลข = block)
  ⚠️ **ข้อยกเว้นเดียวที่ตั้งใจเปลี่ยน = regex** — ของเดิม `/([\d][\d,]{2,})\s*(?:บาท|฿|baht|THB)/gi` **จับยอดที่มีสตางค์ไม่ได้** (`'1,515.83 บาท'` → `[]`) ⇒ ยกมาเป็น `/([\d][\d,]{2,}(?:\.\d{1,2})?)\s*(?:บาท|฿|baht|THB)/gi` ตั้งแต่ Step 4 เพราะยอดฝั่งการเงินที่ Task 11 ต้องคุ้มมีสตางค์เกือบทั้งหมด. optional group ⇒ พฤติกรรมกับเลขกลมเท่าเดิม ⇒ `sales-bot.service.spec.ts` ยังเขียวโดยไม่แก้ (Step 7 เป็นตัวพิสูจน์)
- Produces:
```ts
// apps/api/src/utils/price-grounding.util.ts
/** คีย์ราคาของ "บอทขาย" — พูลแคบ ๆ ที่รีวิวมาแล้วว่าเป็นราคาสินค้าล้วน */
export const GROUNDED_PRICE_KEYS: ReadonlySet<string>;
/**
 * คีย์ของ "น้องเบส" = ชุดบอทขาย + คีย์เงินฝั่งการเงิน (Task 11)
 * แยกออกมาเพราะคีย์กว้าง ๆ อย่าง `amount` ต้องไม่ไปขยายพูลที่บอทขายยอมรับ
 * (`search_products` มีแถวราคาชื่อ `amount` ใน `prices[]`)
 */
export const FINANCE_GROUNDED_PRICE_KEYS: ReadonlySet<string>;
/** `keys` default = ชุดบอทขาย — ผู้เรียกฝั่งการเงินต้องส่ง `FINANCE_GROUNDED_PRICE_KEYS` เอง */
export function collectGroundedPrices(
  value: unknown,
  into: Set<number>,
  keys?: ReadonlySet<string>,
): void;
/** ดูดเลขบาทออกจากข้อความ (KB template ที่แอดมินเขียนเอง = ground truth) */
export function collectGroundedPricesFromText(text: string, into: Set<number>): void;
/**
 * ดูดเลขบาทจาก "ฟิลด์ที่เป็นข้อความแอดมินเขียนเอง" ในผลลัพธ์ tool
 * (list_promotions.name/description, search_knowledge_base.matches[].responseTemplate)
 * — เติมของจริงใน Task 6 (list_promotions) และ Task 8 (search_knowledge_base)
 * ต้องเป็น util เพราะ **บอททั้ง 2 ตัวมี tool ชื่อเดียวกันแต่คนละ pipeline**
 * (Task 6/8 = SalesBotService, Task 11 = FinanceAiService) — ห้าม copy-paste 2 ที่
 */
export function collectGroundedPricesFromToolText(
  toolName: string,
  result: unknown,
  into: Set<number>,
): void;
export type GroundingVerdict = { ok: true } | { ok: false; reason: string };
export function guardGrounding(reply: string, grounded: Set<number>): GroundingVerdict;
```
```ts
// apps/api/src/modules/sales-bot/__fixtures__/tool-results.fixture.ts
export const SEARCH_PRODUCTS_RESULT_FIXTURE: {...};      // shape ของ Task 3
export const CALCULATE_INSTALLMENT_RESULT_FIXTURE: {...}; // shape ของ Task 4
export const GET_INSTALLMENT_RATES_RESULT_FIXTURE: {...}; // shape เดิม (ไม่เปลี่ยนใน B3)
```

- [ ] **Step 1:** สร้าง fixture ที่เป็น "สัญญา" ของ shape ใหม่ — `apps/api/src/modules/sales-bot/__fixtures__/tool-results.fixture.ts`:

```ts
/**
 * B3 §5 — สัญญาของ shape ผลลัพธ์ tool หลังยกเครื่อง (Task 3 / Task 4)
 *
 * ไฟล์นี้ถูก import โดย:
 *  - `src/utils/price-grounding.util.spec.ts` (พิสูจน์ว่าทุกตัวเลขที่บอท quote ได้ ผ่าน guard)
 *  - `src/modules/sales-bot/tools/search-products.tool.spec.ts` (ผลจริงต้อง match shape นี้)
 *  - `src/modules/sales-bot/tools/calculate-installment.tool.spec.ts`
 *
 * แก้ shape ที่นี่ = ต้องแก้ `GROUNDED_PRICE_KEYS` ในย่อหน้าเดียวกันเสมอ (บทเรียน #1337)
 */

export const SEARCH_PRODUCTS_RESULT_FIXTURE = {
  query: { brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', color: null },
  totalMatches: 3,
  priceMissingCount: 1,
  groups: [
    {
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      storage: '256GB',
      condition: 'A',
      unitCount: 2,
      minPrice: 32900,
      maxPrice: 34900,
      units: [
        {
          id: 'prd-1',
          priceThb: 32900,
          installmentPriceThb: 35900,
          color: 'ดำ',
          batteryHealth: 92,
          shopWarrantyDays: 30,
          accessories: ['สายชาร์จ', 'กล่อง'],
          cosmeticNotes: 'มีรอยขนแมวที่ขอบซ้าย',
          branchName: 'ลาดพร้าว',
          photoAvailable: true,
          photoUrl: 'https://cdn.example.com/p1.jpg',
          webUrl: 'https://shop.example.com/products/prd-1',
          reserved: false,
        },
        {
          id: 'prd-2',
          priceThb: 34900,
          installmentPriceThb: null,
          color: 'ขาว',
          batteryHealth: 100,
          shopWarrantyDays: 30,
          accessories: null,
          cosmeticNotes: null,
          branchName: 'รังสิต',
          photoAvailable: false,
          photoUrl: null,
          webUrl: 'https://shop.example.com/products/prd-2',
          reserved: true,
          reservedNote: 'ติดจองชั่วคราว',
        },
      ],
    },
  ],
} as const;

export const CALCULATE_INSTALLMENT_RESULT_FIXTURE = {
  productId: 'prd-1',
  productName: 'iPhone 15 Pro Max 256GB',
  cashPriceThb: 32900,
  priceThb: 35900, // ฐานคิดผ่อน = installmentPrice (ไม่ใช่ราคาเงินสด)
  downPct: 20,
  downAmountThb: 7180,
  financedThb: 28720,
  tenureMonths: 12,
  ratePct: 30,
  monthlyThb: 3113,
  totalPaidThb: 44536,
  photoUrl: 'https://cdn.example.com/p1.jpg',
  webUrl: 'https://shop.example.com/products/prd-1',
} as const;

export const GET_INSTALLMENT_RATES_RESULT_FIXTURE = {
  templates: [
    {
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      storage: '256GB',
      hasWarranty: true,
      rate1: { downPayment: 4900, monthlyPrice: 2490, termMonths: 24 },
      rate2: { downPayment: 1900, monthlyPrice: 2690, termMonths: 12 },
    },
  ],
} as const;
```

- [ ] **Step 2:** เขียน spec ที่ล้มก่อน — `apps/api/src/utils/price-grounding.util.spec.ts`:

```ts
import {
  GROUNDED_PRICE_KEYS,
  collectGroundedPrices,
  collectGroundedPricesFromText,
  guardGrounding,
} from './price-grounding.util';
import {
  SEARCH_PRODUCTS_RESULT_FIXTURE,
  CALCULATE_INSTALLMENT_RESULT_FIXTURE,
  GET_INSTALLMENT_RATES_RESULT_FIXTURE,
} from '../modules/sales-bot/__fixtures__/tool-results.fixture';

describe('collectGroundedPrices — parity กับพฤติกรรมเดิมใน SalesBotService', () => {
  it('เก็บเฉพาะ key ที่อยู่ใน GROUNDED_PRICE_KEYS และเป็นเลข > 0', () => {
    const set = new Set<number>();
    collectGroundedPrices({ priceThb: 1000, notAPrice: 2000, monthly: 0, maxPrice: '3000' }, set);
    expect([...set].sort((a, b) => a - b)).toEqual([1000, 3000]);
  });

  it('เดินลง array + object ซ้อนได้', () => {
    const set = new Set<number>();
    collectGroundedPrices({ a: [{ b: { priceThb: 14691 } }] }, set);
    expect(set.has(14691)).toBe(true);
  });

  it('null/undefined ไม่ throw', () => {
    const set = new Set<number>();
    expect(() => collectGroundedPrices(null, set)).not.toThrow();
    expect(() => collectGroundedPrices(undefined, set)).not.toThrow();
    expect(set.size).toBe(0);
  });
});

describe('shape ใหม่ของ tool ต้องผ่าน guard (definition-of-done B3)', () => {
  it('ทุกตัวเลขราคาใน search_products fixture ถูกเก็บเป็น grounded', () => {
    const set = new Set<number>();
    collectGroundedPrices(SEARCH_PRODUCTS_RESULT_FIXTURE, set);
    // ราคาต่อเครื่อง + ราคาผ่อนต่อเครื่อง + ช่วงราคาของกลุ่ม
    expect(set.has(32900)).toBe(true);
    expect(set.has(34900)).toBe(true);
    expect(set.has(35900)).toBe(true); // installmentPriceThb — key ใหม่
  });

  it('บอท quote ราคาจาก search_products ได้โดยไม่โดน block', () => {
    const set = new Set<number>();
    collectGroundedPrices(SEARCH_PRODUCTS_RESULT_FIXTURE, set);
    expect(
      guardGrounding('iPhone 15 Pro Max 256GB สภาพ A ราคา 32,900 บาทค่ะ ผ่อนคิดจาก 35,900 บาท', set),
    ).toEqual({ ok: true });
  });

  it('ทุกตัวเลขใน calculate_installment fixture ถูกเก็บเป็น grounded (รวม financed/cash)', () => {
    const set = new Set<number>();
    collectGroundedPrices(CALCULATE_INSTALLMENT_RESULT_FIXTURE, set);
    for (const n of [32900, 35900, 7180, 28720, 3113, 44536]) {
      expect(set.has(n)).toBe(true);
    }
  });

  it('บอท quote ค่างวด/ดาวน์/ยอดรวมจาก calculate_installment ได้โดยไม่โดน block', () => {
    const set = new Set<number>();
    collectGroundedPrices(CALCULATE_INSTALLMENT_RESULT_FIXTURE, set);
    expect(
      guardGrounding(
        'ดาวน์ 7,180 บาท ผ่อนเดือนละ 3,113 บาท 12 งวด รวมทั้งสัญญา 44,536 บาทค่ะ',
        set,
      ),
    ).toEqual({ ok: true });
  });

  it('get_installment_rates (shape เดิม) ยังผ่านเหมือนเดิม — ไม่ regress #1337', () => {
    const set = new Set<number>();
    collectGroundedPrices(GET_INSTALLMENT_RATES_RESULT_FIXTURE, set);
    expect(guardGrounding('ดาวน์ 4,900 บาท ผ่อนเดือนละ 2,490 บาทค่ะ', set)).toEqual({ ok: true });
  });
});

describe('guardGrounding — กฎเดิมต้องไม่หย่อนลง', () => {
  it('ไม่มีเลขบาทในคำตอบ → ผ่าน', () => {
    expect(guardGrounding('สวัสดีค่ะ สนใจรุ่นไหนคะ', new Set())).toEqual({ ok: true });
  });

  it('มีเลขบาทแต่ไม่มี tool result เลย → block', () => {
    const v = guardGrounding('ราคา 7,000 บาทค่ะ', new Set());
    expect(v).toEqual({ ok: false, reason: 'price-mentioned-no-tool-result' });
  });

  it('เลขที่ไม่มีใน grounded → block พร้อมบอกเลขที่ผิด', () => {
    const v = guardGrounding('ราคา 7,000 บาทค่ะ', new Set([32900]));
    expect(v).toEqual({ ok: false, reason: 'unmatched-price=7000' });
  });

  it('คลาดจาก grounded ไม่เกิน 5% → ผ่าน', () => {
    expect(guardGrounding('ประมาณ 14,700 บาทค่ะ', new Set([14691]))).toEqual({ ok: true });
  });

  it('เลข < 1000 ถูกข้าม (ค่าปรับ/วัน/เปอร์เซ็นต์)', () => {
    expect(guardGrounding('ค่าปรับ 50 บาท/วันค่ะ', new Set([32900]))).toEqual({ ok: true });
  });

  // ── regression: regex เดิมมองไม่เห็นยอดที่มีสตางค์ → guard เป็น no-op ──
  // ยอดจริงตาม CPA rounding มีสตางค์เกือบทั้งหมด (1,416.66 + 99.17 = 1,515.83)
  // ถ้า 3 เคสนี้ผ่านเพราะ "ไม่ match" แปลว่า regex ยังเป็นตัวเก่า — ให้ดู Step 4
  it('ยอดที่มีสตางค์และตรงกับ grounded → ผ่าน', () => {
    expect(guardGrounding('ยอดของคุณคือ 1,515.83 บาทค่ะ', new Set([1515.83]))).toEqual({
      ok: true,
    });
  });

  it('ยอดที่มีสตางค์แต่โมเดลแต่งเอง → block (เคสที่ regex เดิมปล่อยผ่าน 100%)', () => {
    expect(guardGrounding('ยอดของคุณคือ 99,999.50 บาทค่ะ', new Set([1515.83]))).toEqual({
      ok: false,
      reason: 'unmatched-price=99999.5',
    });
  });

  it('ยอดกลม .00 ที่ไม่มีใน grounded ก็ต้องโดน block', () => {
    expect(guardGrounding('ยอด 99,999.00 บาท', new Set([13642.51]))).toEqual({
      ok: false,
      reason: 'unmatched-price=99999',
    });
  });
});

describe('collectGroundedPricesFromText — KB ที่แอดมินเขียนเองคือ ground truth', () => {
  it('ดูดเลขบาทออกจาก template ของ KB', () => {
    const set = new Set<number>();
    collectGroundedPricesFromText('ค่ามัดจำเครื่อง 3,000 บาท คืนเมื่อรับเครื่อง', set);
    expect(set.has(3000)).toBe(true);
  });

  it('ข้ามเลข < 1000 เหมือน guard', () => {
    const set = new Set<number>();
    collectGroundedPricesFromText('ค่าปรับ 50 บาท/วัน', set);
    expect(set.size).toBe(0);
  });

  it('ดูดยอดที่มีสตางค์ได้ (regex ต้องรองรับทศนิยม)', () => {
    const set = new Set<number>();
    collectGroundedPricesFromText('งวดละ 1,515.83 บาท', set);
    expect(set.has(1515.83)).toBe(true);
  });
});
```

- [ ] **Step 3:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/price-grounding.util.spec.ts` → `Cannot find module './price-grounding.util'`
- [ ] **Step 4:** implement — `apps/api/src/utils/price-grounding.util.ts` (ยกโค้ดจาก `sales-bot.service.ts:292-369` มาแบบพฤติกรรมเดียวกัน + เพิ่ม 3 key ใหม่ + ฟังก์ชัน text):

```ts
/**
 * B3 §5 — กฎ grounding เดียวของทั้งระบบบอท
 *
 * ยกมาจาก `modules/sales-bot/sales-bot.service.ts:292-369` (พฤติกรรมเดิมทุกข้อ)
 * เพื่อให้ `FinanceAiService` (น้องเบส — คนละ pipeline, ไม่ผ่าน MessageRouter)
 * ใช้ backstop ตัวเดียวกันได้ โดยไม่ต้อง import module ข้ามกัน
 *
 * ประวัติที่ต้องไม่ลืม:
 *  - #1064: Gemini 2.5 เมิน persona rule แล้วตอบ "iPhone 15 7,000 บาท" ทั้งที่ tool
 *    คืนแค่ iPhone 13/16 → ต้องมี backstop ที่ไม่ขึ้นกับพฤติกรรมโมเดล
 *  - #1337: เพิ่ม key ของ get_installment_rates/calculate_installment ทีหลัง เพราะ
 *    เปลี่ยน shape แล้วลืม → บอทโดน block เงียบ ๆ
 *  - B3: เพิ่ม installmentPriceThb / cashPriceThb / financedThb จาก shape ใหม่
 */

export const GROUNDED_PRICE_KEYS: ReadonlySet<string> = new Set([
  // ชุดเดิม (search_products et al.)
  'priceThb',
  'monthly',
  'minPrice',
  'maxPrice',
  // #1337 — get_installment_rates v2 (PricingTemplate เป็นบาทจริง)
  'downPayment',
  'monthlyPrice',
  // #1337 reviewer fix — ผลคำนวณของ calculate_installment
  'downAmountThb',
  'monthlyThb',
  'totalPaidThb',
  // B3 — shape ใหม่: ราคาผ่อนต่อเครื่อง / ราคาเงินสดอ้างอิง / ยอดจัด
  'installmentPriceThb',
  'cashPriceThb',
  'financedThb',
]);

/** ราคาที่ต่ำกว่านี้ถูกมองว่าเป็นค่าปรับ/วัน/เปอร์เซ็นต์ — เสี่ยง false-positive เกินไป */
const MIN_GROUNDED_THB = 1000;

/**
 * ⚠️ **แก้บั๊กของเดิม (ห้าม copy regex เก่ามา)** — ตัวเดิมใน `sales-bot.service.ts:351`
 * คือ `/([\d][\d,]{2,})\s*(?:บาท|฿|baht|THB)/gi` ซึ่ง **จับยอดที่มีสตางค์ไม่ได้เลย**
 * เพราะ `.` ไม่อยู่ใน character class → match ขาดที่จุดทศนิยม แล้วเศษ (`83`) สั้นกว่า `{2,}`
 * พิสูจน์แล้วด้วย node: `'ยอด 1,515.83 บาท'` → `[]`, `'ยอดรวม 13,642.51 บาท'` → `[]`,
 * `'ยอด 99,999.00 บาท'` → `[]` (จับได้เฉพาะเลขกลมอย่าง `32,900`)
 *
 * ผลกระทบ: ยอดจริงฝั่งการเงินมีสตางค์เกือบทั้งหมดตาม CPA rounding
 * (`.claude/rules/accounting.md` — 1,416.66 + 99.17 = 1,515.83) ⇒ ถ้าใช้ regex เดิม
 * guard ของน้องเบส (Task 11) จะเป็น **no-op**: โมเดลแต่งยอด `99,999.00 บาท` ผ่านฉลุย
 * ขณะที่ทีมเชื่อว่ามี backstop แล้ว
 *
 * กลุ่มทศนิยม `(?:\.\d{1,2})?` เป็น optional ⇒ พฤติกรรมกับเลขกลมเหมือนเดิมทุกประการ
 * (ตรวจแล้ว: `sales-bot.service.spec.ts` ไม่มีเลขทศนิยมก่อน "บาท" เลยสักเคส
 * — บรรทัด 100/259/297/374-375/415/447/491 เป็นเลขกลมล้วน → suite เดิมยังเขียว)
 * และ `Number(m[1].replace(/,/g, ''))` ยังใช้ได้เหมือนเดิม (parse '1,515.83' → 1515.83)
 */
const PRICE_IN_TEXT_RE = /([\d][\d,]{2,}(?:\.\d{1,2})?)\s*(?:บาท|฿|baht|THB)/gi;

/**
 * `keys` เป็นพารามิเตอร์ (default = ชุดบอทขาย) ไม่ใช่ค่าคงที่ตัวเดียวที่บอท 2 ตัวใช้ร่วม
 * — คีย์ที่ Task 11 ต้องใช้ฝั่งการเงิน (`amount`, `totalAmount`, …) กว้างเกินกว่าจะปล่อยให้
 * ไปขยายพูลที่บอทขายยอมรับโดยไม่มีใครรีวิว (`search_products` select แถวราคาชื่อ `amount`)
 */
export function collectGroundedPrices(
  value: unknown,
  into: Set<number>,
  keys: ReadonlySet<string> = GROUNDED_PRICE_KEYS,
): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) collectGroundedPrices(v, into, keys);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(k) && v != null) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) into.add(n);
      }
      collectGroundedPrices(v, into, keys);
    }
  }
}

/**
 * ดูดเลขบาทออกจากข้อความอิสระ — ใช้กับผลลัพธ์ที่เป็น "ข้อความที่แอดมินเขียนเอง"
 * (KB responseTemplate) ซึ่งเป็น ground truth ไม่ใช่การเดาของโมเดล ถ้าไม่ทำ
 * KB ที่เขียนว่า "ค่ามัดจำ 3,000 บาท" จะทำให้บอทโดน block ทันทีที่พูดตาม
 */
export function collectGroundedPricesFromText(text: string, into: Set<number>): void {
  if (!text) return;
  for (const m of text.matchAll(PRICE_IN_TEXT_RE)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n >= MIN_GROUNDED_THB) into.add(n);
  }
}

export type GroundingVerdict = { ok: true } | { ok: false; reason: string };

export function guardGrounding(reply: string, grounded: Set<number>): GroundingVerdict {
  const matches = [...reply.matchAll(PRICE_IN_TEXT_RE)];
  if (matches.length === 0) return { ok: true };

  if (grounded.size === 0) {
    return { ok: false, reason: 'price-mentioned-no-tool-result' };
  }

  for (const m of matches) {
    const num = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(num) || num < MIN_GROUNDED_THB) continue;
    const closeMatch = [...grounded].some((g) => Math.abs(g - num) / g <= 0.05);
    if (!closeMatch) {
      return { ok: false, reason: `unmatched-price=${num}` };
    }
  }
  return { ok: true };
}
```

> ⚠️ `PRICE_IN_TEXT_RE` มี flag `g` — `matchAll` ไม่กิน `lastIndex` เหมือน `exec` แต่ **ห้ามใช้ `.test()` กับ regex ตัวนี้** (stateful) โค้ดข้างบนใช้ `matchAll` อย่างเดียวจึงปลอดภัย

- [ ] **Step 5:** รันให้ผ่าน: `cd apps/api && npx jest src/utils/price-grounding.util.spec.ts` → เขียวทุกเคส
- [ ] **Step 6:** re-point `SalesBotService` มาใช้ util — ใน `apps/api/src/modules/sales-bot/sales-bot.service.ts`:
  - เพิ่ม import: `import { collectGroundedPrices, guardGrounding } from '../../utils/price-grounding.util';`
  - **ลบ** `private static readonly GROUNDED_PRICE_KEYS` (:304-314), `private collectGroundedPrices` (:319-334), `private guardGrounding` (:345-369) พร้อมคอมเมนต์ประกอบ
  - เปลี่ยน call site :155 `const grounding = this.guardGrounding(resp.text, groundedPrices);` → `const grounding = guardGrounding(resp.text, groundedPrices);`
  - เปลี่ยน call site :197 `this.collectGroundedPrices(result, groundedPrices);` → `collectGroundedPrices(result, groundedPrices);`
- [ ] **Step 7:** พิสูจน์ว่าไม่ regress: `cd apps/api && npx jest src/modules/sales-bot/sales-bot.service.spec.ts` → **เขียวครบโดยไม่แก้ spec แม้แต่บรรทัดเดียว** (ถ้าแดง = ยก util ผิด ให้ย้อนดู diff ไม่ใช่แก้ spec)
- [ ] **Step 8:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/utils/price-grounding.util.ts src/modules/sales-bot/sales-bot.service.ts` → ไม่มี error ใหม่
- [ ] **Step 9:** Commit: `refactor(bot): ยกกฎ grounding เป็น util กลาง + ปักหมุด shape ผลลัพธ์ tool ใหม่ (B3 Task 1)`

---

### Task 2: `SalesBotResult.attachments` — ช่องส่งรูป/ลิงก์ออกจากบอท (เติมแบบ deterministic ห้ามให้โมเดลแต่ง)

> spec §0 ระบุว่า `SalesBotResult` วันนี้ **ไม่มีช่องทางส่ง productId/รูป/ลิงก์ออกมาเลย** (`sales-bot.service.ts:30-37`) — Task นี้เปิดช่องนั้นก่อน แล้ว Task 3/4 ค่อยเติมข้อมูลจริง, Task 9 ค่อยส่งจริง

**Files:**
- Create: `apps/api/src/utils/bot-attachments.util.ts` — **ต้องเป็น util ตั้งแต่แรก** เพราะน้องเบส (Task 12) ใช้กติกาเดียวกันและอยู่คนละ pipeline
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.ts` (`SalesBotResult` :30-37, `generateReply` :126-238, `runTool` :240-274)
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` (เพิ่ม describe ใหม่ — ไม่แก้เคสเดิม)

> ⚠️ **ตำแหน่งที่วาง describe ใหม่ (ทุก Task ที่แตะไฟล์นี้: 2 / 6 / 8)**: helper `build()` ถูกประกาศ **ข้างใน** `describe('SalesBotService', ...)` (`sales-bot.service.spec.ts:17-64`) และ describe นั้นปิดที่บรรทัดสุดท้ายของไฟล์ (`:587 });`) → ต้องแทรก describe ใหม่ **ก่อน** `});` บรรทัดสุดท้าย ห้ามต่อท้ายไฟล์จริง ๆ ไม่งั้น `build is not defined`

**Interfaces:**
- Consumes: `shopBaseUrl(): string | null` จาก `apps/api/src/utils/shop-base-url.util.ts:10` (มีอยู่แล้ว, ตัด trailing slash ให้) — ใช้ใน Task 3/4 ตอนสร้าง `webUrl` ของแต่ละ unit
- Produces:
```ts
// apps/api/src/utils/bot-attachments.util.ts
export interface BotAttachment {
  productId: string;
  imageUrl?: string;   // gallery[0] — public HTTPS เท่านั้น (ห้าม photos[] ที่เป็น base64)
  webUrl?: string;     // `${SHOP_BASE_URL}/products/:id` — null เมื่อ env ไม่ได้ตั้ง
}
export const MAX_BOT_ATTACHMENTS = 2;
export function collectAttachmentsFromToolResult(
  toolName: string,
  result: unknown,
  into: Map<string, BotAttachment>,
): void;
```
```ts
// apps/api/src/modules/sales-bot/sales-bot.service.ts
export type SalesBotAttachment = BotAttachment;   // re-export ชื่อเดิมไว้ให้ผู้เรียกอ่านง่าย
export interface SalesBotResult {
  reply: string;
  confidence: number;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  attachments?: SalesBotAttachment[];   // ← ใหม่ (optional = ผู้เรียกเดิมไม่พัง)
}
```

**กติกาการแนบ (deterministic — ห้ามอ่านจากข้อความที่โมเดลเขียน):**
1. เก็บจาก **ผลลัพธ์ tool** เท่านั้น ใน `runTool` loop (จุดเดียวกับที่เรียก `collectGroundedPrices`)
2. `search_products` → แนบเมื่อ **เจาะจง**: จำนวน unit รวมทุกกลุ่ม ≤ 2 เท่านั้น (ถามกว้าง = ไม่ยิงรูปรัว)
3. `calculate_installment` → แนบเครื่องที่คำนวณให้ (1 ตัว)
4. ต้องมี `imageUrl` หรือ `webUrl` อย่างน้อย 1 อย่าง ไม่งั้นไม่แนบ
5. dedupe ด้วย `productId`, ตัดที่ `MAX_BOT_ATTACHMENTS = 2`
6. คืน `attachments` เฉพาะ **ทางออกที่ผ่าน guard** (`resp.toolCalls.length === 0 && grounding.ok`) — ทาง handoff/blocked ไม่แนบ

- [ ] **Step 1:** เขียนเทสต์ที่ล้มก่อน — แทรก **ก่อน `});` บรรทัดสุดท้าย** ของ `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` (ต้องอยู่ในขอบเขตของ `build()`):

```ts
describe('SalesBotResult.attachments (B3 §5)', () => {
  const searchResultOneUnit = {
    query: { brand: 'Apple', model: 'iPhone 15', storage: null, color: null },
    totalMatches: 1,
    priceMissingCount: 0,
    groups: [
      {
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '128GB',
        condition: 'NEW',
        unitCount: 1,
        minPrice: 28900,
        maxPrice: 28900,
        units: [
          {
            id: 'prd-1',
            priceThb: 28900,
            photoAvailable: true,
            photoUrl: 'https://cdn.example.com/p1.jpg',
            webUrl: 'https://shop.example.com/products/prd-1',
            reserved: false,
          },
        ],
      },
    ],
  };

  const twoHopChat = (toolName: string, finalText: string) =>
    jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: toolName, input: { query: 'iPhone 15' } }],
        inputTokens: 10,
        outputTokens: 5,
        modelName: 'claude-sonnet-4-6',
      })
      .mockResolvedValueOnce({
        text: finalText,
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 5,
        modelName: 'claude-sonnet-4-6',
      });

  it('แนบรูป+ลิงก์เมื่อ search_products ให้ผลเจาะจงเครื่องเดียว', async () => {
    const chat = twoHopChat('search_products', 'iPhone 15 128GB ราคา 28,900 บาทค่ะ');
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue(searchResultOneUnit);

    const r = await svc.generateReply({ text: 'iPhone 15 มีไหม', roomId: 'r1', customerId: null });
    expect(r.attachments).toEqual([
      {
        productId: 'prd-1',
        imageUrl: 'https://cdn.example.com/p1.jpg',
        webUrl: 'https://shop.example.com/products/prd-1',
      },
    ]);
  });

  it('ผลกว้าง (เกิน 2 เครื่อง) → ไม่แนบอะไรเลย', async () => {
    const many = {
      ...searchResultOneUnit,
      totalMatches: 3,
      groups: [
        {
          ...searchResultOneUnit.groups[0],
          unitCount: 3,
          units: [
            { id: 'a', priceThb: 1, photoUrl: 'https://c/a.jpg', webUrl: 'https://s/a', reserved: false },
            { id: 'b', priceThb: 2, photoUrl: 'https://c/b.jpg', webUrl: 'https://s/b', reserved: false },
            { id: 'c', priceThb: 3, photoUrl: 'https://c/c.jpg', webUrl: 'https://s/c', reserved: false },
          ],
        },
      ],
    };
    const chat = twoHopChat('search_products', 'มีหลายเครื่องเลยค่ะ');
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue(many);

    const r = await svc.generateReply({ text: 'มีอะไรบ้าง', roomId: 'r1', customerId: null });
    expect(r.attachments).toBeUndefined();
  });

  it('เครื่องไม่มีรูปแต่มีลิงก์ → ยังแนบ (imageUrl หายไปเฉย ๆ)', async () => {
    const noPhoto = {
      ...searchResultOneUnit,
      groups: [
        {
          ...searchResultOneUnit.groups[0],
          units: [
            {
              id: 'prd-9',
              priceThb: 28900,
              photoAvailable: false,
              photoUrl: null,
              webUrl: 'https://shop.example.com/products/prd-9',
              reserved: false,
            },
          ],
        },
      ],
    };
    const chat = twoHopChat('search_products', 'มีค่ะ ราคา 28,900 บาท');
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue(noPhoto);

    const r = await svc.generateReply({ text: 'iPhone 15', roomId: 'r1', customerId: null });
    expect(r.attachments).toEqual([
      { productId: 'prd-9', webUrl: 'https://shop.example.com/products/prd-9' },
    ]);
  });

  it('calculate_installment แนบเครื่องที่คำนวณให้', async () => {
    const chat = twoHopChat('calculate_installment', 'ผ่อนเดือนละ 3,113 บาทค่ะ');
    const { svc, calcInstallment } = await build(chat);
    calcInstallment.run.mockResolvedValue({
      productId: 'prd-5',
      productName: 'iPhone 15',
      monthlyThb: 3113,
      photoUrl: 'https://cdn.example.com/p5.jpg',
      webUrl: 'https://shop.example.com/products/prd-5',
    });

    const r = await svc.generateReply({ text: 'ผ่อน 12 งวด', roomId: 'r1', customerId: null });
    expect(r.attachments?.[0].productId).toBe('prd-5');
  });

  it('คำตอบที่โดน grounding block → ไม่แนบอะไรเลย', async () => {
    const chat = twoHopChat('search_products', 'ราคาเริ่มต้น 7,000 บาทค่ะ'); // ไม่ตรง grounded
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue(searchResultOneUnit);

    const r = await svc.generateReply({ text: 'iPhone 15', roomId: 'r1', customerId: null });
    expect(r.confidence).toBe(0.3);
    expect(r.attachments).toBeUndefined();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/sales-bot/sales-bot.service.spec.ts -t "attachments"` → เคสใหม่แดง (`attachments` undefined ทุกเคส)
- [ ] **Step 3:** implement util — `apps/api/src/utils/bot-attachments.util.ts`:

```ts
/**
 * B3 §5 — เก็บ "รูป+ลิงก์สินค้า" จากผลลัพธ์ tool แบบ deterministic
 *
 * เป็น util ไม่ใช่ private method เพราะบอท 2 ตัวอยู่คนละ pipeline
 * (SalesBotService ผ่าน MessageRouter / FinanceAiService ไม่ผ่าน) แต่ต้องใช้
 * "กติกาการแนบ" ชุดเดียวกัน
 *
 * ⚠️ ห้ามอ่าน productId/URL จากข้อความที่โมเดลเขียน — โมเดลแต่ง id ได้ และ
 * เราจะกลายเป็นคนส่งรูปผิดเครื่องให้ลูกค้า
 */

export interface BotAttachment {
  productId: string;
  imageUrl?: string;
  webUrl?: string;
}

/** ส่งได้มากสุด 2 ใบต่อ 1 คำตอบ — LINE reply รับ 5 ข้อความ/ครั้ง เหลือที่ให้ text + เผื่อ */
export const MAX_BOT_ATTACHMENTS = 2;

export function collectAttachmentsFromToolResult(
  toolName: string,
  result: unknown,
  into: Map<string, BotAttachment>,
): void {
    if (result == null || typeof result !== 'object') return;

    const push = (u: { id?: unknown; photoUrl?: unknown; webUrl?: unknown }) => {
      const productId = typeof u.id === 'string' ? u.id : null;
      if (!productId || into.has(productId)) return;
      const imageUrl = typeof u.photoUrl === 'string' && u.photoUrl ? u.photoUrl : undefined;
      const webUrl = typeof u.webUrl === 'string' && u.webUrl ? u.webUrl : undefined;
      if (!imageUrl && !webUrl) return;
      if (into.size >= MAX_BOT_ATTACHMENTS) return;
      into.set(productId, { productId, ...(imageUrl ? { imageUrl } : {}), ...(webUrl ? { webUrl } : {}) });
    };

    if (toolName === 'search_products') {
      const groups = (result as { groups?: unknown }).groups;
      if (!Array.isArray(groups)) return;
      const units = groups.flatMap((g) =>
        Array.isArray((g as { units?: unknown }).units) ? (g as { units: unknown[] }).units : [],
      );
      if (units.length === 0 || units.length > MAX_BOT_ATTACHMENTS) return;
      for (const u of units) push(u as Record<string, unknown>);
      return;
    }

    if (toolName === 'calculate_installment') {
      const r = result as { productId?: unknown; photoUrl?: unknown; webUrl?: unknown };
      push({ id: r.productId, photoUrl: r.photoUrl, webUrl: r.webUrl });
    }
}
```

- [ ] **Step 4:** ต่อ util เข้า `apps/api/src/modules/sales-bot/sales-bot.service.ts`:
  - เพิ่ม import:
```ts
import {
  collectAttachmentsFromToolResult,
  MAX_BOT_ATTACHMENTS,
  type BotAttachment,
} from '../../utils/bot-attachments.util';
```
  - เพิ่มใต้ `SalesBotResult`: `export type SalesBotAttachment = BotAttachment;` และเพิ่มฟิลด์ `attachments?: SalesBotAttachment[];` ใน interface
  - ใน `generateReply` ประกาศถังเก็บถัดจาก `const groundedPrices = new Set<number>();`:
```ts
    // ช่องส่งรูป/ลิงก์ — เติมจาก "ผลลัพธ์ tool" เท่านั้น (deterministic)
    const attachments = new Map<string, BotAttachment>();
```
  - ใน tool loop ต่อจาก `collectGroundedPrices(result, groundedPrices);` เพิ่ม
    `collectAttachmentsFromToolResult(tc.name, result, attachments);`
  - ในทางออกที่ผ่าน guard (บล็อก `return { reply: resp.text, ... }` ราวบรรทัด 171-178) เพิ่มฟิลด์:
```ts
            ...(attachments.size > 0
              ? { attachments: [...attachments.values()].slice(0, MAX_BOT_ATTACHMENTS) }
              : {}),
```
  - **ห้ามใส่** `attachments` ในทางออก blocked (:161-168) และทางออก max-hop (:218-225)
- [ ] **Step 5:** รันผ่าน: `cd apps/api && npx jest src/modules/sales-bot/sales-bot.service.spec.ts` → เขียวทั้งไฟล์ (เคสเดิม + 5 เคสใหม่)
- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/utils/bot-attachments.util.ts src/modules/sales-bot/sales-bot.service.ts` → ไม่มี error ใหม่
- [ ] **Step 7:** Commit: `feat(bot): เพิ่ม attachments ใน SalesBotResult (รูป+ลิงก์สินค้า เติมจากผล tool เท่านั้น) (B3 Task 2)`

---

### Task 3: `search_products` ยกเครื่อง — parse ไทย + widen select + จัดกลุ่มรุ่น/ความจุ/สภาพ + RESERVED + ราคาคอลัมน์

> ⚠️ `search-products.tool.ts` วันนี้ **ไม่มี spec เลย** — Task นี้จึงต้องสร้าง spec ใหม่ทั้งไฟล์
> ⚠️ fixture จาก Task 1 คือ **สัญญาของ key** (ชื่อฟิลด์) ไม่ใช่ golden เลขคณิต — spec ของ tool ยืนยันค่าจริงเอง

**Files:**
- Modify: `apps/api/src/modules/sales-bot/tools/search-products.tool.ts` (ทั้งไฟล์ — 91 บรรทัดเดิมถูกแทน)
- Create: `apps/api/src/modules/sales-bot/tools/search-products.tool.spec.ts`

**Interfaces:**
- Consumes:
  - `parseDeviceQuery(utterance: string): { brand: string|null; model: string|null; storage: string|null; color: string|null; rest: string }` — `apps/api/src/utils/device-query-normalize.util.ts` (**ของ B0 Task 3**)
  - `normalizeStorage(storage: string|null|undefined): string` — ไฟล์เดียวกัน
  - `DEMO_NAME_PREFIX = '[DEMO]'` — `apps/api/src/utils/product-readiness.util.ts` (**ของ B0 Task 10**)
  - `shopBaseUrl(): string | null` — `apps/api/src/utils/shop-base-url.util.ts:10`
  - คอลัมน์ที่ B0 เพิ่ม: `Product.accessoriesIncluded (Json?)`, `Product.cosmeticNotes (String?)`; `Product.conditionGrade` ที่มี writer จริงแล้ว (B0 Task 13)
- Produces: ผลลัพธ์ตาม `SEARCH_PRODUCTS_RESULT_FIXTURE` (Task 1) — `{ query, totalMatches, priceMissingCount, groups[] }`

**การตัดสินใจที่ต้องคงไว้ (spec §0/§5):**
- **ไม่บังคับรูป** — ของจริงส่วนใหญ่ยังไม่มี `gallery` การบังคับจะซ่อนสต็อกที่ขายได้จริงออกจากแชท; บอกความจริงผ่าน `photoAvailable` ต่อเครื่องแทน
- **บังคับ `cashPrice > 0` แต่ไม่ทิ้งข้อมูลว่ามีของ** — เครื่องที่ match แต่ไม่มีราคา **ไม่เข้า `groups`** และถูกนับใน `priceMissingCount` → persona เดิม ("ไม่มีข้อมูลราคา → ส่งต่อ/ตอบเรทกลาง") + flow #1332 (`get_installment_rates` แล้ว flag staff ที่ `message-router.service.ts:212-234`) ทำงานเหมือนเดิมทุกประการ
  📌 **หมายเหตุ: นี่คือการเบี่ยงจากถ้อยคำ spec §5 โดยตั้งใจ** — §5 (บรรทัด 117 ของ spec) เขียนว่า "**ไม่กรอง `cashPrice` ที่ query**" ส่วนแผนนี้ **ไม่กรองที่ query จริงตามนั้น** (ต้องอ่านมาให้ครบถึงจะนับ `priceMissingCount` ได้) แต่ **กรองตอนจัดกลุ่ม** = เครื่องไม่มีราคาไม่ถูกยกไปให้โมเดลเห็นเป็น "ของที่ quote ได้"
  เหตุผลตาม §0: จุดประสงค์ของถ้อยคำ §5 คือ "ห้ามทำให้เครื่องที่ยังไม่มีราคาหายไปจากแชท" (คอมเมนต์ในโค้ดจริง `search-products.tool.ts:57-61` — การตัดออกที่ query "would have nuked all bot quotes") ซึ่งแผนนี้รักษาไว้ครบผ่าน `priceMissingCount` → handoff/#1332
  ถ้าปล่อยเครื่องไม่มีราคาเข้า `groups` ด้วย จะเกิดผลข้างเคียงที่ §5 ไม่ได้ตั้งใจ: `minPrice`/`maxPrice` ของกลุ่มเพี้ยน (ต้องนับ `null` เป็น 0 หรือข้าม) และ `GROUNDED_PRICE_KEYS` จะไม่มีเลขให้ยึด ⇒ โมเดลเห็นเครื่องแต่ quote ไม่ได้ = โดน guard block เงียบ ๆ (อาการ #1337) แทนที่จะ handoff อย่างที่ควร
- **PHONE_USED ต้องมีเกรด** — กันบอทเสนอมือสองที่ยังไม่ผ่าน QC
- **รวม `RESERVED`** ติดธง `reserved: true` + `reservedNote: 'ติดจองชั่วคราว'` — ลูกค้าถามแล้วต้องรู้ว่ามีของแต่ติดจอง ไม่ใช่ "ไม่มี"
- **ราคาอ่านจากคอลัมน์** `cashPrice`/`installmentPrice` (`prices[]` เลิกใช้ในเส้นทางบอท — spec §1 ข้อ 1)
- **`[DEMO]` ถูกกรองทิ้ง** ด้วย `DEMO_NAME_PREFIX` (ไม่ผูก `NODE_ENV` — ตรงกับ B0)
- **ไม่ผูก brand gate แบบเว็บ** (เว็บขายเฉพาะ iPhone ตาม #1368) — บอทตอบสต็อกที่มีจริงทั้งหมด นี่คือความหมายของ "หลวมกว่าเว็บ"

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — `apps/api/src/modules/sales-bot/tools/search-products.tool.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SearchProductsTool } from './search-products.tool';

const D = (v: string) => new Prisma.Decimal(v);

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'prd-1',
  name: 'iPhone 15 Pro Max 256GB',
  brand: 'Apple',
  model: 'iPhone 15 Pro Max',
  storage: '256GB',
  color: 'ดำ',
  category: 'PHONE_USED',
  status: 'IN_STOCK',
  conditionGrade: 'A',
  cashPrice: D('32900'),
  installmentPrice: D('35900'),
  batteryHealth: 92,
  shopWarrantyDays: 30,
  accessoriesIncluded: ['สายชาร์จ', 'กล่อง'],
  cosmeticNotes: 'มีรอยขนแมวที่ขอบซ้าย',
  gallery: ['https://cdn.example.com/p1.jpg'],
  branch: { name: 'ลาดพร้าว' },
  ...over,
});

const makePrisma = (rows: unknown[]) =>
  ({ product: { findMany: jest.fn().mockResolvedValue(rows) } }) as unknown as PrismaService;

describe('SearchProductsTool.run', () => {
  const prevBase = process.env.SHOP_BASE_URL;
  beforeEach(() => {
    process.env.SHOP_BASE_URL = 'https://shop.example.com';
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.SHOP_BASE_URL;
    else process.env.SHOP_BASE_URL = prevBase;
  });

  it('คืนคีย์ครบตามสัญญา (query/totalMatches/priceMissingCount/groups)', async () => {
    const tool = new SearchProductsTool(makePrisma([row()]));
    const r = await tool.run({ query: 'ไอโฟน 15 โปรแม็กซ์ 256gb' });
    expect(Object.keys(r).sort()).toEqual(
      ['groups', 'priceMissingCount', 'query', 'totalMatches'].sort(),
    );
  });

  it('parse คำไทยเป็น brand/model/storage แล้วส่งกลับใน query', async () => {
    const tool = new SearchProductsTool(makePrisma([row()]));
    const r = await tool.run({ query: 'ไอโฟน 15 โปรแม็กซ์ 256gb สีดำ' });
    expect(r.query).toEqual({
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      storage: '256GB',
      color: 'ดำ',
    });
  });

  it('จัดกลุ่มตาม รุ่น+ความจุ+สภาพ พร้อม count และช่วงราคา', async () => {
    const tool = new SearchProductsTool(
      makePrisma([
        row({ id: 'a', cashPrice: D('32900') }),
        row({ id: 'b', cashPrice: D('34900'), color: 'ขาว' }),
        row({ id: 'c', cashPrice: D('30900'), conditionGrade: 'B' }),
      ]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    const gradeA = r.groups.find((g) => g.condition === 'A')!;
    expect(gradeA.unitCount).toBe(2);
    expect(gradeA.minPrice).toBe(32900);
    expect(gradeA.maxPrice).toBe(34900);
    expect(r.groups.find((g) => g.condition === 'B')!.unitCount).toBe(1);
  });

  it('เครื่องใหม่ (ไม่มีเกรด) แสดง condition = NEW', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ category: 'PHONE_NEW', conditionGrade: null })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].condition).toBe('NEW');
  });

  it('ส่งรายละเอียดต่อเครื่องครบ (แบต/สี/ประกัน/อุปกรณ์/ตำหนิ/สาขา/รูป/ลิงก์)', async () => {
    const tool = new SearchProductsTool(makePrisma([row()]));
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].units[0]).toEqual({
      id: 'prd-1',
      priceThb: 32900,
      installmentPriceThb: 35900,
      color: 'ดำ',
      batteryHealth: 92,
      shopWarrantyDays: 30,
      accessories: ['สายชาร์จ', 'กล่อง'],
      cosmeticNotes: 'มีรอยขนแมวที่ขอบซ้าย',
      branchName: 'ลาดพร้าว',
      photoAvailable: true,
      photoUrl: 'https://cdn.example.com/p1.jpg',
      webUrl: 'https://shop.example.com/products/prd-1',
      reserved: false,
    });
  });

  it('เครื่องไม่มีรูปยังถูกเสนอ (photoAvailable=false) — ไม่บังคับรูปแบบเว็บ', async () => {
    const tool = new SearchProductsTool(makePrisma([row({ gallery: [] })]));
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].units[0].photoAvailable).toBe(false);
    expect(r.groups[0].units[0].photoUrl).toBeNull();
  });

  it('RESERVED ติดธง ติดจองชั่วคราว และเรียงไว้หลังเครื่องพร้อมขาย', async () => {
    const tool = new SearchProductsTool(
      makePrisma([
        row({ id: 'res', status: 'RESERVED', cashPrice: D('30000') }),
        row({ id: 'ok', status: 'IN_STOCK', cashPrice: D('32900') }),
      ]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].units.map((u) => u.id)).toEqual(['ok', 'res']);
    expect(r.groups[0].units[1]).toMatchObject({
      reserved: true,
      reservedNote: 'ติดจองชั่วคราว',
    });
  });

  it('เครื่องที่ไม่มีราคาเงินสด → ไม่เข้ากลุ่ม แต่ถูกนับใน priceMissingCount (คง flow handoff/#1332)', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ id: 'no-price', cashPrice: null }), row({ id: 'ok' })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.priceMissingCount).toBe(1);
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual(['ok']);
  });

  it('ทุกเครื่องไม่มีราคา → groups ว่าง + priceMissingCount > 0 (บอทต้องไปทาง get_installment_rates)', async () => {
    const tool = new SearchProductsTool(makePrisma([row({ cashPrice: null })]));
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups).toEqual([]);
    expect(r.priceMissingCount).toBe(1);
  });

  it('maxPriceThb ตัดเครื่องที่แพงเกินงบ', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ id: 'cheap', cashPrice: D('20000') }), row({ id: 'pricey', cashPrice: D('50000') })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max', maxPriceThb: 30000 });
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual(['cheap']);
  });

  it('where ที่ยิงเข้า Prisma: กรอง [DEMO] + RESERVED/IN_STOCK + มือสองต้องมีเกรด + ไม่บังคับรูป', async () => {
    const prisma = makePrisma([]);
    const tool = new SearchProductsTool(prisma);
    await tool.run({ query: 'iPhone 15' });
    const where = (prisma.product.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.isOnlineVisible).toBe(true);
    expect(where.status).toEqual({ in: ['IN_STOCK', 'RESERVED'] });
    expect(where.NOT).toEqual({ name: { startsWith: '[DEMO]' } });
    expect(where.AND).toContainEqual({
      OR: [
        { category: { not: 'PHONE_USED' } },
        { AND: [{ conditionGrade: { not: null } }, { conditionGrade: { not: '' } }] },
      ],
    });
    // ไม่มีเงื่อนไข gallery ที่ไหนเลย — บอทต้องเห็นเครื่องที่ยังไม่มีรูป
    expect(JSON.stringify(where)).not.toContain('gallery');
  });

  it('SHOP_BASE_URL ไม่ได้ตั้ง → webUrl เป็น null (ไม่ throw)', async () => {
    delete process.env.SHOP_BASE_URL;
    const tool = new SearchProductsTool(makePrisma([row()]));
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].units[0].webUrl).toBeNull();
  });

  it('คำค้นว่าง → คืนผลว่างโดยไม่ยิง DB', async () => {
    const prisma = makePrisma([]);
    const tool = new SearchProductsTool(prisma);
    const r = await tool.run({ query: '   ' });
    expect(r.totalMatches).toBe(0);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/sales-bot/tools/search-products.tool.spec.ts` → แดงทุกเคส (`r.query` undefined ฯลฯ)
- [ ] **Step 3:** implement — เขียนทับ `apps/api/src/modules/sales-bot/tools/search-products.tool.ts` ทั้งไฟล์:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseDeviceQuery, normalizeStorage } from '../../../utils/device-query-normalize.util';
import { DEMO_NAME_PREFIX } from '../../../utils/product-readiness.util';
import { shopBaseUrl } from '../../../utils/shop-base-url.util';

export const SEARCH_PRODUCTS_TOOL = {
  name: 'search_products',
  description:
    'ค้นสต็อกจริงของ BESTCHOICE ด้วยคำพูดลูกค้าได้ตรง ๆ (ไทย/อังกฤษ/คำย่อ เช่น "ไอโฟน 15 โปรแม็กซ์ 256 สีดำ", "ip15"). ' +
    'คืนผลจัดกลุ่มตาม รุ่น+ความจุ+สภาพ พร้อมจำนวนเครื่อง ช่วงราคา และรายละเอียดรายเครื่อง ' +
    '(ราคาเงินสด/ราคาผ่อน/สี/แบต/ประกันร้าน/อุปกรณ์ที่แถม/ตำหนิ/สาขา/มีรูปไหม/ลิงก์เว็บ). ' +
    'เครื่องที่ติดจองอยู่จะมี reserved=true — บอกลูกค้าว่า "มีของแต่ติดจองชั่วคราว" ห้ามบอกว่าไม่มี. ' +
    'priceMissingCount > 0 แปลว่ามีเครื่องตรงรุ่นแต่ยังไม่ได้ตั้งราคา — อย่าเดาราคาเอง ให้ใช้ get_installment_rates ตอบเรทกลางแทน. ' +
    'ห้าม quote ตัวเลขใด ๆ ที่ไม่ได้มาจากผลลัพธ์นี้.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'คำที่ลูกค้าพิมพ์มาเลย เช่น "ไอโฟน 15 โปรแม็กซ์ 256gb" หรือ "iPhone 13"',
      },
      maxPriceThb: { type: 'number', description: 'งบสูงสุดของลูกค้า (บาท) ถ้ามีบอก' },
    },
    required: ['query'],
  },
};

/** จำนวนกลุ่มสูงสุดที่ส่งให้โมเดล — มากกว่านี้ข้อความจะยาวเกินอ่านในแชท */
const MAX_GROUPS = 5;
/** จำนวนเครื่องต่อกลุ่ม */
const MAX_UNITS_PER_GROUP = 3;
/** เพดาน candidate จาก DB ก่อนจัดกลุ่ม */
const CANDIDATE_TAKE = 40;

export const RESERVED_NOTE = 'ติดจองชั่วคราว';

export interface SearchProductUnit {
  id: string;
  priceThb: number;
  installmentPriceThb: number | null;
  color: string | null;
  batteryHealth: number | null;
  shopWarrantyDays: number | null;
  accessories: string[] | null;
  cosmeticNotes: string | null;
  branchName: string | null;
  photoAvailable: boolean;
  photoUrl: string | null;
  webUrl: string | null;
  reserved: boolean;
  reservedNote?: string;
}

export interface SearchProductGroup {
  brand: string;
  model: string;
  storage: string | null;
  condition: string;
  unitCount: number;
  minPrice: number;
  maxPrice: number;
  units: SearchProductUnit[];
}

export interface SearchProductsResult {
  query: { brand: string | null; model: string | null; storage: string | null; color: string | null };
  totalMatches: number;
  priceMissingCount: number;
  groups: SearchProductGroup[];
}

@Injectable()
export class SearchProductsTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { query: string; maxPriceThb?: number }): Promise<SearchProductsResult> {
    const raw = String(input?.query ?? '').trim();
    const parsed = parseDeviceQuery(raw);
    const emptyResult: SearchProductsResult = {
      query: { brand: parsed.brand, model: parsed.model, storage: parsed.storage, color: parsed.color },
      totalMatches: 0,
      priceMissingCount: 0,
      groups: [],
    };
    if (!raw) return emptyResult;

    // คำที่ใช้ contains-match: รุ่นที่ parse ได้ก่อน แล้วค่อยคำดิบ (เผื่อ parse ไม่ออก
    // เช่นชื่อรุ่นแบรนด์อื่น) — dedupe + ตัดคำสั้นกว่า 2 ตัวอักษรทิ้ง
    const terms = [...new Set([parsed.model, parsed.brand, parsed.rest, raw])]
      .filter((t): t is string => !!t && t.trim().length >= 2)
      .map((t) => t.trim());
    if (terms.length === 0) return emptyResult;

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      isOnlineVisible: true,
      // spec §5: บอทต้องเห็นเครื่องที่ติดจองด้วย เพื่อตอบว่า "มีของแต่ติดจอง"
      status: { in: ['IN_STOCK', 'RESERVED'] },
      // [DEMO] ถูกกรองแบบไม่ผูก NODE_ENV — กติกาเดียวกับ B0 product-readiness.util
      NOT: { name: { startsWith: DEMO_NAME_PREFIX } },
      OR: terms.flatMap((t) => [
        { name: { contains: t, mode: 'insensitive' as const } },
        { brand: { contains: t, mode: 'insensitive' as const } },
        { model: { contains: t, mode: 'insensitive' as const } },
      ]),
      AND: [
        // มือสองต้องผ่าน QC (มีเกรด) ถึงจะเสนอลูกค้าได้ — ห่อใน AND เพราะ OR
        // ระดับบนสุดถูกใช้เป็นคำค้นไปแล้ว
        {
          OR: [
            { category: { not: 'PHONE_USED' } },
            { AND: [{ conditionGrade: { not: null } }, { conditionGrade: { not: '' } }] },
          ],
        },
      ],
      // ⚠️ ไม่มีเงื่อนไข gallery โดยเจตนา (spec §5): บังคับรูปแบบเว็บจะซ่อนสต็อก
      // ที่ขายได้จริงออกจากแชท — บอกความจริงผ่าน photoAvailable แทน
    };

    const rows = await this.prisma.product.findMany({
      where,
      take: CANDIDATE_TAKE,
      orderBy: [{ cashPrice: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        storage: true,
        color: true,
        category: true,
        status: true,
        conditionGrade: true,
        cashPrice: true,
        installmentPrice: true,
        batteryHealth: true,
        shopWarrantyDays: true,
        accessoriesIncluded: true,
        cosmeticNotes: true,
        gallery: true,
        branch: { select: { name: true } },
      },
    });

    // narrowing hint แบบเดียวกับ get-installment-rates.tool: ถ้าลูกค้าระบุความจุ
    // และมีของตรงความจุนั้นจริง ค่อยแคบลง — ไม่งั้นคงชุดเดิมไว้ (ดีกว่าตอบว่าไม่มี)
    let candidates = rows;
    if (parsed.storage) {
      const bySize = rows.filter((r) => normalizeStorage(r.storage) === parsed.storage);
      if (bySize.length > 0) candidates = bySize;
    }
    if (parsed.color) {
      const byColor = candidates.filter((r) => (r.color ?? '').includes(parsed.color!));
      if (byColor.length > 0) candidates = byColor;
    }

    const priced = candidates.filter((r) => r.cashPrice != null && Number(r.cashPrice) > 0);
    const priceMissingCount = candidates.length - priced.length;

    const cap = input?.maxPriceThb;
    const inBudget =
      typeof cap === 'number' && Number.isFinite(cap)
        ? priced.filter((r) => Number(r.cashPrice) <= cap)
        : priced;

    const base = shopBaseUrl();
    const groups = new Map<string, SearchProductGroup>();
    for (const r of inBudget) {
      const condition = r.conditionGrade && r.conditionGrade.trim() ? r.conditionGrade : 'NEW';
      const storage = r.storage ? normalizeStorage(r.storage) : null;
      const key = `${r.brand}|${r.model}|${storage ?? ''}|${condition}`;
      const priceThb = Number(r.cashPrice);
      const unit: SearchProductUnit = {
        id: r.id,
        priceThb,
        installmentPriceThb: r.installmentPrice != null ? Number(r.installmentPrice) : null,
        color: r.color ?? null,
        batteryHealth: r.batteryHealth ?? null,
        shopWarrantyDays: r.shopWarrantyDays ?? null,
        accessories: Array.isArray(r.accessoriesIncluded)
          ? (r.accessoriesIncluded as unknown[]).map((a) => String(a))
          : null,
        cosmeticNotes: r.cosmeticNotes ?? null,
        branchName: r.branch?.name ?? null,
        // ⚠️ ห้ามใช้ Product.photos — เป็น base64 data URL ส่งเข้า LINE/FB ไม่ได้
        photoAvailable: r.gallery.length > 0,
        photoUrl: r.gallery[0] ?? null,
        webUrl: base ? `${base}/products/${r.id}` : null,
        reserved: r.status === 'RESERVED',
        ...(r.status === 'RESERVED' ? { reservedNote: RESERVED_NOTE } : {}),
      };

      const g = groups.get(key);
      if (g) {
        g.unitCount += 1;
        g.minPrice = Math.min(g.minPrice, priceThb);
        g.maxPrice = Math.max(g.maxPrice, priceThb);
        g.units.push(unit);
      } else {
        groups.set(key, {
          brand: r.brand,
          model: r.model,
          storage,
          condition,
          unitCount: 1,
          minPrice: priceThb,
          maxPrice: priceThb,
          units: [unit],
        });
      }
    }

    const sorted = [...groups.values()]
      .map((g) => ({
        ...g,
        units: g.units
          // เครื่องพร้อมขายมาก่อนเครื่องที่ติดจองเสมอ แล้วค่อยเรียงราคาถูก→แพง
          .sort((a, b) => Number(a.reserved) - Number(b.reserved) || a.priceThb - b.priceThb)
          .slice(0, MAX_UNITS_PER_GROUP),
      }))
      .sort((a, b) => a.minPrice - b.minPrice)
      .slice(0, MAX_GROUPS);

    return {
      query: { brand: parsed.brand, model: parsed.model, storage: parsed.storage, color: parsed.color },
      totalMatches: candidates.length,
      priceMissingCount,
      groups: sorted,
    };
  }
}
```

- [ ] **Step 4:** รันผ่าน: `cd apps/api && npx jest src/modules/sales-bot/tools/search-products.tool.spec.ts` → เขียวทุกเคส
- [ ] **Step 5:** พิสูจน์ว่า guard ยังคุ้ม shape ใหม่: `cd apps/api && npx jest src/utils/price-grounding.util.spec.ts src/modules/sales-bot/sales-bot.service.spec.ts` → เขียวทั้งคู่
- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/modules/sales-bot/tools/search-products.tool.ts` → ไม่มี error ใหม่
- [ ] **Step 7:** Commit: `feat(bot): search_products ตอบรายละเอียดเท่าแอดมิน — จัดกลุ่มรุ่น/ความจุ/สภาพ + RESERVED + ราคาคอลัมน์ (B3 Task 3)`

---

### Task 4: `calculate_installment` ใช้เครื่องคิดเดียวกับสัญญาจริง + golden parity กับ `InstallmentPreviewService`

> **นี่คือ red line ของ batch** (spec §10): "ตัวเลขที่ลูกค้าเห็นต้องตรงกับ engine จริง"

**การตัดสินใจ config-resolution (spec §5 สั่งให้เลือกอันเดียวและอธิบายเหตุผล):**

| ที่ | เงื่อนไขค้น `InterestConfig` | ใช้ทำอะไร |
|---|---|---|
| `calculate-installment.tool.ts:95-103` (เดิม) | `minInstallmentMonths <= tenure <= maxInstallmentMonths` + `orderBy createdAt desc` | บอท |
| `installment-preview.service.ts:61-68` | `productCategories: { has: product.category }` | ตัวเลขบนเว็บลูกค้า |
| **`sale-writer.service.ts:224-226`** | `productCategories: { has: product.category }` | **ตอนขาย/ทำสัญญาจริง** |
| **`contract-lifecycle.service.ts:74-80`** | `productCategories: { has: product.category }` | **ตอน activate สัญญา** |

→ **เลือก `productCategories` (แบบ engine จริง)** เพราะ 3 ใน 4 จุด — รวมทั้ง 2 จุดที่สร้างหนี้จริง — ใช้แบบนี้; ของบอทคือตัวที่แปลกแยกอยู่ตัวเดียว. ผลข้างเคียงที่ต้องรู้: การกรอง tenure หายไปจาก query แต่ **ไม่หลุด** เพราะ `calcBcInstallment` ตรวจ `allowedMonths.includes(months)` แล้วคืน `errors` (`installment-calc.util.ts:33-35`) → เรา map เป็น `{ error: 'rate_not_configured' }` เหมือนเดิม

**Files:**
- Create: `apps/api/src/utils/bc-installment-config.util.ts`
- Create: `apps/api/src/utils/bc-installment-config.util.spec.ts`
- Modify: `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts` (ทั้งไฟล์)
- Modify: `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.spec.ts` (เขียนใหม่ — goldens เดิมคิดคนละฐาน)
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.ts:56-97` (`previewBc` → เรียก util, behavior-preserving)

**Interfaces:**
- Consumes:
  - `calcBcInstallment(input: BcCalcInput): BcCalcOutput` — `apps/api/src/utils/installment-calc.util.ts:18`
  - `BcConfig = { minDownPct: Decimal; commissionPct: Decimal; vatPct: Decimal; ratePctByMonths: Map<number, Decimal>; allowedMonths: number[] }` — `apps/api/src/utils/installment-calc.types.ts:3-10`
  - `shopBaseUrl()` — `apps/api/src/utils/shop-base-url.util.ts:10`
- Produces:
```ts
// apps/api/src/utils/bc-installment-config.util.ts
export interface BcConfigResolution { found: boolean; config?: BcConfig }
export async function resolveBcConfigForCategory(
  prisma: { interestConfig: { findFirst: (args: unknown) => Promise<unknown> } },
  category: string,
): Promise<BcConfigResolution>;
```

> 🚩 **เจ้าของ resolver = B3 (ตัวเดียวของ repo) — ข้อตกลงข้าม batch ที่ห้ามละเมิด**
> `apps/api/src/utils/bc-installment-config.util.ts` คือ **resolver ตัวเดียว** ที่แปลง `InterestConfig` → `BcConfig` ทั้ง repo. ทุก batch ถัดไปต้อง `import` ตัวนี้:
> - **B4 ห้ามสร้าง `apps/api/src/modules/shop-catalog/bc-installment-config.service.ts`** (แผน B4 Task ~1437-1523 เขียนไว้ว่าจะสร้าง `BcInstallmentConfigService` ที่ทำงานเดียวกัน แทนบล็อกเดียวกัน `previewBc:61-97`) → ให้ตัด task นั้นทิ้งแล้วเรียก `resolveBcConfigForCategory` แทน. ถ้า B4 merge ก่อน B3: B3 ต้องลบ service ตัวนั้นแล้ว re-point มาที่ util ในคอมมิตของ Task 4
> - **B4 ห้ามเปลี่ยน constructor ของ `InstallmentPreviewService`** (แผน B4 บรรทัด ~1547 เพิ่มพารามิเตอร์ที่ 2 `private bcConfig: BcInstallmentConfigService`) — golden parity test ของ Task 4 (Step 7) สร้าง service ด้วย **1 อาร์กิวเมนต์** `new InstallmentPreviewService(prisma)` ⇒ พารามิเตอร์ที่ 2 = red line ของ B3 พังทันที และเป็น red line ตาม Global Constraints ("ตัวเลขที่ลูกค้าเห็นต้องตรงกับ engine จริง")
> - resolver เป็น **pure util (ไม่ใช่ `@Injectable`)** โดยตั้งใจ: ผู้เรียกอยู่คนละโมดูล (`sales-bot`, `shop-catalog`, `staff-chat`) การทำเป็น service บังคับให้ทุกโมดูลต้อง import โมดูลของกันและกัน
>
> ⚠️ **การเพิ่ม `orderBy: { createdAt: 'asc' }` = จุดเดียวที่ Task นี้ไม่ byte-identical กับ `previewBc` เดิม** (ของเดิมไม่มี orderBy = ผลลัพธ์ไม่ deterministic เมื่อมี config active หลายตัวต่อหมวด). spec เดิมของ `shop-catalog` ไม่ assert args ของ `findFirst` (`installment-preview.service.spec.ts:13,61` mock แบบไม่ดู argument) ⇒ **ยังเขียวโดยไม่แก้ assertion** ตาม Step 6

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — `apps/api/src/utils/bc-installment-config.util.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { resolveBcConfigForCategory } from './bc-installment-config.util';

const makePrisma = (cfg: unknown) =>
  ({ interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) } }) as never;

const baseCfg = {
  id: 'ic-1',
  minDownPaymentPct: new Prisma.Decimal('0.20'),
  storeCommissionPct: new Prisma.Decimal('0.05'),
  vatPct: new Prisma.Decimal('0.07'),
  interestRate: new Prisma.Decimal('0.10'),
  minInstallmentMonths: 6,
  maxInstallmentMonths: 8,
  rates: [] as { months: number; ratePct: Prisma.Decimal }[],
};

describe('resolveBcConfigForCategory', () => {
  it('ค้นด้วย productCategories (ตรงกับ sale-writer / contract-lifecycle / installment-preview)', async () => {
    const prisma = makePrisma(baseCfg);
    await resolveBcConfigForCategory(prisma, 'PHONE_USED');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = ((prisma as any).interestConfig.findFirst as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({
      productCategories: { has: 'PHONE_USED' },
      deletedAt: null,
      isActive: true,
    });
    // deterministic: config เก่าสุดชนะ — ตรงกับ ProductQuoteService ของ B2
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('ไม่พบ config → found=false', async () => {
    expect(await resolveBcConfigForCategory(makePrisma(null), 'PHONE_NEW')).toEqual({ found: false });
  });

  it('มี InterestConfigRate → ใช้ ratePct ต่อ term ตรง ๆ', async () => {
    const r = await resolveBcConfigForCategory(
      makePrisma({
        ...baseCfg,
        rates: [
          { months: 6, ratePct: new Prisma.Decimal('0.45') },
          { months: 12, ratePct: new Prisma.Decimal('0.90') },
        ],
      }),
      'PHONE_NEW',
    );
    expect(r.config!.allowedMonths).toEqual([6, 12]);
    expect(r.config!.ratePctByMonths.get(12)!.toString()).toBe('0.9');
  });

  it('ไม่มี rate rows → สังเคราะห์จาก interestRate × months ตามช่วง min..max (parity กับ preview)', async () => {
    const r = await resolveBcConfigForCategory(makePrisma(baseCfg), 'PHONE_NEW');
    expect(r.config!.allowedMonths).toEqual([6, 7, 8]);
    expect(r.config!.ratePctByMonths.get(6)!.toString()).toBe('0.6');
    expect(r.config!.ratePctByMonths.get(8)!.toString()).toBe('0.8');
  });

  it('ส่ง minDownPct / commissionPct / vatPct ต่อออกมาครบ', async () => {
    const r = await resolveBcConfigForCategory(makePrisma(baseCfg), 'PHONE_NEW');
    expect(r.config!.minDownPct.toString()).toBe('0.2');
    expect(r.config!.commissionPct.toString()).toBe('0.05');
    expect(r.config!.vatPct.toString()).toBe('0.07');
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/bc-installment-config.util.spec.ts` → `Cannot find module`
- [ ] **Step 3:** implement — `apps/api/src/utils/bc-installment-config.util.ts` (ยกตรรกะจาก `installment-preview.service.ts:61-96` มาแบบตัวต่อตัว):

```ts
import Decimal from 'decimal.js';
import type { BcConfig } from './installment-calc.types';

/**
 * B3 §5 — resolve InterestConfig → BcConfig ที่ `calcBcInstallment` กินได้
 *
 * ตรรกะยกมาจาก `modules/shop-catalog/installment-preview.service.ts:61-96`
 * (ต่างจากเดิมจุดเดียว = ใส่ `orderBy: { createdAt: 'asc' }` ให้ deterministic)
 * แล้วให้ผู้อ่านใช้ร่วมกัน:
 *   - InstallmentPreviewService (ตัวเลขบนเว็บลูกค้า)
 *   - CalculateInstallmentTool (ตัวเลขที่บอทตอบในแชท)
 *   - ProductQuoteService ของ B2 (การ์ดสินค้า/ตัวเลือกสินค้าใน inbox — Task 14)
 * และเป็น **resolver ตัวเดียวของ repo**: batch อื่น (B4) ต้อง import ตัวนี้
 * ห้ามสร้าง service ที่ทำงานเดียวกันขึ้นมาใหม่
 *
 * ทำไมค้นด้วย productCategories ไม่ใช่ช่วง tenure: `sale-writer.service.ts:224-226`
 * และ `contract-lifecycle.service.ts:74-80` — โค้ดที่สร้างสัญญาจริง — ค้นแบบนี้
 * การกรอง tenure ไม่ได้หายไป แต่ย้ายไปอยู่ที่ `allowedMonths` ซึ่ง
 * `calcBcInstallment` ตรวจให้เอง (installment-calc.util.ts:33-35)
 */

interface InterestConfigRow {
  minDownPaymentPct: unknown;
  storeCommissionPct: unknown;
  vatPct: unknown;
  interestRate: unknown;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  rates: { months: number; ratePct: unknown }[];
}

interface InterestConfigReader {
  interestConfig: { findFirst: (args: unknown) => Promise<unknown> };
}

export interface BcConfigResolution {
  found: boolean;
  config?: BcConfig;
}

export async function resolveBcConfigForCategory(
  prisma: InterestConfigReader,
  category: string,
): Promise<BcConfigResolution> {
  const config = (await prisma.interestConfig.findFirst({
    where: { productCategories: { has: category }, deletedAt: null, isActive: true },
    include: { rates: { where: { deletedAt: null } } },
    // ⚠️ ของเดิมที่ installment-preview.service.ts:61-68 **ไม่มี orderBy** = ถ้ามี
    // config active มากกว่า 1 ตัวต่อหมวด ผลลัพธ์ขึ้นกับลำดับที่ Postgres คืนมา
    // (ค่างวดเปลี่ยนไปมาโดยไม่มีใครแก้อะไร). ปักหมุดเป็น "ตัวเก่าสุดชนะ" ให้ตรงกับ
    // ProductQuoteService ของ B2 (`getQuotes` ใช้ `orderBy: { createdAt: 'asc' }`
    // แล้วเอาตัวแรกต่อหมวด) — ทั้งระบบต้อง resolve ได้ config ตัวเดียวกันเสมอ
    orderBy: { createdAt: 'asc' },
  })) as InterestConfigRow | null;

  if (!config) return { found: false };

  const ratePctByMonths = new Map<number, Decimal>();
  for (const r of config.rates ?? []) {
    ratePctByMonths.set(r.months, new Decimal(String(r.ratePct)));
  }
  // Fallback เมื่อ InterestConfigRate ยังไม่ seed — สังเคราะห์จาก per-month × m
  if (ratePctByMonths.size === 0) {
    const rate = new Decimal(String(config.interestRate));
    for (let m = config.minInstallmentMonths; m <= config.maxInstallmentMonths; m++) {
      ratePctByMonths.set(m, rate.mul(m));
    }
  }
  const allowedMonths = Array.from(ratePctByMonths.keys()).sort((a, b) => a - b);

  return {
    found: true,
    config: {
      minDownPct: new Decimal(String(config.minDownPaymentPct)),
      commissionPct: new Decimal(String(config.storeCommissionPct)),
      vatPct: new Decimal(String(config.vatPct)),
      ratePctByMonths,
      allowedMonths,
    },
  };
}
```

- [ ] **Step 4:** รันผ่าน: `cd apps/api && npx jest src/utils/bc-installment-config.util.spec.ts` → เขียว
- [ ] **Step 5:** re-point `InstallmentPreviewService.previewBc` — ใน `apps/api/src/modules/shop-catalog/installment-preview.service.ts` แทนบล็อก `:61-97` ด้วย:

```ts
    const resolved = await resolveBcConfigForCategory(this.prisma, product.category);
    if (!resolved.found) return { available: false, reason: 'no_interest_config' };

    const result = calcBcInstallment({
      installmentPrice,
      months: dto.months,
      downPct: dto.downPct !== undefined ? new Decimal(dto.downPct) : undefined,
      customDownAmount:
        dto.customDownAmount !== undefined ? new Decimal(dto.customDownAmount) : undefined,
      config: resolved.config!,
    });
```
  พร้อม `import { resolveBcConfigForCategory } from '../../utils/bc-installment-config.util';`
- [ ] **Step 6:** พิสูจน์ว่า preview ไม่เปลี่ยนพฤติกรรม: `cd apps/api && npx jest src/modules/shop-catalog` → **เขียวโดยไม่แก้ spec แม้แต่บรรทัดเดียว** (ถ้าแดง = refactor ผิด ให้ย้อน diff)
- [ ] **Step 7:** เขียน spec ใหม่ทับ `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.spec.ts` (goldens เดิมคิดจาก `prices[isDefault]` และไม่มี commission/VAT — ใช้ต่อไม่ได้):

```ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CalculateInstallmentTool } from './calculate-installment.tool';
import { InstallmentPreviewService } from '../../shop-catalog/installment-preview.service';

/**
 * B3 §5 — tool นี้ต้องคิดเลขด้วย `calcBcInstallment` ตัวเดียวกับ preview/สัญญาจริง
 * (#1335 เคยควอตค่างวดต่ำกว่าความจริงหลายเท่าเพราะคิดสูตรเอง — ห้ามกลับไปทางนั้น)
 */

const D = (v: string) => new Prisma.Decimal(v);

const productRow = (over: Record<string, unknown> = {}) => ({
  id: 'prd-1',
  name: 'iPhone 15 Pro Max 256GB',
  category: 'PHONE_USED',
  cashPrice: D('32900'),
  installmentPrice: D('35900'),
  gallery: ['https://cdn.example.com/p1.jpg'],
  prices: [],
  ...over,
});

const cfgRow = (over: Record<string, unknown> = {}) => ({
  id: 'ic-1',
  minDownPaymentPct: D('0.20'),
  storeCommissionPct: D('0'),
  vatPct: D('0'),
  interestRate: D('0.10'),
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  rates: [],
  ...over,
});

const makePrisma = (product: unknown, cfg: unknown) =>
  ({
    product: { findFirst: jest.fn().mockResolvedValue(product) },
    interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) },
  }) as unknown as PrismaService;

describe('CalculateInstallmentTool.run', () => {
  const prevBase = process.env.SHOP_BASE_URL;
  beforeEach(() => {
    process.env.SHOP_BASE_URL = 'https://shop.example.com';
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.SHOP_BASE_URL;
    else process.env.SHOP_BASE_URL = prevBase;
  });

  it('คิดจาก installmentPrice (ไม่ใช่ราคาเงินสด) และคืนคีย์ครบตามสัญญา', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    const r = (await tool.run({ productId: 'prd-1', downPct: 20, tenureMonths: 12 })) as Record<
      string,
      unknown
    >;
    expect(r.priceThb).toBe(35900); // ฐานผ่อน
    expect(r.cashPriceThb).toBe(32900); // ราคาเงินสดไว้อ้างอิง
    expect(Object.keys(r).sort()).toEqual(
      [
        'cashPriceThb',
        'downAmountThb',
        'downPct',
        'financedThb',
        'monthlyThb',
        'photoUrl',
        'priceThb',
        'productId',
        'productName',
        'ratePct',
        'tenureMonths',
        'totalPaidThb',
        'webUrl',
      ].sort(),
    );
  });

  it('ค่างวดตรงกับสูตร calcBcInstallment (commission/VAT = 0, rate สังเคราะห์ 0.10 × 12)', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    const r = (await tool.run({ productId: 'prd-1', downPct: 20, tenureMonths: 12 })) as Record<
      string,
      number
    >;
    // down = 35900 × 0.20 = 7180; financed = 28720; rate12 = 1.2; interest = 34464
    // subtotal = 63184; monthly = 63184 / 12 = 5265.33; total = 7180 + 63184 = 70364
    expect(r.downAmountThb).toBe(7180);
    expect(r.financedThb).toBe(28720);
    expect(r.ratePct).toBe(120);
    expect(r.monthlyThb).toBeCloseTo(5265.33, 2);
    expect(r.totalPaidThb).toBeCloseTo(70364, 2);
  });

  it('ไม่ส่ง downPct → ใช้ minDownPaymentPct ของ InterestConfig (เลิก hardcode 20%)', async () => {
    const tool = new CalculateInstallmentTool(
      makePrisma(productRow(), cfgRow({ minDownPaymentPct: D('0.30') })),
    );
    const r = (await tool.run({ productId: 'prd-1', tenureMonths: 12 })) as Record<string, number>;
    expect(r.downPct).toBe(30);
    expect(r.downAmountThb).toBe(10770); // 35900 × 0.30
  });

  it('fallback ไป prices[] label ราคาผ่อน เมื่อคอลัมน์ยังว่าง (parity กับ preview)', async () => {
    const tool = new CalculateInstallmentTool(
      makePrisma(
        productRow({
          installmentPrice: null,
          prices: [{ label: 'ราคาผ่อน BESTCHOICE', amount: D('35900') }],
        }),
        cfgRow(),
      ),
    );
    const r = (await tool.run({ productId: 'prd-1', tenureMonths: 12 })) as Record<string, number>;
    expect(r.priceThb).toBe(35900);
  });

  it('ไม่มีราคาผ่อนเลย → price_not_configured', async () => {
    const tool = new CalculateInstallmentTool(
      makePrisma(productRow({ installmentPrice: null, prices: [] }), cfgRow()),
    );
    expect(await tool.run({ productId: 'prd-1', tenureMonths: 12 })).toEqual({
      error: 'price_not_configured',
    });
  });

  it('ไม่พบ InterestConfig ของหมวดนี้ → rate_not_configured', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), null));
    expect(await tool.run({ productId: 'prd-1', tenureMonths: 12 })).toEqual({
      error: 'rate_not_configured',
    });
  });

  it('จำนวนงวดนอกตาราง → rate_not_configured (ไม่ throw, persona พา handoff เอง)', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    expect(await tool.run({ productId: 'prd-1', tenureMonths: 36 })).toEqual({
      error: 'rate_not_configured',
    });
  });

  it('ดาวน์ต่ำกว่าขั้นต่ำ → invalid_installment พร้อมเหตุผลภาษาไทย', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    const r = (await tool.run({ productId: 'prd-1', downPct: 5, tenureMonths: 12 })) as {
      error: string;
      reasons: string[];
    };
    expect(r.error).toBe('invalid_installment');
    expect(r.reasons.join(' ')).toContain('เงินดาวน์');
  });

  it('ไม่พบสินค้า → product_not_found', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(null, cfgRow()));
    expect(await tool.run({ productId: 'nope', tenureMonths: 12 })).toEqual({
      error: 'product_not_found',
    });
  });

  it('คืน photoUrl/webUrl ไว้ให้ SalesBotService แนบเป็น attachment', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    const r = (await tool.run({ productId: 'prd-1', tenureMonths: 12 })) as Record<string, unknown>;
    expect(r.photoUrl).toBe('https://cdn.example.com/p1.jpg');
    expect(r.webUrl).toBe('https://shop.example.com/products/prd-1');
  });
});

/**
 * RED LINE (spec §10): เลขที่ลูกค้าเห็นในแชท ต้องเท่ากับเลขที่เว็บ/สัญญาคิด
 * เทสต์นี้เรียกทั้ง 2 บริการด้วย input เดียวกัน แล้วเทียบผลตรง ๆ
 */
describe('golden parity: calculate_installment === InstallmentPreviewService', () => {
  it.each([
    { months: 6, downPct: 20 },
    { months: 12, downPct: 30 },
  ])('ตรงกันทุกบาทที่ %o', async ({ months, downPct }) => {
    const installmentPrice = '35900';
    const cfg = {
      id: 'ic-1',
      minDownPaymentPct: D('0.20'),
      storeCommissionPct: D('0.05'),
      vatPct: D('0.07'),
      interestRate: D('0.10'),
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      rates: [],
    };

    const tool = new CalculateInstallmentTool(
      makePrisma(
        {
          id: 'prd-1',
          name: 'iPhone 15 Pro Max',
          category: 'PHONE_USED',
          cashPrice: D('32900'),
          installmentPrice: D(installmentPrice),
          gallery: [],
          prices: [],
        },
        cfg,
      ),
    );

    const preview = new InstallmentPreviewService(
      ({
        product: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'prd-1',
            deletedAt: null,
            category: 'PHONE_USED',
            installmentPrice: D(installmentPrice),
            prices: [],
          }),
        },
        interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) },
      } as unknown) as PrismaService,
    );

    const fromBot = (await tool.run({ productId: 'prd-1', downPct, tenureMonths: months })) as Record<
      string,
      number
    >;
    const fromWeb = await preview.preview({
      productId: 'prd-1',
      provider: 'BC',
      months,
      downPct: downPct / 100,
    } as never);

    expect(fromWeb.available).toBe(true);
    expect(fromBot.monthlyThb).toBe(fromWeb.monthlyPayment);
    expect(fromBot.downAmountThb).toBe(fromWeb.downAmount);
    expect(fromBot.financedThb).toBe(fromWeb.financedAmount);
  });
});
```

- [ ] **Step 8:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/sales-bot/tools/calculate-installment.tool.spec.ts` → แดง (tool ยังคิดสูตรเก่า)
- [ ] **Step 9:** implement — เขียนทับ `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts` ทั้งไฟล์:

```ts
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../prisma/prisma.service';
import { calcBcInstallment } from '../../../utils/installment-calc.util';
import { resolveBcConfigForCategory } from '../../../utils/bc-installment-config.util';
import { shopBaseUrl } from '../../../utils/shop-base-url.util';

export const CALCULATE_INSTALLMENT_TOOL = {
  name: 'calculate_installment',
  description:
    'คำนวณค่างวดจริงของเครื่องที่ระบุ ด้วยเครื่องคิดตัวเดียวกับที่ใช้ทำสัญญา (รวมค่าคอม/VAT ตาม InterestConfig). ' +
    'ต้องมี productId จากผลลัพธ์ search_products ก่อนเสมอ — ห้ามเดา id. ' +
    'downPct เป็นเปอร์เซ็นต์ 0-100 ถ้าไม่ส่งจะใช้ดาวน์ขั้นต่ำตามที่ตั้งค่าไว้. ' +
    'error=rate_not_configured แปลว่าจำนวนงวดนี้ไม่มีในตาราง ให้เสนอจำนวนงวดอื่นหรือส่งต่อพนักงาน. ' +
    'ห้าม quote ตัวเลขใด ๆ ที่ไม่ได้มาจากผลลัพธ์นี้.',
  input_schema: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'id ของเครื่องจาก search_products' },
      downPct: { type: 'number', description: 'เปอร์เซ็นต์เงินดาวน์ 0-100' },
      tenureMonths: { type: 'integer', description: 'จำนวนงวด เช่น 6, 10, 12' },
    },
    required: ['productId', 'tenureMonths'],
  },
};

@Injectable()
export class CalculateInstallmentTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { productId: string; downPct?: number; tenureMonths: number }) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      select: {
        id: true,
        name: true,
        category: true,
        cashPrice: true,
        installmentPrice: true,
        gallery: true,
        prices: { where: { deletedAt: null }, select: { label: true, amount: true } },
      },
    });
    if (!product) return { error: 'product_not_found' };

    // ลำดับเดียวกับ installment-preview.service.ts:39-43 เป๊ะ — คอลัมน์ก่อน
    // แล้วค่อย fallback label (ระหว่างที่ B0 ยังไล่ backfill ราคาไม่ครบ)
    const baseRaw =
      product.installmentPrice ??
      product.prices.find((p) => p.label === 'ราคาผ่อน BESTCHOICE')?.amount ??
      product.prices.find((p) => p.label.startsWith('ราคาผ่อน'))?.amount ??
      null;
    if (baseRaw == null) return { error: 'price_not_configured' };
    const installmentPrice = new Decimal(baseRaw.toString());

    const resolved = await resolveBcConfigForCategory(this.prisma, product.category);
    if (!resolved.found || !resolved.config) return { error: 'rate_not_configured' };
    const config = resolved.config;

    // schema ของ tool รับเป็นเปอร์เซ็นต์ (0-100) แต่ calcBcInstallment กินเศษส่วน
    const downPctFraction =
      input.downPct !== undefined && Number.isFinite(input.downPct)
        ? new Decimal(input.downPct).div(100)
        : config.minDownPct;

    // งวดที่ไม่มีในตาราง = ตอบ rate_not_configured เหมือนพฤติกรรมเดิม (#1335)
    // ไม่ปล่อยเป็น invalid_installment เพราะ persona มี flow แยกไว้แล้ว
    if (!config.allowedMonths.includes(input.tenureMonths)) {
      return { error: 'rate_not_configured' };
    }

    const result = calcBcInstallment({
      installmentPrice,
      months: input.tenureMonths,
      downPct: downPctFraction,
      config,
    });
    if (!result.isValid) {
      return { error: 'invalid_installment', reasons: result.errors };
    }

    const base = shopBaseUrl();
    return {
      productId: product.id,
      productName: product.name,
      cashPriceThb: product.cashPrice != null ? Number(product.cashPrice) : null,
      priceThb: installmentPrice.toNumber(),
      downPct: result.downPct.mul(100).toNumber(),
      downAmountThb: result.downAmount.toNumber(),
      financedThb: result.financedAmount.toNumber(),
      tenureMonths: input.tenureMonths,
      ratePct: result.interestPct.mul(100).toNumber(),
      monthlyThb: result.monthlyPayment.toNumber(),
      totalPaidThb: result.downAmount.add(result.totalWithVat).toNumber(),
      photoUrl: product.gallery[0] ?? null,
      webUrl: base ? `${base}/products/${product.id}` : null,
    };
  }
}
```

- [ ] **Step 10:** รันผ่าน: `cd apps/api && npx jest src/modules/sales-bot/tools/calculate-installment.tool.spec.ts` → **เขียวรวม golden parity ทั้ง 2 เคส**
- [ ] **Step 11:** ยืนยัน grounding ยังคุ้ม: `cd apps/api && npx jest src/utils/price-grounding.util.spec.ts src/modules/sales-bot` → เขียวหมด
- [ ] **Step 12:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/utils/bc-installment-config.util.ts src/modules/sales-bot/tools/calculate-installment.tool.ts src/modules/shop-catalog/installment-preview.service.ts` → ไม่มี error ใหม่
- [ ] **Step 13:** Commit: `feat(bot): calculate_installment ใช้เครื่องคิดเดียวกับสัญญาจริง + golden parity กับ preview (B3 Task 4)`

---

### Task 5: `get_installment_rates` เลิกนิยาม storage-parser ของตัวเอง → ใช้ util B0

> spec §2.4 ระบุตรงว่า `normalizeStorage` + storage-token refine ถูก "ดูดเข้า" util B0 แล้ว และ **B3 มีหน้าที่ re-point tool มาใช้** — ไม่งั้นมีตรรกะเดียวกัน 2 ที่ (drift แน่นอน)

**Files:**
- Modify: `apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.ts` (ลบ `extractStorageToken` :76-81 + `normalizeStorage` :83-85; แก้ call site :97, :101-103, :126)
- Modify: `apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.spec.ts` (เพิ่ม 1 เคส regression — ไม่แก้เคสเดิม)

**Interfaces:**
- Consumes จาก `apps/api/src/utils/device-query-normalize.util.ts` (B0 Task 3):
```ts
export function normalizeStorage(storage: string | null | undefined): string;
export function extractStorageToken(text: string): string | null;
export function stripStorageToken(text: string): string;
```
  B0 ระบุไว้ชัดว่าคัดลอกพฤติกรรมมาจากไฟล์นี้ **แบบเป๊ะ** (regex `/(\d+)\s*(gb|tb)\b/i` + upper + ตัดช่องว่าง) → ผลลัพธ์ต้องไม่เปลี่ยน

- [ ] **Step 1:** เพิ่มเคส regression ท้าย `apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.spec.ts` (ยืนยันพฤติกรรมที่ต้องคงไว้หลังสลับ util). **helper ที่มีอยู่จริงในไฟล์นี้คือ `makePrisma(templates, configRows?)` (`:22-29`) และ `tpl(over)` (`:31-44`)** — ใช้ของเดิม ห้ามสร้างซ้ำ; `makePrisma` คืน `PrismaService` แบบ cast จึงต้อง cast กลับตอนอ่าน mock:

```ts
describe('storage parsing หลัง re-point ไป util B0 (B3 Task 5)', () => {
  it('ตัด token ความจุออกจาก modelQuery แล้วยัง match รุ่นได้', async () => {
    const prisma = makePrisma([
      tpl({ model: 'iPhone 15 Pro Max', storage: '256GB' }),
      tpl({ model: 'iPhone 15 Pro Max', storage: '512GB' }),
    ]);
    const tool = new GetInstallmentRatesTool(prisma);
    const r = await tool.run({ query: 'iPhone 15 Pro Max 256 gb' });
    // where.OR ต้องใช้คำที่ไม่มี "256 gb" ปนอยู่ ไม่งั้น contains ไม่เจออะไรเลย
    const where = (prisma.pricingTemplate.findMany as unknown as jest.Mock).mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('256');
    // และ refine ตามความจุที่ลูกค้าระบุ
    expect(r.templates).toHaveLength(1);
    expect(r.templates[0].storage).toBe('256GB');
  });

  it('ความจุที่ลูกค้าขอไม่มีในตาราง → ไม่ทิ้งผลทั้งหมด (คง exact-then-fallback)', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([tpl({ model: 'iPhone 15', storage: '128GB' })]),
    );
    const r = await tool.run({ query: 'iPhone 15 1TB' });
    expect(r.templates).toHaveLength(1);
    expect(r.templates[0].storage).toBe('128GB');
  });
});
```
> `describe('GetInstallmentRatesTool.run')` ปิดที่ท้ายไฟล์และ `makePrisma`/`tpl` เป็น module-scope → describe ใหม่ **ต่อท้ายไฟล์ได้จริง** (ต่างจาก `sales-bot.service.spec.ts`)

- [ ] **Step 2:** รันให้เห็นสถานะก่อนแก้: `cd apps/api && npx jest src/modules/sales-bot/tools/get-installment-rates.tool.spec.ts` → 2 เคสใหม่ควรเขียวอยู่แล้ว (พฤติกรรมปัจจุบัน) = ปักหมุดไว้ก่อนสลับ util
- [ ] **Step 3:** แก้ `apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.ts`:
  - เพิ่ม `import { extractStorageToken, normalizeStorage, stripStorageToken } from '../../../utils/device-query-normalize.util';`
  - **ลบ** function `extractStorageToken` (:76-81) และ `normalizeStorage` (:83-85) ทั้งบล็อกพร้อมคอมเมนต์
  - แทนบล็อก :101-103:
```ts
    const modelQuery = storageToken ? stripStorageToken(rawQuery) : rawQuery;
```
  - บรรทัด :126 (`normalizeStorage(r.storage)`) ใช้ต่อได้ทันที เพราะ util B0 รับ `string | null | undefined`
- [ ] **Step 4:** รันผ่าน: `cd apps/api && npx jest src/modules/sales-bot/tools/get-installment-rates.tool.spec.ts` → **เขียวทั้งไฟล์ รวมเคสเดิมทุกเคส** (ถ้าเคสเดิมแดง = util B0 เบี้ยวจากต้นฉบับ ให้ไปแก้ที่ util ไม่ใช่แก้ spec)
- [ ] **Step 5:** ยืนยันไม่มีตรรกะซ้ำหลงเหลือ: `grep -n "gb|tb" apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.ts` → ต้องไม่มีผลลัพธ์
- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/modules/sales-bot/tools/get-installment-rates.tool.ts` → ไม่มี error ใหม่
- [ ] **Step 7:** Commit: `refactor(bot): get_installment_rates ใช้ storage parser ตัวเดียวกับ util B0 (B3 Task 5)`

---

### Task 6: `list_promotions` — filter ตามสินค้า/หมวดจริง + ให้บอทพูดเลขในโปรได้โดยไม่โดน guard block

> spec §5: "implement productId/categories filter จริง" — วันนี้ `list-promotions.tool.ts:22` ชื่อพารามิเตอร์เป็น `_input` (ไม่ใช้เลย) และ description บอกโมเดลตรง ๆ ว่า "currently ignored"

**Files:**
- Modify: `apps/api/src/modules/sales-bot/tools/list-promotions.tool.ts` (ทั้งไฟล์)
- Create: `apps/api/src/modules/sales-bot/tools/list-promotions.tool.spec.ts`
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.ts` (เพิ่ม hook เก็บ grounding จาก "ข้อความที่แอดมินเขียนเอง")

**Interfaces:**
- Consumes: `Promotion.conditions Json?` — schema comment ที่ `schema.prisma:4772` ระบุ shape `{ minPurchase?, productIds?, categories? }`
- Consumes: `collectGroundedPricesFromText(text, into)` (Task 1) — Task นี้เป็นคนเติม body ของ `collectGroundedPricesFromToolText` ที่ Task 1 ประกาศ signature ไว้
- Produces:
```ts
{
  promotions: {
    id: string; name: string; description: string | null;
    endsAt: string;                    // ISO
    appliesTo: 'ALL' | 'SELECTED';     // ALL = ไม่มีเงื่อนไขสินค้า
    minPurchaseThb: number | null;
  }[]
}
```

**กติกาการจับคู่ (deterministic):**
- `conditions` เป็น null / ไม่มีทั้ง `productIds` และ `categories` → **ใช้ได้กับทุกสินค้า** (`appliesTo: 'ALL'`) → ผ่านเสมอ
- มี `productIds` และมี `productId` ที่ขอ → ผ่านเมื่อ `productIds.includes(productId)`
- มี `categories` และหา `product.category` ได้ → ผ่านเมื่อ `categories.includes(category)`
- ระบุ `productId` แต่หาเครื่องไม่เจอ → คืนเฉพาะโปรที่ `appliesTo: 'ALL'` (ปลอดภัยกว่าคืนหมด)
- **ไม่ส่ง `productId` มา** → คืนทุกโปรที่ active (พฤติกรรมเดิม)

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — `apps/api/src/modules/sales-bot/tools/list-promotions.tool.spec.ts`:

```ts
import { PrismaService } from '../../../prisma/prisma.service';
import { ListPromotionsTool } from './list-promotions.tool';

const promo = (over: Record<string, unknown> = {}) => ({
  id: 'promo-1',
  name: 'ลดพิเศษเดือนนี้',
  description: 'ลดทันที 1,000 บาท',
  endDate: new Date('2026-12-31T00:00:00.000Z'),
  conditions: null as unknown,
  ...over,
});

const makePrisma = (promos: unknown[], product: unknown = null) =>
  ({
    promotion: { findMany: jest.fn().mockResolvedValue(promos) },
    product: { findFirst: jest.fn().mockResolvedValue(product) },
  }) as unknown as PrismaService;

describe('ListPromotionsTool.run', () => {
  it('ไม่ส่ง productId → คืนทุกโปรที่ active (พฤติกรรมเดิม)', async () => {
    const tool = new ListPromotionsTool(makePrisma([promo(), promo({ id: 'promo-2' })]));
    const r = await tool.run({});
    expect(r.promotions.map((p) => p.id)).toEqual(['promo-1', 'promo-2']);
  });

  it('conditions ว่าง → appliesTo = ALL และผ่านทุกสินค้า', async () => {
    const tool = new ListPromotionsTool(
      makePrisma([promo()], { id: 'prd-1', category: 'PHONE_NEW' }),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions).toHaveLength(1);
    expect(r.promotions[0].appliesTo).toBe('ALL');
  });

  it('กรองด้วย conditions.productIds', async () => {
    const tool = new ListPromotionsTool(
      makePrisma(
        [
          promo({ id: 'hit', conditions: { productIds: ['prd-1'] } }),
          promo({ id: 'miss', conditions: { productIds: ['prd-9'] } }),
        ],
        { id: 'prd-1', category: 'PHONE_NEW' },
      ),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions.map((p) => p.id)).toEqual(['hit']);
    expect(r.promotions[0].appliesTo).toBe('SELECTED');
  });

  it('กรองด้วย conditions.categories ตามหมวดของเครื่อง', async () => {
    const tool = new ListPromotionsTool(
      makePrisma(
        [
          promo({ id: 'used-only', conditions: { categories: ['PHONE_USED'] } }),
          promo({ id: 'new-only', conditions: { categories: ['PHONE_NEW'] } }),
        ],
        { id: 'prd-1', category: 'PHONE_USED' },
      ),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions.map((p) => p.id)).toEqual(['used-only']);
  });

  it('ส่ง productId แต่หาเครื่องไม่เจอ → เหลือเฉพาะโปรที่ใช้ได้ทุกสินค้า', async () => {
    const tool = new ListPromotionsTool(
      makePrisma(
        [promo({ id: 'all' }), promo({ id: 'scoped', conditions: { productIds: ['prd-1'] } })],
        null,
      ),
    );
    const r = await tool.run({ productId: 'ไม่มีจริง' });
    expect(r.promotions.map((p) => p.id)).toEqual(['all']);
  });

  it('conditions เป็นสตริง/พัง → ไม่ throw และถือว่าใช้ได้ทุกสินค้า', async () => {
    const tool = new ListPromotionsTool(
      makePrisma([promo({ conditions: 'not-an-object' })], { id: 'prd-1', category: 'PHONE_NEW' }),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions).toHaveLength(1);
    expect(r.promotions[0].appliesTo).toBe('ALL');
  });

  it('ส่ง minPurchaseThb ต่อออกมาเมื่อมี', async () => {
    const tool = new ListPromotionsTool(
      makePrisma([promo({ conditions: { minPurchase: 15000 } })], {
        id: 'prd-1',
        category: 'PHONE_NEW',
      }),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions[0].minPurchaseThb).toBe(15000);
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/sales-bot/tools/list-promotions.tool.spec.ts` → แดง (ยังไม่มี `appliesTo`/filter)
- [ ] **Step 3:** implement — เขียนทับ `apps/api/src/modules/sales-bot/tools/list-promotions.tool.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const LIST_PROMOTIONS_TOOL = {
  name: 'list_promotions',
  description:
    'ดูโปรโมชั่นที่ยังไม่หมดอายุ ถ้าส่ง productId มาด้วยจะกรองให้เหลือเฉพาะโปรที่ใช้กับเครื่องนั้นได้จริง. ' +
    'appliesTo=ALL คือใช้ได้ทุกสินค้า, SELECTED คือเจาะจงรุ่น/หมวด. ' +
    'ห้ามสัญญาส่วนลดที่ไม่ได้อยู่ในผลลัพธ์นี้.',
  input_schema: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description: 'id เครื่องจาก search_products — ใส่เมื่อลูกค้าถามโปรของรุ่นที่คุยกันอยู่',
      },
    },
  },
};

interface PromotionConditions {
  minPurchase?: number;
  productIds?: string[];
  categories?: string[];
}

function parseConditions(raw: unknown): PromotionConditions | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  return {
    minPurchase: typeof c.minPurchase === 'number' ? c.minPurchase : undefined,
    productIds: Array.isArray(c.productIds) ? c.productIds.map((v) => String(v)) : undefined,
    categories: Array.isArray(c.categories) ? c.categories.map((v) => String(v)) : undefined,
  };
}

@Injectable()
export class ListPromotionsTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { productId?: string } = {}) {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: { deletedAt: null, isActive: true, startDate: { lte: now }, endDate: { gte: now } },
      take: 10,
      select: { id: true, name: true, description: true, endDate: true, conditions: true },
      orderBy: { endDate: 'asc' },
    });

    const productId = input?.productId?.trim();
    // หาหมวดของเครื่องเพื่อจับคู่ conditions.categories — เครื่องหาไม่เจอ = null
    const product = productId
      ? await this.prisma.product.findFirst({
          where: { id: productId, deletedAt: null },
          select: { id: true, category: true },
        })
      : null;

    const mapped = rows.map((r) => {
      const c = parseConditions(r.conditions);
      const scoped = !!(c?.productIds?.length || c?.categories?.length);
      return {
        row: r,
        conditions: c,
        appliesTo: (scoped ? 'SELECTED' : 'ALL') as 'SELECTED' | 'ALL',
      };
    });

    const filtered = productId
      ? mapped.filter((m) => {
          if (m.appliesTo === 'ALL') return true;
          if (!product) return false; // ระบุเครื่องแต่หาไม่เจอ → เก็บเฉพาะโปรกลาง
          if (m.conditions?.productIds?.includes(product.id)) return true;
          if (m.conditions?.categories?.includes(product.category)) return true;
          return false;
        })
      : mapped;

    return {
      promotions: filtered.slice(0, 5).map((m) => ({
        id: m.row.id,
        name: m.row.name,
        description: m.row.description,
        endsAt: m.row.endDate.toISOString(),
        appliesTo: m.appliesTo,
        minPurchaseThb: m.conditions?.minPurchase ?? null,
      })),
    };
  }
}
```

- [ ] **Step 4:** รันผ่าน: `cd apps/api && npx jest src/modules/sales-bot/tools/list-promotions.tool.spec.ts` → เขียว
- [ ] **Step 5:** เพิ่มเทสต์ grounding ของข้อความโปร ใน `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` — **แทรกก่อน `});` บรรทัดสุดท้าย** (ต้องอยู่ในขอบเขต `build()` เหมือน Task 2):

```ts
describe('grounding จากข้อความที่แอดมินเขียนเอง (B3 Task 6)', () => {
  it('บอทพูดตัวเลขส่วนลดที่อยู่ในคำอธิบายโปรได้ ไม่โดน block', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'list_promotions', input: {} }],
        inputTokens: 5,
        outputTokens: 5,
        modelName: 'claude-sonnet-4-6',
      })
      .mockResolvedValueOnce({
        text: 'เดือนนี้ลดทันที 1,000 บาทค่ะ',
        toolCalls: [],
        inputTokens: 5,
        outputTokens: 5,
        modelName: 'claude-sonnet-4-6',
      });
    const { svc, listPromotions } = await build(chat);
    listPromotions.run.mockResolvedValue({
      promotions: [
        {
          id: 'p1',
          name: 'ลดพิเศษ',
          description: 'ลดทันที 1,000 บาท',
          endsAt: '2026-12-31T00:00:00.000Z',
          appliesTo: 'ALL',
          minPurchaseThb: null,
        },
      ],
    });

    const r = await svc.generateReply({ text: 'มีโปรไหม', roomId: 'r1', customerId: null });
    expect(r.confidence).not.toBe(0.3);
    expect(r.reply).toContain('1,000');
  });
});
```

- [ ] **Step 6:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/sales-bot/sales-bot.service.spec.ts -t "แอดมินเขียนเอง"` → แดง (โดน `unmatched-price=1000` เพราะไม่มี key ราคาในผล tool)
- [ ] **Step 7:** implement — **ใส่ไว้ใน util ไม่ใช่ private method** (Task 8 และ Task 11 เรียกฟังก์ชันตัวเดียวกันนี้; ประกาศไว้แล้วใน Interfaces ของ Task 1):
  - เติม body ใน `apps/api/src/utils/price-grounding.util.ts`:
```ts
/**
 * B3 §5 — บาง tool คืน "ข้อความที่แอดมินพิมพ์เอง" (คำอธิบายโปรโมชั่น, FAQ) ซึ่ง
 * เป็น ground truth ไม่ใช่การเดาของโมเดล ถ้าไม่ดูดเลขบาทจากข้อความพวกนี้เข้า
 * ledger บอทจะโดน guard block ทันทีที่พูดตามโปรที่แอดมินเขียนไว้เอง
 * (อาการเดียวกับ #1337: บอทเงียบโดยไม่มี error ให้เห็น)
 *
 * รองรับ 3 tool: `list_promotions` (Task 6), `search_knowledge_base` (Task 8)
 * — ทั้งบอทขายและน้องเบสมี tool ชื่อเดียวกัน shape เดียวกัน จึงใช้ตัวนี้ได้ทั้งคู่ —
 * และ `calculate_fine` (ฝั่งน้องเบส, Task 11)
 */
export function collectGroundedPricesFromToolText(
  toolName: string,
  result: unknown,
  into: Set<number>,
): void {
  if (result == null || typeof result !== 'object') return;

  if (toolName === 'list_promotions') {
    const promos = (result as { promotions?: unknown }).promotions;
    if (!Array.isArray(promos)) return;
    for (const p of promos) {
      const r = p as { name?: unknown; description?: unknown };
      if (typeof r.name === 'string') collectGroundedPricesFromText(r.name, into);
      if (typeof r.description === 'string') collectGroundedPricesFromText(r.description, into);
    }
    return;
  }

  if (toolName === 'search_knowledge_base') {
    const matches = (result as { matches?: unknown }).matches;
    if (!Array.isArray(matches)) return;
    for (const m of matches) {
      const t = (m as { responseTemplate?: unknown }).responseTemplate;
      if (typeof t === 'string') collectGroundedPricesFromText(t, into);
    }
    return;
  }

  // `calculate_fine` (น้องเบส) ซ่อนตัวเลขไว้ใน `explanation` ที่ interpolate
  // ค่าจาก SystemConfig (`finance-tools.service.ts:143-160`: `${cfg.maxAmount}`,
  // `${cfg.tier1Amount}`, `${cfg.tier2Amount}`) — คีย์เดียวที่เป็นตัวเลขล้วนคือ
  // `totalFine` ⇒ วันที่ owner ตั้ง `late_fee_max_amount` เป็น 4 หลัก (เช่น 1500)
  // น้องเบสจะโดน block ทั้งที่อ่านเลขมาจาก tool ตรง ๆ. explanation ประกอบจาก
  // config ที่ owner ตั้งเอง = ground truth เหมือน KB/โปรโมชั่น
  if (toolName === 'calculate_fine') {
    const explanation = (result as { explanation?: unknown }).explanation;
    if (typeof explanation === 'string') collectGroundedPricesFromText(explanation, into);
  }
}
```
  - ใน `apps/api/src/modules/sales-bot/sales-bot.service.ts`: เพิ่ม `collectGroundedPricesFromToolText` เข้ากับ import util เดิม แล้วใน tool loop ถัดจาก `collectGroundedPrices(result, groundedPrices);` เพิ่ม
    `collectGroundedPricesFromToolText(tc.name, result, groundedPrices);`
  - เพิ่มเคสของ util เองท้าย `apps/api/src/utils/price-grounding.util.spec.ts` (list_promotions ดูดจาก description, search_knowledge_base ดูดจาก responseTemplate, calculate_fine ดูดจาก explanation — เคสนั้นอยู่ใน Task 11, tool ที่ไม่อยู่ใน 3 ตัวนี้ = no-op, result ที่ไม่ใช่ object = ไม่ throw)
- [ ] **Step 8:** รันผ่าน: `cd apps/api && npx jest src/modules/sales-bot` → เขียวทั้ง module
- [ ] **Step 9:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/modules/sales-bot/tools/list-promotions.tool.ts src/modules/sales-bot/sales-bot.service.ts` → ไม่มี error ใหม่
- [ ] **Step 10:** Commit: `feat(bot): list_promotions กรองตามสินค้า/หมวดจริง + ให้บอทพูดเลขในโปรได้ (B3 Task 6)`

---

### Task 7: KB ข้ามช่อง — migration `DROP NOT NULL` + สกอร์เป็น util + knowledge.service รับ channel + admin เลือกช่องได้

> spec §5 + §1: **ไม่มี add-column** — `chat_knowledge_base.channel` มีอยู่แล้ว (`schema.prisma:5177`) ที่ขาดคือ (ก) ยอมให้เป็น `null` = "ใช้ได้ทุกช่อง" (ข) เลิก hardcode `LINE_FINANCE` ใน `knowledge.service.ts:51,165,189,197`

**Files:**
- Create: `apps/api/prisma/migrations/20260983000000_kb_channel_nullable/migration.sql`
- Create: `apps/api/src/utils/kb-match.util.ts`
- Create: `apps/api/src/utils/kb-match.util.spec.ts`
- Modify: `apps/api/prisma/schema.prisma:5177`
- Modify: `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts` (`search` :43-117, `seedDefaults` :150-183, `listAll` :187-192, `create` :194-210, `update` :212-234)
- Modify: `apps/api/src/modules/chatbot-finance/services/knowledge.service.spec.ts` (เพิ่มเคสใหม่ท้ายไฟล์)
- Modify: `apps/api/src/modules/chatbot-finance/dto/admin.dto.ts` (`CreateKbDto` :27-38, `UpdateKbDto` :47-57)
- Modify: `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts:113-135`
- Modify: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` (`KbEntry` :12-24, `EMPTY_FORM` :27-37, `startEdit` :110-121, ฟอร์ม :260-280)

**Interfaces:**
- Produces:
```ts
// apps/api/src/utils/kb-match.util.ts
export interface KbScorableEntry {
  intent: string; category: string; responseTemplate: string; responseType: string;
  triggerKeywords: string[]; exampleQuestions: string[]; priority: number;
}
export interface KbMatch {
  intent: string; category: string; responseTemplate: string; responseType: string; score: number;
}
export function tokenizeThai(text: string): string[];
export function scoreKbEntries(query: string, entries: KbScorableEntry[], take?: number): KbMatch[];
```
```ts
// knowledge.service.ts — signature ใหม่ (channel เป็น optional เพื่อไม่ทำ caller เดิมพัง)
async search(query: string, channel?: ChatChannel): Promise<KbMatch[]>;
async listAll(channel?: ChatChannel): Promise<ChatKnowledgeBase[]>;
async create(input: KbUpsertInput): Promise<ChatKnowledgeBase>;  // KbUpsertInput += channel?: ChatChannel | null
```

- [ ] **Step 1:** เช็กเลข migration ก่อน: `ls apps/api/prisma/migrations | sort | tail -3` → ถ้า max ยังเป็น `20260985000000_*` (ของ B0) ให้ใช้ `20260983000000`; ถ้ามีตัวใหม่แทรกให้เลื่อนเลขทั้ง Task
- [ ] **Step 2:** สร้าง `apps/api/prisma/migrations/20260983000000_kb_channel_nullable/migration.sql`:

```sql
-- B3 §5 — KB ข้ามช่อง: channel = NULL แปลว่า "ใช้ได้ทุกช่องทาง"
-- คอลัมน์นี้มีอยู่แล้ว (default LINE_FINANCE) — งานเดียวคือปลด NOT NULL
-- แถวเดิมไม่ถูกแตะ: ทุกแถวยังเป็น LINE_FINANCE เหมือนเดิม (forward-fix only)
ALTER TABLE "chat_knowledge_base" ALTER COLUMN "channel" DROP NOT NULL;
```

- [ ] **Step 3:** แก้ `apps/api/prisma/schema.prisma:5177`:
```prisma
  /// NULL = ใช้ได้ทุกช่องทาง (B3); ค่า default คงเดิมเพื่อไม่ให้ caller เก่าเปลี่ยนพฤติกรรม
  channel ChatChannel? @default(LINE_FINANCE)
```
  แล้วรัน `cd apps/api && npx prisma generate` (ถ้าต่อ DB dev ได้ให้รัน `npx prisma migrate dev --skip-seed` เพื่อ verify SQL; ถ้าต่อไม่ได้ให้ข้ามและ verify ตอน deploy)
- [ ] **Step 4:** เขียน spec ที่ล้มก่อน — `apps/api/src/utils/kb-match.util.spec.ts`:

```ts
import { tokenizeThai, scoreKbEntries } from './kb-match.util';

const entry = (over: Record<string, unknown> = {}) => ({
  intent: 'late_fee',
  category: 'billing',
  responseTemplate: 'ค่าปรับ 50 บาท/วัน',
  responseType: 'auto',
  triggerKeywords: ['ค่าปรับ', 'ปรับล่าช้า'],
  exampleQuestions: ['ค่าปรับวันละเท่าไหร่'],
  priority: 5,
  ...over,
});

describe('tokenizeThai', () => {
  it('ตัดคำตามช่องว่าง/เครื่องหมาย และทิ้ง token สั้นกว่า 2 ตัว', () => {
    expect(tokenizeThai('ค่าปรับ ล่าช้า a')).toEqual(
      expect.arrayContaining(['ค่าปรับ', 'ล่าช้า']),
    );
    expect(tokenizeThai('ค่าปรับ ล่าช้า a')).not.toContain('a');
  });

  it('แยกคำที่ติดหางอนุภาคไทย (ครับ/ค่ะ/ไหม)', () => {
    expect(tokenizeThai('ค่าปรับเท่าไหร่ครับ')).toEqual(expect.arrayContaining(['ค่าปรับเท่าไหร่']));
  });
});

describe('scoreKbEntries', () => {
  it('คำถามตรง keyword ได้คะแนนสูงสุด', () => {
    const r = scoreKbEntries('ค่าปรับล่าช้า', [entry(), entry({ intent: 'other', triggerKeywords: ['สาขา'] })]);
    expect(r[0].intent).toBe('late_fee');
  });

  it('คำถามว่าง → ไม่มีผลลัพธ์', () => {
    expect(scoreKbEntries('   ', [entry()])).toEqual([]);
  });

  it('ไม่ตรงอะไรเลย → คัดออก (score = 0)', () => {
    expect(scoreKbEntries('ซื้อไอโฟน', [entry()])).toEqual([]);
  });

  it('จำกัดจำนวนผลลัพธ์ตาม take (ค่าเริ่มต้น 3)', () => {
    const many = Array.from({ length: 6 }, (_, i) => entry({ intent: `i${i}` }));
    expect(scoreKbEntries('ค่าปรับ', many)).toHaveLength(3);
    expect(scoreKbEntries('ค่าปรับ', many, 5)).toHaveLength(5);
  });

  it('คืนเฉพาะฟิลด์ที่ปลอดภัยส่งให้โมเดล (ไม่มี id/ช่องทาง)', () => {
    const r = scoreKbEntries('ค่าปรับ', [entry()]);
    expect(Object.keys(r[0]).sort()).toEqual(
      ['category', 'intent', 'responseTemplate', 'responseType', 'score'].sort(),
    );
  });
});
```

- [ ] **Step 5:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/kb-match.util.spec.ts` → `Cannot find module`
- [ ] **Step 6:** implement — `apps/api/src/utils/kb-match.util.ts` โดย **ย้ายโค้ดจาก `knowledge.service.ts:47-117` (สกอร์) และ `:123-143` (tokenize) มาแบบพฤติกรรมเดียวกัน**:

```ts
/**
 * B3 §5 — สกอร์ FAQ ที่บอททั้ง 2 ตัวใช้ร่วมกัน
 *
 * ยกมาจาก `modules/chatbot-finance/services/knowledge.service.ts:47-143`
 * (พฤติกรรมเดิมทุกน้ำหนักคะแนน) เพื่อให้ tool ของบอทขายเรียกใช้ได้
 * โดย **ไม่ต้อง import ChatbotFinanceModule ข้ามฝั่ง** — บอทขายเป็นคนละ
 * pipeline และการ import module การเงินเข้ามาจะลาก LINE client/OTP/สลิป
 * ตามมาทั้งกอง
 */

export interface KbScorableEntry {
  intent: string;
  category: string;
  responseTemplate: string;
  responseType: string;
  triggerKeywords: string[];
  exampleQuestions: string[];
  priority: number;
}

export interface KbMatch {
  intent: string;
  category: string;
  responseTemplate: string;
  responseType: string;
  score: number;
}

const THAI_PARTICLES = [
  'ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้า', 'ไหม', 'หรือ', 'แล้ว', 'ได้', 'ที่',
  'ของ', 'ให้', 'กับ', 'จะ', 'อยาก', 'ต้องการ',
];

export function tokenizeThai(text: string): string[] {
  const tokens = text
    .split(/[\s,.\-!?:;()[\]{}/\\|@#$%^&*+=<>~`'"]+/)
    .filter((t) => t.length >= 2);

  const extraTokens: string[] = [];
  for (const token of tokens) {
    for (const particle of THAI_PARTICLES) {
      const idx = token.indexOf(particle);
      if (idx > 1) {
        extraTokens.push(token.slice(0, idx));
        extraTokens.push(token.slice(idx));
      }
    }
  }
  return [...new Set([...tokens, ...extraTokens])].filter((t) => t.length >= 2);
}

export function scoreKbEntries(
  query: string,
  entries: KbScorableEntry[],
  take = 3,
): KbMatch[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const queryTokens = tokenizeThai(normalized);

  return entries
    .map((e) => {
      let score = 0;
      let keywordMatches = 0;

      for (const kw of e.triggerKeywords) {
        if (normalized.includes(kw.toLowerCase())) {
          score += 3;
          keywordMatches++;
        }
      }

      for (const kw of e.triggerKeywords) {
        const kwLower = kw.toLowerCase();
        for (const token of queryTokens) {
          if (token.length >= 2 && kwLower.includes(token) && !normalized.includes(kwLower)) {
            score += 2;
            break;
          }
        }
      }

      for (const ex of e.exampleQuestions) {
        const exLower = ex.toLowerCase();
        if (normalized.includes(exLower) || exLower.includes(normalized)) {
          score += 1;
        } else {
          const exTokens = tokenizeThai(exLower);
          const overlap = queryTokens.filter(
            (t) => t.length >= 2 && exTokens.some((et) => et.includes(t) || t.includes(et)),
          );
          if (overlap.length >= 2) score += 0.5;
        }
      }

      score += e.priority * 0.05;
      const hasRealMatch = keywordMatches > 0 || score > e.priority * 0.05;

      return {
        intent: e.intent,
        category: e.category,
        responseTemplate: e.responseTemplate,
        responseType: e.responseType,
        score: hasRealMatch ? score : 0,
      };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, take);
}
```

- [ ] **Step 7:** รันผ่าน: `cd apps/api && npx jest src/utils/kb-match.util.spec.ts` → เขียว
- [ ] **Step 8:** เพิ่มเคสใหม่ท้าย `apps/api/src/modules/chatbot-finance/services/knowledge.service.spec.ts`:

```ts
describe('channel ข้ามช่อง (B3 Task 7)', () => {
  it('search ดึงทั้ง FAQ ของช่องนั้นและ FAQ กลาง (channel = null)', async () => {
    await service.search('ค่าปรับ');
    expect(prisma.chatKnowledgeBase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          deletedAt: null,
          OR: [{ channel: null }, { channel: 'LINE_FINANCE' }],
        }),
      }),
    );
  });

  it('search ระบุ channel อื่นได้', async () => {
    await service.search('ค่าปรับ', 'LINE_SHOP' as never);
    const where = prisma.chatKnowledgeBase.findMany.mock.calls.at(-1)![0].where;
    expect(where.OR).toEqual([{ channel: null }, { channel: 'LINE_SHOP' }]);
  });

  it('create ที่ส่ง channel = null → บันทึกเป็น FAQ กลาง', async () => {
    await service.create({
      intent: 'shop_hours',
      category: 'general',
      triggerKeywords: ['เปิดกี่โมง'],
      exampleQuestions: [],
      responseTemplate: 'เปิด 10:00-20:00',
      responseType: 'info',
      channel: null,
    });
    expect(prisma.chatKnowledgeBase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: null }) }),
    );
  });

  it('listAll ไม่ระบุ channel → คืนทุกช่อง (ไม่กรอง)', async () => {
    await service.listAll();
    const where = prisma.chatKnowledgeBase.findMany.mock.calls.at(-1)![0].where;
    expect(where).toEqual({ deletedAt: null });
  });
});
```

- [ ] **Step 9:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/chatbot-finance/services/knowledge.service.spec.ts` → 4 เคสใหม่แดง
- [ ] **Step 10:** implement ใน `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts`:
  - เพิ่ม `import { scoreKbEntries, type KbMatch } from '../../../utils/kb-match.util';` และ **ลบ** `interface KbMatch` (:6-12) + `private tokenize` (:123-143) + บล็อกสกอร์ (:58-112) ทิ้ง แล้ว re-export type เดิมไว้เพื่อไม่ให้ผู้ import พัง: `export type { KbMatch };`
  - `search`:
```ts
  /**
   * ค้นหา FAQ ที่ตรงกับคำถามลูกค้า
   * channel = null ใน DB แปลว่า "ทุกช่องทาง" — จึงดึงมาคู่กับ FAQ ของช่องที่ระบุเสมอ
   */
  async search(query: string, channel: ChatChannel = ChatChannel.LINE_FINANCE): Promise<KbMatch[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const entries = await this.prisma.chatKnowledgeBase.findMany({
      where: {
        OR: [{ channel: null }, { channel }],
        active: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    });

    const scored = scoreKbEntries(normalized, entries);
    if (scored.length > 0) {
      this.logger.log(`[KB] "${query.slice(0, 30)}..." (${channel}) → ${scored.length} match(es)`);
    }
    return scored;
  }
```
  - `KbUpsertInput` เพิ่ม `channel?: ChatChannel | null;`
  - `create`: `channel: input.channel === undefined ? ChatChannel.LINE_FINANCE : input.channel,`
  - `update`: เพิ่ม `...(input.channel !== undefined && { channel: input.channel }),`
  - `listAll`:
```ts
  async listAll(channel?: ChatChannel) {
    return this.prisma.chatKnowledgeBase.findMany({
      where: { deletedAt: null, ...(channel ? { OR: [{ channel: null }, { channel }] } : {}) },
      orderBy: [{ priority: 'desc' }, { intent: 'asc' }],
    });
  }
```
  - `seedDefaults` (:165) คง `channel: ChatChannel.LINE_FINANCE` ไว้เหมือนเดิม (seed ของน้องเบสโดยเฉพาะ)
- [ ] **Step 11:** รันผ่าน: `cd apps/api && npx jest src/modules/chatbot-finance/services/knowledge.service.spec.ts` → **เขียวทั้งไฟล์ รวมเคสเดิม** (ถ้าเคสเดิมแดง = default เพี้ยน ให้แก้โค้ดไม่ใช่แก้ spec)
- [ ] **Step 12:** เปิด API ให้เลือกช่อง — `apps/api/src/modules/chatbot-finance/dto/admin.dto.ts`:
```ts
import { ChatChannel } from '@prisma/client';
// ...ใน CreateKbDto และ UpdateKbDto ทั้งสองตัว:
  @IsOptional() @IsEnum(ChatChannel, { message: 'ช่องทางไม่ถูกต้อง' })
  channel?: ChatChannel | null;
```
  (เพิ่ม `IsEnum` ใน import จาก `class-validator`)
  แล้วใน `chatbot-finance-admin.controller.ts`:
```ts
  @Get('knowledge')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async listKnowledge(@Query('channel') channel?: ChatChannel) {
    return this.knowledge.listAll(channel);
  }
```
  (`@Query` + `ChatChannel` ต้องอยู่ใน import ของไฟล์)
- [ ] **Step 13:** UI — `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx`:
  - `interface KbEntry` (`:12-23`) เพิ่ม `channel: string | null;` — `type FormState = Omit<KbEntry,'id'>` (`:25`) จะได้ฟิลด์นี้ตามอัตโนมัติ
  - `EMPTY_FORM` (`:27-37`) เพิ่ม `channel: 'LINE_FINANCE'`
  - `startEdit` (`:110-123`) copy **`channel: entry.channel`** ตรง ๆ — **ห้ามใช้ `?? ''`**: `''` ไม่ใช่ค่าใน enum `ChatChannel` แล้ว `@IsEnum` ที่ DTO จะตีกลับ 400 ตอนกดบันทึก FAQ กลาง (ค่า "ทุกช่องทาง" ต้องเป็น `null` เท่านั้น)
  - เพิ่ม select ในฟอร์ม (ก่อนช่อง responseType) ใช้ token สีตามกติกา `.claude/rules/frontend.md`:
```tsx
              <div>
                <label className="block text-sm font-medium text-foreground mb-1 leading-snug">
                  ช่องทางที่ใช้ FAQ นี้
                </label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.channel ?? ''}
                  onChange={(e) => setForm({ ...form, channel: e.target.value || null })}
                >
                  <option value="">ทุกช่องทาง (ใช้ได้ทั้งน้องเบสและบอทขาย)</option>
                  <option value="LINE_FINANCE">LINE Finance (น้องเบส)</option>
                  <option value="LINE_SHOP">LINE Shop</option>
                  <option value="FACEBOOK">Facebook</option>
                  <option value="WEB">เว็บไซต์</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">
                  เลือก "ทุกช่องทาง" เมื่อเป็นข้อมูลกลาง เช่น เวลาเปิด-ปิดร้าน ที่อยู่สาขา
                </p>
              </div>
```
  - แสดงป้ายช่องทางในตารางรายการ (คอลัมน์เดียวกับ `responseType` badge): `{kb.channel ?? 'ทุกช่องทาง'}`
- [ ] **Step 14:** `cd apps/api && npx tsc --noEmit` → 0; `cd apps/web && npx tsc --noEmit` → 0; `cd apps/web && npx eslint src/pages/ChatbotFinanceKnowledgePage.tsx` → 0 error
- [ ] **Step 15:** Commit: `feat(kb): FAQ ข้ามช่องได้ (channel nullable + สกอร์เป็น util + เลือกช่องในหน้าแอดมิน) (B3 Task 7)`

---

### Task 8: `search_knowledge_base` ของบอทขาย — Prisma-only ไม่ import module การเงิน

> spec §5: tool นี้ต้องอยู่ในบอทขายด้วย และ **ห้าม import module ข้าม** — บอทขายเรียก Prisma เองแล้วใช้ `kb-match.util` (Task 7) สกอร์

**Files:**
- Create: `apps/api/src/modules/sales-bot/tools/search-knowledge-base.tool.ts`
- Create: `apps/api/src/modules/sales-bot/tools/search-knowledge-base.tool.spec.ts`
- Modify: `apps/api/src/modules/sales-bot/sales-bot.module.ts:20-32`
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.ts` (import tool :4-15, tools array :104-111, constructor :66-76, `runTool` switch :245-273)

**Interfaces:**
- Consumes: `scoreKbEntries(query, entries, take?)` + `KbMatch` จาก `apps/api/src/utils/kb-match.util.ts` (Task 7)
- Produces:
```ts
export const SEARCH_KNOWLEDGE_BASE_TOOL = { name: 'search_knowledge_base'; description: string; input_schema: {...} };
export class SearchKnowledgeBaseTool {
  run(input: { query: string }): Promise<{ matches: KbMatch[] }>;
}
```

**เหตุผลที่ hardcode ชุดช่องทางในตัว tool:** บอทขายวิ่งบน 3 ช่อง (LINE_SHOP / FACEBOOK / WEB) และ `SalesBotInput` (`sales-bot.service.ts:23-28`) **ไม่มีฟิลด์ channel** — จะเดินสาย channel เข้ามาต้องแก้ทั้ง `AiAutoReplyService` + `MessageRouterService` โดยไม่ได้อะไรเพิ่ม (FAQ ของ 3 ช่องนี้เป็นชุดเดียวกันอยู่แล้ว) → query `channel IN (LINE_SHOP, FACEBOOK, WEB) OR channel IS NULL`

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — `apps/api/src/modules/sales-bot/tools/search-knowledge-base.tool.spec.ts`:

```ts
import { PrismaService } from '../../../prisma/prisma.service';
import { SearchKnowledgeBaseTool } from './search-knowledge-base.tool';

const entry = (over: Record<string, unknown> = {}) => ({
  intent: 'shop_hours',
  category: 'general',
  responseTemplate: 'เปิด 10:00-20:00 ทุกวัน',
  responseType: 'info',
  triggerKeywords: ['เปิดกี่โมง', 'เวลาเปิด'],
  exampleQuestions: ['ร้านเปิดกี่โมง'],
  priority: 5,
  ...over,
});

const makePrisma = (rows: unknown[]) =>
  ({ chatKnowledgeBase: { findMany: jest.fn().mockResolvedValue(rows) } }) as unknown as PrismaService;

describe('SearchKnowledgeBaseTool.run', () => {
  it('ดึง FAQ ของช่องบอทขาย + FAQ กลาง (channel = null)', async () => {
    const prisma = makePrisma([]);
    await new SearchKnowledgeBaseTool(prisma).run({ query: 'เปิดกี่โมง' });
    const where = (prisma.chatKnowledgeBase.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [{ channel: null }, { channel: { in: ['LINE_SHOP', 'FACEBOOK', 'WEB'] } }],
      active: true,
      deletedAt: null,
    });
  });

  it('คืน match ที่สกอร์แล้ว', async () => {
    const r = await new SearchKnowledgeBaseTool(makePrisma([entry()])).run({ query: 'ร้านเปิดกี่โมง' });
    expect(r.matches[0].intent).toBe('shop_hours');
    expect(r.matches[0].responseTemplate).toContain('10:00');
  });

  it('คำค้นว่าง → ไม่ยิง DB', async () => {
    const prisma = makePrisma([entry()]);
    const r = await new SearchKnowledgeBaseTool(prisma).run({ query: '  ' });
    expect(r.matches).toEqual([]);
    expect(prisma.chatKnowledgeBase.findMany).not.toHaveBeenCalled();
  });

  it('ไม่มี FAQ ตรงเลย → matches ว่าง (ไม่ throw)', async () => {
    const r = await new SearchKnowledgeBaseTool(makePrisma([entry()])).run({ query: 'ผ่อนไอโฟน' });
    expect(r.matches).toEqual([]);
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/sales-bot/tools/search-knowledge-base.tool.spec.ts`
- [ ] **Step 3:** implement — `apps/api/src/modules/sales-bot/tools/search-knowledge-base.tool.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { scoreKbEntries, type KbMatch } from '../../../utils/kb-match.util';

export const SEARCH_KNOWLEDGE_BASE_TOOL = {
  name: 'search_knowledge_base',
  description:
    'ค้น FAQ ที่แอดมินเขียนไว้ (เวลาเปิด-ปิด, ที่อยู่สาขา, เงื่อนไขประกัน, วิธีผ่อน, เอกสารที่ต้องใช้ ฯลฯ) ' +
    'ใช้เมื่อคำถามไม่เกี่ยวกับสต็อก/ราคาเครื่องโดยตรง หรือเมื่อไม่แน่ใจคำตอบ — ' +
    'ตอบตาม responseTemplate ที่ได้มา ห้ามแต่งเงื่อนไขเอง. ไม่เจอ → matches: []',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'คำถามของลูกค้า หรือคีย์เวิร์ดที่จะค้น' },
    },
    required: ['query'],
  },
};

/**
 * B3 §5 — FAQ สำหรับบอทขาย
 *
 * ตั้งใจ **ไม่** inject `KnowledgeService` ของ chatbot-finance: การ import
 * ChatbotFinanceModule เข้ามาจะลาก LINE client / OTP / slip pipeline ตามมาทั้งกอง
 * และผูกบอทขายเข้ากับ lifecycle ของอีก pipeline หนึ่ง — ที่ต้องใช้ร่วมกันจริง ๆ
 * มีแค่ "กติกาการให้คะแนน" ซึ่งอยู่ใน `utils/kb-match.util.ts` แล้ว
 */
const SALES_BOT_CHANNELS: ChatChannel[] = [
  ChatChannel.LINE_SHOP,
  ChatChannel.FACEBOOK,
  ChatChannel.WEB,
];

@Injectable()
export class SearchKnowledgeBaseTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { query: string }): Promise<{ matches: KbMatch[] }> {
    const query = String(input?.query ?? '').trim();
    if (!query) return { matches: [] };

    const entries = await this.prisma.chatKnowledgeBase.findMany({
      where: {
        // channel = null คือ FAQ กลางที่ใช้ได้ทุกช่อง (B3 Task 7)
        OR: [{ channel: null }, { channel: { in: SALES_BOT_CHANNELS } }],
        active: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    });

    return { matches: scoreKbEntries(query, entries) };
  }
}
```

- [ ] **Step 4:** ลงทะเบียนใน `apps/api/src/modules/sales-bot/sales-bot.module.ts`: import `SearchKnowledgeBaseTool` แล้วเพิ่มใน `providers` (หลัง `GetInstallmentRatesTool`) — **ไม่ต้อง export** (ใช้ภายใน SalesBotService เท่านั้น; น้องเบสจะ provide เองใน Task 10)
- [ ] **Step 5:** ต่อเข้า `SalesBotService`:
  - import `{ SearchKnowledgeBaseTool, SEARCH_KNOWLEDGE_BASE_TOOL }`
  - เพิ่ม `SEARCH_KNOWLEDGE_BASE_TOOL,` ท้าย array `tools` (:104-111)
  - เพิ่ม `private readonly searchKnowledgeBase: SearchKnowledgeBaseTool,` ใน constructor
  - เพิ่มใน `runTool` switch:
```ts
      case 'search_knowledge_base':
        return this.searchKnowledgeBase.run({ query: String(input.query ?? '') });
```
  - **ไม่ต้องแก้อะไรเพิ่มเรื่อง grounding** — `collectGroundedPricesFromToolText` (Task 6) ครอบ `search_knowledge_base` ไว้แล้วในตัว util และ `SalesBotService` เรียกมันด้วย `tc.name` ทุก tool อยู่แล้ว → FAQ ที่แอดมินเขียนว่า "ค่ามัดจำ 3,000 บาท" จะ groundable อัตโนมัติ. ให้ยืนยันด้วยเทสต์ Step 6 เท่านั้น
- [ ] **Step 6:** แก้ helper `build()` ใน `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` แล้วเพิ่มเทสต์ (**แทรกก่อน `});` บรรทัดสุดท้าย** เหมือน Task 2/6):
  - ใน `build()` (`:17-64`) เพิ่ม `const searchKnowledgeBase = { run: jest.fn() };`, provider `{ provide: SearchKnowledgeBaseTool, useValue: searchKnowledgeBase },` (ต่อจาก `GetInstallmentRatesTool`) และเพิ่ม `searchKnowledgeBase` ใน object ที่ `return` (`:53-63`)
  - เพิ่ม `import { SearchKnowledgeBaseTool } from './tools/search-knowledge-base.tool';` ที่หัวไฟล์
  - ⚠️ **ลำดับ provider ใน `Test.createTestingModule` ไม่สำคัญ แต่ลำดับ argument ใน constructor สำคัญ** — เคส `describe('estimateConfidence (reworked)')` (`:206-239`) `new SalesBotService(...)` ด้วย positional `{} as any` **9 ตัว**; เพิ่ม tool ใหม่เป็น argument ที่ 10 → ต้องเติม `{} as any` อีก 1 ตัวในนั้น ไม่งั้นเป็น `undefined` (ไม่พังทันทีเพราะ path นี้ไม่แตะ tool แต่ให้เติมไว้กันงง)

```ts
describe('search_knowledge_base ในบอทขาย (B3 Task 8)', () => {
  it('บอทตอบตัวเลขที่อยู่ใน FAQ ได้โดยไม่โดน grounding block', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'search_knowledge_base', input: { query: 'มัดจำ' } }],
        inputTokens: 5,
        outputTokens: 5,
        modelName: 'claude-sonnet-4-6',
      })
      .mockResolvedValueOnce({
        text: 'ค่ามัดจำ 3,000 บาทค่ะ คืนให้เมื่อรับเครื่อง',
        toolCalls: [],
        inputTokens: 5,
        outputTokens: 5,
        modelName: 'claude-sonnet-4-6',
      });
    const { svc, searchKnowledgeBase } = await build(chat);
    searchKnowledgeBase.run.mockResolvedValue({
      matches: [
        {
          intent: 'deposit',
          category: 'general',
          responseTemplate: 'ค่ามัดจำ 3,000 บาท คืนเมื่อรับเครื่อง',
          responseType: 'info',
          score: 3,
        },
      ],
    });

    const r = await svc.generateReply({ text: 'มัดจำเท่าไหร่', roomId: 'r1', customerId: null });
    expect(r.confidence).not.toBe(0.3);
    expect(r.toolsUsed).toContain('search_knowledge_base');
  });
});
```
- [ ] **Step 7:** รันผ่าน: `cd apps/api && npx jest src/modules/sales-bot` → เขียวทั้ง module
- [ ] **Step 8:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/modules/sales-bot` → ไม่มี error ใหม่
- [ ] **Step 9:** Commit: `feat(bot): บอทขายค้น FAQ ได้ (search_knowledge_base, Prisma-only ไม่ข้าม module) (B3 Task 8)`

---

### Task 9: ส่งรูปสินค้าถึงลูกค้าจริง — thread `attachments` ผ่าน AiAutoReply → MessageRouter (text ก่อน แล้วตามด้วย IMAGE)

> spec §5: "router ส่ง text ก่อน (replyToken) แล้วตาม IMAGE bubble ผ่าน adapter + persist type/mediaUrl ให้ครบ"
> ⚠️ **LINE reply token ใช้ได้ครั้งเดียว** — ข้อความแรกกินไป bubble ถัดไปต้องเป็น push (adapter fallback ให้เองที่ `line-shop.adapter.ts:41-52`)

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts:103-146` (`autoReply` ส่ง `attachments` ต่อ)
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts:180-200` (+ private method ใหม่)
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts` (เพิ่ม describe ใหม่ท้ายไฟล์)

**Interfaces:**
- Consumes:
  - `SalesBotResult.attachments?: { productId: string; imageUrl?: string; webUrl?: string }[]` (Task 2)
  - `IChannelAdapter.sendMessage(message: OutboundMessage): Promise<SendResult>` — `chat-engine/interfaces/channel-adapter.interface.ts:109`; `OutboundMessage.imageUrl` มีอยู่แล้ว (:70) และ adapter รองรับครบ: LINE (`line-shop.adapter.ts:70-76` → `type:'image'`), FB (`facebook.adapter.ts:72-77` → `attachment.image`), WEB (stub คืน `{success:true}` — `web-widget.adapter.ts:23-29`)
  - `RoomManagerService.saveMessage({ roomId, externalMessageId?, role, type?, text?, mediaUrl?, ... })` — `room-manager.service.ts:214-231`
- Produces: ไม่มี public API ใหม่ (พฤติกรรมเท่านั้น)

**ข้อจำกัดที่ยอมรับ (บันทึกไว้ ไม่ใช่ช่องโหว่):**
- ช่อง **WEB** — adapter เป็น stub (ไม่ส่งจริง) แต่ `saveMessage` ยังเขียน `type: IMAGE` + `mediaUrl` → widget ที่อ่านจาก DB จะ render รูปได้ ตรงกับที่ spec §5 ระบุ ("WEB adapter เป็น stub — ฝั่งเว็บ widget อาศัย saveMessage")
- attachment ที่ **ไม่มี `imageUrl`** (มีแต่ `webUrl`) จะ **ไม่ถูกส่งเป็น bubble** — ลิงก์ควรอยู่ในข้อความที่โมเดลเขียน ไม่ใช่ bubble เปล่า
- การส่งรูป **ไม่มี idempotency** (ไม่มี `clientMessageId` ในเส้นทางบอท) — ยอมรับได้เพราะ trigger คือข้อความลูกค้า 1 ครั้ง ไม่ใช่ปุ่มที่ staff กดซ้ำได้ (ต่างจากเส้นทาง B2)

- [ ] **Step 1:** เขียนเทสต์ที่ล้มก่อน — ต่อท้าย `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts`:

```ts
describe('MessageRouterService — ส่งรูปสินค้าตามคำตอบบอท (B3 Task 9)', () => {
  const aiWithAttachments = {
    reply: 'iPhone 15 128GB ราคา 28,900 บาทค่ะ',
    confidence: 0.95,
    toolsUsed: ['search_products'],
    inputTokens: 1,
    outputTokens: 1,
    attachments: [
      { productId: 'prd-1', imageUrl: 'https://cdn.example.com/p1.jpg', webUrl: 'https://s/p1' },
    ],
  };

  it('ส่งข้อความก่อน (ใช้ replyToken) แล้วค่อยส่งรูป (ไม่มี replyToken)', async () => {
    const { router, adapter } = makeRouter({ aiEligible: true, aiResult: aiWithAttachments });
    await router.routeInbound(baseMsg as any);

    expect(adapter.sendMessage).toHaveBeenCalledTimes(2);
    const [first, second] = adapter.sendMessage.mock.calls.map((c: any[]) => c[0]);
    expect(first).toMatchObject({ type: MessageType.TEXT, replyToken: 'rt-1' });
    expect(second).toMatchObject({
      type: MessageType.IMAGE,
      imageUrl: 'https://cdn.example.com/p1.jpg',
    });
    expect(second.replyToken).toBeUndefined();
  });

  it('บันทึกข้อความรูปลง DB พร้อม type/mediaUrl (widget ฝั่งเว็บอาศัยแถวนี้)', async () => {
    const { router, roomManager } = makeRouter({ aiEligible: true, aiResult: aiWithAttachments });
    await router.routeInbound(baseMsg as any);

    expect(roomManager.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.IMAGE,
        mediaUrl: 'https://cdn.example.com/p1.jpg',
      }),
    );
  });

  it('attachment ที่ไม่มีรูป (มีแต่ลิงก์) → ไม่ส่ง bubble เพิ่ม', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: { ...aiWithAttachments, attachments: [{ productId: 'prd-1', webUrl: 'https://s/p1' }] },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี attachments → พฤติกรรมเดิมทุกอย่าง (ส่งข้อความเดียว)', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: { reply: 'มีค่ะ', confidence: 0.9, toolsUsed: [], inputTokens: 1, outputTokens: 1 },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ส่งรูปล้มเหลว → ไม่ทำให้ทั้ง flow พัง และไม่ตอบซ้ำ', async () => {
    const { router, adapter, aiAutoReply } = makeRouter({
      aiEligible: true,
      aiResult: aiWithAttachments,
    });
    adapter.sendMessage
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('LINE 500'));

    await expect(router.routeInbound(baseMsg as any)).resolves.toBeUndefined();
    expect(aiAutoReply.logAutoReply).toHaveBeenCalledWith(
      expect.objectContaining({ autoSent: true }),
    );
  });

  it('ส่งรูปมากสุด 2 ใบ', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: {
        ...aiWithAttachments,
        attachments: [
          { productId: 'a', imageUrl: 'https://c/a.jpg' },
          { productId: 'b', imageUrl: 'https://c/b.jpg' },
          { productId: 'c', imageUrl: 'https://c/c.jpg' },
        ],
      },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(3); // 1 text + 2 image
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/chat-engine/services/message-router.service.spec.ts` → เคสใหม่แดง (`sendMessage` ถูกเรียกครั้งเดียว)
- [ ] **Step 3:** ส่ง `attachments` ต่อจาก `AiAutoReplyService` — ใน `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` แก้ return ของ `autoReply` (:139-145):

```ts
    return {
      reply: result.reply,
      confidence: result.confidence,
      toolsUsed: result.toolsUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      // B3 §5 — รูป/ลิงก์ที่บอทเก็บมาจากผล tool (deterministic) ให้ router ส่งต่อ
      ...(result.attachments?.length ? { attachments: result.attachments } : {}),
    };
```
  (return type `({ reply; confidence } & Partial<SalesBotResult>) | null` ครอบ `attachments` ให้อยู่แล้วเพราะ `SalesBotResult` มีฟิลด์นี้แล้วจาก Task 2 — ไม่ต้องแก้ signature)

- [ ] **Step 4:** implement ใน `apps/api/src/modules/chat-engine/services/message-router.service.ts` — ในบล็อก AI auto-reply (:183-200) ต่อท้าย `saveMessage` เดิม:

```ts
            // B3 §5 — ส่งรูปสินค้าตามหลังข้อความ (best-effort)
            await this.sendBotAttachments(adapter, message, room.id, result.attachments);
```
  แล้วเพิ่ม private method (วางใกล้ ๆ `sendStaffMessage`):

```ts
  /**
   * B3 §5 — ส่ง IMAGE bubble ตามหลังคำตอบบอท
   *
   * ต้องส่ง "หลัง" ข้อความเสมอ: LINE reply token ใช้ได้ครั้งเดียวและถูกใช้ไปกับ
   * ข้อความแรกแล้ว — bubble ถัดไปจึงไม่ส่ง replyToken (adapter จะ push ให้เอง)
   *
   * best-effort ทั้งก้อน: รูปส่งไม่ได้ต้องไม่ทำให้คำตอบที่ส่งไปแล้วกลายเป็น error
   * และต้องไม่ปล่อยให้หลุดไปเส้นทาง domain-handler (จะกลายเป็นตอบซ้ำ)
   */
  private async sendBotAttachments(
    adapter: IChannelAdapter,
    message: InboundMessage,
    roomId: string,
    attachments?: { productId: string; imageUrl?: string; webUrl?: string }[],
  ): Promise<void> {
    if (!attachments?.length) return;
    for (const att of attachments.slice(0, 2)) {
      if (!att.imageUrl) continue;
      try {
        const sendResult = await adapter.sendMessage({
          externalUserId: message.externalUserId,
          channel: message.channel,
          type: MessageType.IMAGE,
          imageUrl: att.imageUrl,
        });
        await this.roomManager.saveMessage({
          roomId,
          externalMessageId: sendResult.externalMessageId,
          role: MessageRole.BOT,
          type: MessageType.IMAGE,
          // `text` ต้องมีค่า — room-list preview อ่านจากคอลัมน์นี้ ถ้าปล่อย null
          // ห้องจะแสดง preview ว่างหลังบอทส่งรูป (ใช้ค่าเดียวกับฝั่งน้องเบส Task 12)
          text: '[image]',
          mediaUrl: att.imageUrl,
          intent: 'AUTO:sales:image',
        });
        if (!sendResult.success) {
          this.logger.warn(
            `[AiAutoReply] image send failed room=${roomId} product=${att.productId}: ${sendResult.error}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `[AiAutoReply] image send threw room=${roomId} product=${att.productId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
```
  (`MessageType`, `IChannelAdapter`, `InboundMessage` ถูก import อยู่แล้วที่ :3-9 — ไม่ต้องเพิ่ม import)

- [ ] **Step 5:** รันผ่าน: `cd apps/api && npx jest src/modules/chat-engine` → **เขียวทั้ง module รวมเคสเดิม** (เคสเดิมใช้ `toHaveBeenCalledWith` ไม่ใช่ `Times` จึงไม่ควรแดง — ถ้าแดงให้ดูว่าเราส่ง bubble ตอนที่ไม่ควรส่ง)
- [ ] **Step 6:** `cd apps/api && npx jest src/modules/staff-chat/services/ai-auto-reply.service.spec.ts` → เขียว
- [ ] **Step 7:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/modules/chat-engine/services/message-router.service.ts src/modules/staff-chat/services/ai-auto-reply.service.ts` → ไม่มี error ใหม่
- [ ] **Step 8:** Commit: `feat(bot): บอทส่งรูปสินค้าถึงลูกค้าได้ (text ก่อน แล้วตาม IMAGE bubble) (B3 Task 9)`

---

### Task 10: น้องเบสตอบสินค้าได้ — เพิ่ม product tools 3 จุด mechanical (ห้ามแตะ MessageRouter)

> spec §0/§5: **น้องเบสไม่ผ่าน MessageRouter** — pipeline จริงคือ webhook → `ChatbotFinanceService` → `FinanceAiService` → `lineClient.replyMessage` (`finance-domain.handler.ts` เป็น stub) → การไปยุ่งกับ router ไม่มีผลกับน้องเบสเลย
> การเพิ่ม tool ให้น้องเบสมี **3 จุดบังคับ** (ถ้าลืมจุดใดจุดหนึ่งจะ fail เงียบ): `TOOL_INPUT_VALIDATORS` allowlist → `ToolName` + executor switch → providers

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/tools/tool-definitions.ts` (`FINANCE_TOOLS` :11-115, `ToolName` :117-124)
- Modify: `apps/api/src/modules/chatbot-finance/tools/tool-input-schemas.ts` (+3 validator, `TOOL_INPUT_VALIDATORS` :90-98)
- Modify: `apps/api/src/modules/chatbot-finance/tools/tool-executor.ts` (constructor :35-39, switch :66-112)
- Modify: `apps/api/src/modules/chatbot-finance/tools/tool-executor.spec.ts` (:39-45 providers — ไม่งั้นทุกเคสแดง)
- Modify: `apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts:54-79`
- Modify: `apps/api/src/modules/chatbot-finance/prompts/system-prompt.ts` (constant `FINANCE_BOT_SYSTEM_PROMPT` — เติมบล็อก "ตอบเรื่องสินค้าได้ด้วย" จาก Deployment & Verification)

**Interfaces:**
- Consumes (import **class ตรง ๆ ไม่ import `SalesBotModule`**):
```ts
import { SearchProductsTool } from '../sales-bot/tools/search-products.tool';
import { CalculateInstallmentTool } from '../sales-bot/tools/calculate-installment.tool';
import { ListPromotionsTool } from '../sales-bot/tools/list-promotions.tool';
```
  ทั้ง 3 คลาสรับ `PrismaService` ตัวเดียวใน constructor และ `PrismaModule` เป็น `@Global()` (`apps/api/src/prisma/prisma.module.ts:5`) → ประกาศเป็น provider ใน `ChatbotFinanceModule` ได้เลย **ห้าม `imports: [SalesBotModule]`** เพราะ `SalesBotModule` ลาก `forwardRef(() => StaffChatModule)` + LLM provider registry ตามมาทั้งกอง (`sales-bot.module.ts:14-32`)
- Produces: `ToolName` += `'search_products' | 'calculate_installment' | 'list_promotions'`

- [ ] **Step 1:** เขียนเทสต์ที่ล้มก่อน — ต่อท้าย `apps/api/src/modules/chatbot-finance/tools/tool-executor.spec.ts` (และ**แก้ `Test.createTestingModule` เดิมให้มี provider ใหม่ครบ** ไม่งั้นทุกเคสแดง):

```ts
describe('product tools ของน้องเบส (B3 Task 10)', () => {
  it('search_products ส่ง query ต่อให้ tool', async () => {
    searchProducts.run.mockResolvedValue({ query: {}, totalMatches: 0, priceMissingCount: 0, groups: [] });
    const r = await executor.execute(
      { name: 'search_products', input: { query: 'ไอโฟน 15' } },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(searchProducts.run).toHaveBeenCalledWith({ query: 'ไอโฟน 15' });
  });

  it('search_products ปฏิเสธ query ที่ไม่ใช่ string (prompt injection)', async () => {
    const r = await executor.execute({ name: 'search_products', input: { query: 42 } }, ctx);
    expect(r.ok).toBe(false);
    expect(searchProducts.run).not.toHaveBeenCalled();
  });

  it('calculate_installment ต้องมี productId + tenureMonths', async () => {
    const bad = await executor.execute(
      { name: 'calculate_installment', input: { productId: 'p1' } },
      ctx,
    );
    expect(bad.ok).toBe(false);

    calcInstallment.run.mockResolvedValue({ monthlyThb: 3113 });
    const ok = await executor.execute(
      { name: 'calculate_installment', input: { productId: 'p1', tenureMonths: 12, downPct: 20 } },
      ctx,
    );
    expect(ok.ok).toBe(true);
    expect(calcInstallment.run).toHaveBeenCalledWith({
      productId: 'p1',
      tenureMonths: 12,
      downPct: 20,
    });
  });

  it('calculate_installment ปฏิเสธ tenureMonths นอกช่วง 1-60', async () => {
    const r = await executor.execute(
      { name: 'calculate_installment', input: { productId: 'p1', tenureMonths: 999 } },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it('list_promotions ทำงานได้ทั้งแบบมีและไม่มี productId', async () => {
    listPromotions.run.mockResolvedValue({ promotions: [] });
    expect((await executor.execute({ name: 'list_promotions', input: {} }, ctx)).ok).toBe(true);
    expect(
      (await executor.execute({ name: 'list_promotions', input: { productId: 'p1' } }, ctx)).ok,
    ).toBe(true);
  });

  it('tool ที่ไม่รู้จักยังถูกปฏิเสธเหมือนเดิม', async () => {
    const r = await executor.execute({ name: 'delete_everything', input: {} }, ctx);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/chatbot-finance/tools/tool-executor.spec.ts` → แดง
- [ ] **Step 3:** **จุดที่ 1/3** — `apps/api/src/modules/chatbot-finance/tools/tool-definitions.ts`:
  - เพิ่ม adapter (สาเหตุที่ต้องแคสต์: ค่าคงที่ฝั่ง sales-bot ประกาศ `input_schema` เป็น object ธรรมดา TypeScript จึง infer `type: string` ไม่ใช่ literal `'object'` ที่ `Tool` ต้องการ):
```ts
import { SEARCH_PRODUCTS_TOOL } from '../../sales-bot/tools/search-products.tool';
import { CALCULATE_INSTALLMENT_TOOL } from '../../sales-bot/tools/calculate-installment.tool';
import { LIST_PROMOTIONS_TOOL } from '../../sales-bot/tools/list-promotions.tool';

/** ค่าคงที่ tool ของบอทขายเป็น Anthropic shape อยู่แล้ว — ต้องแคสต์ literal type เท่านั้น */
function asAnthropicTool(t: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}): Tool {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Tool['input_schema'],
  };
}
```
  - ต่อท้าย `FINANCE_TOOLS`:
```ts
  // B3 §5 — น้องเบสตอบเรื่องสินค้าได้ด้วย (ลูกค้าผ่อนอยู่มักถามเครื่องใหม่ในห้องเดิม)
  // ใช้ tool ตัวเดียวกับบอทขาย: ราคา/ค่างวดจึงตรงกันทุกช่องโดยอัตโนมัติ
  asAnthropicTool(SEARCH_PRODUCTS_TOOL),
  asAnthropicTool(CALCULATE_INSTALLMENT_TOOL),
  asAnthropicTool(LIST_PROMOTIONS_TOOL),
```
  - ขยาย `ToolName`:
```ts
export type ToolName =
  | 'get_current_balance'
  | 'get_payment_schedule'
  | 'calculate_fine'
  | 'list_recent_receipts'
  | 'get_bank_info'
  | 'search_knowledge_base'
  | 'handoff_to_human'
  | 'search_products'
  | 'calculate_installment'
  | 'list_promotions';
```
- [ ] **Step 4:** **จุดที่ 2/3** — `apps/api/src/modules/chatbot-finance/tools/tool-input-schemas.ts` เพิ่ม 3 validator แล้วลงทะเบียนใน `TOOL_INPUT_VALIDATORS`:

```ts
function searchProductsInput(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const query = input.query;
    if (typeof query !== 'string') return { ok: false, error: 'query ต้องเป็น string' };
    const trimmed = query.trim();
    if (trimmed.length === 0) return { ok: false, error: 'query ห้ามว่าง' };
    if (trimmed.length > 200) return { ok: false, error: 'query ยาวเกินไป (สูงสุด 200 ตัวอักษร)' };
    const value: Record<string, unknown> = { query: trimmed };
    const cap = input.maxPriceThb;
    if (cap !== undefined) {
      if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0 || cap > 10_000_000) {
        return { ok: false, error: 'maxPriceThb ต้องเป็นตัวเลข 1-10,000,000' };
      }
      value.maxPriceThb = cap;
    }
    return { ok: true, value };
  };
}

function calculateInstallmentInput(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const productId = input.productId;
    if (typeof productId !== 'string' || productId.trim().length === 0 || productId.length > 64) {
      return { ok: false, error: 'productId ต้องเป็น string ไม่เกิน 64 ตัวอักษร' };
    }
    const tenure = input.tenureMonths;
    if (typeof tenure !== 'number' || !Number.isInteger(tenure) || tenure < 1 || tenure > 60) {
      return { ok: false, error: 'tenureMonths ต้องเป็นจำนวนเต็ม 1-60' };
    }
    const value: Record<string, unknown> = { productId: productId.trim(), tenureMonths: tenure };
    const downPct = input.downPct;
    if (downPct !== undefined) {
      if (typeof downPct !== 'number' || !Number.isFinite(downPct) || downPct < 0 || downPct > 100) {
        return { ok: false, error: 'downPct ต้องเป็นตัวเลข 0-100' };
      }
      value.downPct = downPct;
    }
    return { ok: true, value };
  };
}

function listPromotionsInput(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const productId = input.productId;
    if (productId === undefined) return { ok: true, value: {} };
    if (typeof productId !== 'string' || productId.length > 64) {
      return { ok: false, error: 'productId ต้องเป็น string ไม่เกิน 64 ตัวอักษร' };
    }
    return { ok: true, value: { productId: productId.trim() } };
  };
}
```
```ts
const TOOL_INPUT_VALIDATORS: Record<ToolName, Validator> = {
  // ...ของเดิม 7 ตัว
  search_products: searchProductsInput(),
  calculate_installment: calculateInstallmentInput(),
  list_promotions: listPromotionsInput(),
};
```
> `Record<ToolName, Validator>` เป็น exhaustive map — ถ้าเพิ่ม `ToolName` แล้วลืมเพิ่ม validator **tsc จะแดงทันที** (นี่คือเหตุผลที่ต้องแก้ 2 ไฟล์นี้คู่กันเสมอ)

- [ ] **Step 5:** **จุดที่ 3/3** — `apps/api/src/modules/chatbot-finance/tools/tool-executor.ts`:
  - constructor เพิ่ม 3 ตัว:
```ts
  constructor(
    private tools: FinanceToolsService,
    private knowledge: KnowledgeService,
    private handoff: HandoffService,
    // B3 §5 — tool เดียวกับบอทขาย (import class ตรง ไม่ import SalesBotModule)
    private searchProducts: SearchProductsTool,
    private calcInstallment: CalculateInstallmentTool,
    private listPromotions: ListPromotionsTool,
  ) {}
```
  - เพิ่มใน switch ก่อน `default:`:
```ts
        case 'search_products': {
          const data = await this.searchProducts.run(
            input as { query: string; maxPriceThb?: number },
          );
          return { ok: true, data };
        }

        case 'calculate_installment': {
          const data = await this.calcInstallment.run(
            input as { productId: string; downPct?: number; tenureMonths: number },
          );
          return { ok: true, data };
        }

        case 'list_promotions': {
          const data = await this.listPromotions.run(input as { productId?: string });
          return { ok: true, data };
        }
```
  - KB: เปลี่ยน `this.knowledge.search(query)` (:93) → `this.knowledge.search(query, ChatChannel.LINE_FINANCE)` (ชัดเจนว่าอยู่ช่องไหน + ได้ FAQ กลางมาด้วยจาก Task 7) พร้อม import `ChatChannel`
- [ ] **Step 6:** ลงทะเบียน provider — `apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts` เพิ่มใน `providers` (import 3 class จาก `../sales-bot/tools/...`); **ห้ามแตะ `imports`**
- [ ] **Step 6b:** เติมบล็อก "ตอบเรื่องสินค้าได้ด้วย" (ข้อความเต็มอยู่ใน Deployment & Verification) ลงใน constant `FINANCE_BOT_SYSTEM_PROMPT` — `apps/api/src/modules/chatbot-finance/prompts/system-prompt.ts`.
  เหตุผลที่ต้องทำในโค้ดด้วยทั้งที่ prod อ่านจาก DB: `getSystemPrompt()` fallback มาที่ constant นี้เมื่อ **ไม่มีแถว** `finance_bot_system_prompt` (env ใหม่ / local dev / prod ที่ยังไม่เคยตั้ง) — ถ้าแก้แต่ DB น้องเบสบน local จะไม่มีวันเรียก tool ใหม่ และ QA ข้อ 3 จะสอบตกโดยไม่มีสาเหตุที่มองเห็น
- [ ] **Step 7:** แก้ `tool-executor.spec.ts` ให้ครบ 3 จุด (ไม่งั้น Nest resolve ไม่ได้ = **ทุกเคสในไฟล์แดง** ไม่ใช่แค่เคสใหม่):
  1. หัวไฟล์ (ต่อจาก import `HandoffService` `:6`):
```ts
import { SearchProductsTool } from '../../sales-bot/tools/search-products.tool';
import { CalculateInstallmentTool } from '../../sales-bot/tools/calculate-installment.tool';
import { ListPromotionsTool } from '../../sales-bot/tools/list-promotions.tool';
```
  2. ประกาศตัวแปรใน `describe` (ต่อจาก `let handoff: any;` `:20`) — ตัวแปรพวกนี้คือตัวที่เคสใหม่ใน Step 1 เรียกใช้:
```ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let searchProducts: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let calcInstallment: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listPromotions: any;
```
  3. ใน `beforeEach` (`:24-49`) เพิ่ม mock + provider:
```ts
    searchProducts = { run: jest.fn() };
    calcInstallment = { run: jest.fn() };
    listPromotions = { run: jest.fn() };
    // ...ใน providers ต่อจาก { provide: HandoffService, useValue: handoff }:
        { provide: SearchProductsTool, useValue: searchProducts },
        { provide: CalculateInstallmentTool, useValue: calcInstallment },
        { provide: ListPromotionsTool, useValue: listPromotions },
```
  > `executor` / `ctx` เป็นตัวแปรระดับ `describe('FinanceToolExecutor')` ที่ครอบทั้งไฟล์ → describe ใหม่ของ Step 1 **ต่อท้ายไฟล์ (ก่อน `});` บรรทัดสุดท้าย) ได้**
- [ ] **Step 8:** รันผ่าน: `cd apps/api && npx jest src/modules/chatbot-finance` → เขียวทั้ง module
- [ ] **Step 9:** ยืนยันว่าไม่ได้ import module ข้ามกัน: `grep -rn "SalesBotModule" apps/api/src/modules/chatbot-finance/` → **ต้องไม่มีผลลัพธ์** (`-r` จำเป็น — `grep` เปล่ากับ directory จะ error `Is a directory`)
- [ ] **Step 10:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/modules/chatbot-finance` → ไม่มี error ใหม่
- [ ] **Step 11:** Commit: `feat(finance-bot): น้องเบสตอบสินค้า/ราคา/ค่างวด/โปรได้ ด้วย tool ชุดเดียวกับบอทขาย (B3 Task 10)`

---

### Task 11: port `guardGrounding` เข้า `FinanceAiService` — ห้ามพึ่ง prompt อย่างเดียว

> spec §5 สั่งไว้ตรง ๆ ว่าต้องทำ **ใน PR เดียวกัน** กับ Task 10 (บทเรียน #1064/#1337)
> ⚠️ **จุดตายที่ 1**: tool การเงินเดิมคืนตัวเลขเงินใต้คีย์ที่ยังไม่อยู่ใน `GROUNDED_PRICE_KEYS` (`amountDue` / `lateFee` / `totalAmount` / `remainingAmount` / `nextAmount` / `paidAmount` / `totalFine` / `amount` ใน `receipts[]` — เห็นได้ที่ `finance-tools.service.ts:71-82,121-133,155-159,184-192`) ถ้าเปิด guard โดยไม่เพิ่มคีย์พวกนี้ **น้องเบสจะตอบยอดค้างไม่ได้อีกเลย**
>
> ⚠️ **จุดตายที่ 2 — น้องเบสเป็น multi-turn แต่ ledger มีอายุแค่ 1 turn (ยืนยันกับโค้ดแล้ว)**: `generateReply` โหลด history จาก DB ทุกครั้ง (`finance-ai.service.ts:96` เรียก `loadHistory` :258-284) แต่ `groundedPrices` เกิดใหม่ทุกครั้งที่เรียก ⇒ บทสนทนาปกติอย่าง
> เทิร์น 1 "ยอดเท่าไหร่" (tool `get_current_balance` → 1,515.83) → เทิร์น 2 "โอนยังไงคะ" (เรียกแค่ `get_bank_info` ซึ่งคืน **string ล้วน** — `finance-tools.service.ts:200-207` ไม่มีคีย์เงินสักตัว) จะได้ `grounded.size === 0`
> แล้วถ้าน้องเบสทวนยอดเดิมโดยชอบธรรม ("โอน 1,515.83 บาทมาที่บัญชี…") จะโดน block ⇒ ถ้าปล่อยให้ `return null` เฉย ๆ ลูกค้าจะได้ `FALLBACK_REPLY` ที่บอกว่า **"ระบบขัดข้อง"** ทั้งที่ระบบไม่ได้ล่ม และ **ไม่มีใครไปหาสตาฟให้เลย**
> → Step 7 จึงต้องทำ **2 อย่างพร้อมกัน**: (ก) seed ledger จากข้อความ BOT/STAFF ใน history (ข) ทางบล็อก = เข้าคิว `HandoffService` + ตอบข้อความจริงว่ากำลังส่งต่อพนักงาน **ห้ามคืน `null` เปล่า ๆ**

**Files:**
- Modify: `apps/api/src/utils/price-grounding.util.ts` (**เพิ่ม `FINANCE_GROUNDED_PRICE_KEYS` เป็น set ใหม่** — ห้ามเติมลง `GROUNDED_PRICE_KEYS` ที่บอทขายใช้)
- Modify: `apps/api/src/utils/price-grounding.util.spec.ts` (เพิ่ม describe ใหม่)
- Modify: `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts` (constructor +`HandoffService`, `generateReply` :99-199)
- Modify: `apps/api/src/modules/chatbot-finance/services/finance-ai.service.spec.ts` (**เพิ่ม `{ provide: HandoffService, useValue: { handoff: jest.fn() } }` ใน providers ของ `Test.createTestingModule` ทั้ง 2 จุด** — `:48-73` และ `:262-276`; ไม่งั้น Nest resolve constructor ไม่ได้ = ทุกเคสในไฟล์แดง)

**Interfaces:**
- Consumes:
  - `collectGroundedPrices` / `collectGroundedPricesFromText` / `collectGroundedPricesFromToolText` / `guardGrounding` / `FINANCE_GROUNDED_PRICE_KEYS` (Task 1 + Task 6 + Step 3 ของ Task นี้)
  - `HandoffService.handoff({ roomId, reason, priority, summary, tags? })` — `services/handoff.service.ts:30` (**เป็น provider ของ `ChatbotFinanceModule` อยู่แล้ว** `:61`; deps = `PrismaService` + `StaffNotificationService` → ไม่มี circular กลับมาที่ `FinanceAiService` ⇒ inject ตรง ๆ ได้ ไม่ต้อง `forwardRef`)
- Produces: ไม่มี API ใหม่ และ **ไม่เพิ่มเคสที่คืน `null`** — ทางที่ guard บล็อกจะคืน `AiReply` ปกติที่มี `handoffTriggered: true` + ข้อความจริงว่ากำลังส่งต่อพนักงาน (ผู้เรียกใช้เส้นทาง `INTENTS.AI_HANDOFF` ที่มีอยู่แล้ว `chatbot-finance.service.ts:305`) ⇒ ลูกค้าไม่ได้ยินคำว่า "ระบบขัดข้อง" และ staff ได้ห้องเข้าคิวจริง
  ⚠️ ผลข้างเคียงที่ต้องรู้: `HandoffService.handoff` ตั้ง `chatRoom.handoffMode = true` (`:31-38`) ⇒ **บอทจะเงียบทั้งห้องจนกว่าพนักงานจะเคลียร์** — ตั้งใจ (บอทเพิ่งพยายามพูดตัวเลขที่ไม่มีที่มา ปล่อยให้คุยต่อคือเสี่ยงกว่า) แต่ต้องบอก owner ในหัวข้อ Deployment

- [ ] **Step 1:** เขียนเทสต์ที่ล้มก่อน — ต่อท้าย `apps/api/src/utils/price-grounding.util.spec.ts`:

```ts
describe('คีย์เงินฝั่งน้องเบส (B3 Task 11)', () => {
  it('เก็บยอดจาก get_current_balance ได้ครบ', () => {
    const set = new Set<number>();
    collectGroundedPrices(
      { found: true, amountDue: 1416.66, lateFee: 0, totalAmount: 1515.83, daysOverdue: 3 },
      set,
      FINANCE_GROUNDED_PRICE_KEYS,
    );
    expect(set.has(1416.66)).toBe(true);
    expect(set.has(1515.83)).toBe(true);
    expect(set.has(3)).toBe(false); // daysOverdue ไม่ใช่เงิน
  });

  it('เก็บยอดจาก get_payment_schedule + list_recent_receipts', () => {
    const set = new Set<number>();
    collectGroundedPrices(
      {
        totalAmount: 18190,
        paidAmount: 4547.49,
        remainingAmount: 13642.51,
        nextAmount: 1515.83,
        receipts: [{ installmentNumber: 1, amount: 1515.83 }],
      },
      set,
      FINANCE_GROUNDED_PRICE_KEYS,
    );
    for (const n of [18190, 4547.49, 13642.51, 1515.83]) expect(set.has(n)).toBe(true);
  });

  it('น้องเบสตอบยอดค้างได้โดยไม่โดน block', () => {
    const set = new Set<number>();
    collectGroundedPrices({ totalAmount: 5000 }, set, FINANCE_GROUNDED_PRICE_KEYS);
    expect(guardGrounding('ยอดคงเหลือของคุณคือ 5,000 บาทค่ะ', set)).toEqual({ ok: true });
  });

  it('น้องเบสตอบยอดที่มีสตางค์ได้ แต่ยอดที่แต่งเองยังโดน block', () => {
    const set = new Set<number>();
    collectGroundedPrices({ totalAmount: 1515.83 }, set, FINANCE_GROUNDED_PRICE_KEYS);
    expect(guardGrounding('ยอดของคุณคือ 1,515.83 บาทค่ะ', set)).toEqual({ ok: true });
    expect(guardGrounding('ยอดของคุณคือ 99,999.50 บาทค่ะ', set)).toEqual({
      ok: false,
      reason: 'unmatched-price=99999.5',
    });
  });

  it('คีย์กว้างฝั่งการเงินต้องไม่รั่วเข้าพูลของบอทขาย', () => {
    const set = new Set<number>();
    // ค่า default = GROUNDED_PRICE_KEYS (บอทขาย) → `amount` ต้องไม่ถูกเก็บ
    collectGroundedPrices({ prices: [{ label: 'ราคาทุน', amount: 21000 }] }, set);
    expect(set.size).toBe(0);
    expect(FINANCE_GROUNDED_PRICE_KEYS.has('amount')).toBe(true);
    expect(GROUNDED_PRICE_KEYS.has('amount')).toBe(false);
  });

  it('เลขบัญชีธนาคารต้องไม่ถูกนับเป็นราคา', () => {
    const set = new Set<number>();
    collectGroundedPrices(
      { bankName: 'KBank', accountNumber: '1234567890' },
      set,
      FINANCE_GROUNDED_PRICE_KEYS,
    );
    expect(set.size).toBe(0);
  });

  // calculate_fine ซ่อนเพดานค่าปรับไว้ใน explanation (ไม่มีคีย์ตัวเลขรองรับ)
  // — วันที่ owner ตั้ง late_fee_max_amount = 1500 น้องเบสต้องพูดตามได้
  it('ดูดเลขจาก explanation ของ calculate_fine (เพดานค่าปรับ 4 หลัก)', () => {
    const set = new Set<number>();
    const result = {
      daysOverdue: 40,
      totalFine: 1500,
      explanation: 'ค่าปรับล่าช้าต่อวัน: 50 บาท/วัน (สูงสุด 1500 บาท) — งวดนี้เลย 40 วัน ≈ 1500 บาท',
    };
    collectGroundedPrices(result, set, FINANCE_GROUNDED_PRICE_KEYS);
    collectGroundedPricesFromToolText('calculate_fine', result, set);
    expect(set.has(1500)).toBe(true);
    expect(guardGrounding('ค่าปรับสูงสุด 1,500 บาทค่ะ', set)).toEqual({ ok: true });
  });
});
```
> import ของไฟล์ spec ต้องเพิ่ม `FINANCE_GROUNDED_PRICE_KEYS` และ `collectGroundedPricesFromToolText` เข้าไปในรายการที่ Task 1 Step 2 เขียนไว้

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/price-grounding.util.spec.ts` → แดงทั้ง describe (`FINANCE_GROUNDED_PRICE_KEYS` ยังไม่ถูก export)
- [ ] **Step 3:** เพิ่ม **ชุดคีย์แยกของฝั่งการเงิน** ใน `apps/api/src/utils/price-grounding.util.ts` — **ห้ามเติมลง `GROUNDED_PRICE_KEYS` ตรง ๆ** เพราะ set นั้นใช้ร่วมกับบอทขาย และคีย์กว้าง ๆ อย่าง `amount` จะไปขยายพูลที่บอทขายยอมรับโดยไม่มีใครรีวิว (`search_products` select แถวราคาชื่อ `amount` ใน `prices[]` อยู่แล้ว → บอทขายจะ quote ราคาเก่า/ราคาซื้อได้โดยไม่โดน block):
```ts
/**
 * B3 Task 11 — คีย์ของน้องเบส = ชุดบอทขาย + คีย์เงินฝั่งการเงิน
 * (finance-tools.service.ts:71-82,121-133,155-159,184-192)
 * ส่งเข้า `collectGroundedPrices(..., FINANCE_GROUNDED_PRICE_KEYS)` จาก `FinanceAiService` เท่านั้น
 */
export const FINANCE_GROUNDED_PRICE_KEYS: ReadonlySet<string> = new Set([
  ...GROUNDED_PRICE_KEYS,
  'amountDue',
  'lateFee',
  'totalAmount',
  'paidAmount',
  'remainingAmount',
  'nextAmount',
  'totalFine',
  'amount',
]);
```
- [ ] **Step 4:** รันผ่าน: `cd apps/api && npx jest src/utils/price-grounding.util.spec.ts` → เขียวทั้งไฟล์
- [ ] **Step 5:** เขียนเทสต์ guard ใน `apps/api/src/modules/chatbot-finance/services/finance-ai.service.spec.ts` — **ต้องวาง describe ใหม่ซ้อน *ข้างใน* `describe('model routing (Phase 7.2)')` (`:256-303`)** เพราะ `service` เป็น `let` ของ describe นั้น (`:257`) และ `beforeEach` ของมันเป็นที่เดียวที่ประกอบ `FinanceAiService` ขึ้นมา (`mockCreate` / `textResponse` / `toolUseResponse` เป็น module-scope ส่วน `defaultParams` / `toolExecutor` อยู่ที่ describe นอกสุด) — วางท้ายไฟล์จะได้ `service is undefined`:

```ts
  describe('grounding guard (B3 Task 11)', () => {
    it('บล็อกคำตอบที่มีตัวเลขบาทซึ่งไม่ได้มาจาก tool → ส่งต่อพนักงาน (ห้ามบอกลูกค้าว่าระบบขัดข้อง)', async () => {
      toolExecutor.execute.mockResolvedValue({ ok: true, data: { found: true, totalAmount: 1515.83 } });
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('get_current_balance'))
        .mockResolvedValueOnce(textResponse('ยอดของคุณคือ 99,999.50 บาทค่ะ'));

      const r = await service.generateReply(defaultParams);
      expect(r).not.toBeNull();
      expect(r!.handoffTriggered).toBe(true);
      expect(r!.text).toContain('พนักงาน');
      expect(r!.text).not.toContain('99,999');
      expect(handoff.handoff).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: 'sess-1', reason: 'grounding_blocked' }),
      );
    });

    it('ยอมให้ตอบตัวเลขที่ tool คืนมาจริง (รวมสตางค์)', async () => {
      toolExecutor.execute.mockResolvedValue({ ok: true, data: { found: true, totalAmount: 1515.83 } });
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('get_current_balance'))
        .mockResolvedValueOnce(textResponse('ยอดของคุณคือ 1,515.83 บาทค่ะ'));

      const r = await service.generateReply(defaultParams);
      expect(r?.text).toContain('1,515.83');
      expect(handoff.handoff).not.toHaveBeenCalled();
    });

    it('คำตอบที่ไม่มีตัวเลขบาท ผ่านตลอด (ทักทาย/ขอบคุณ)', async () => {
      mockCreate.mockResolvedValueOnce(textResponse('สวัสดีค่ะ ให้น้องเบสช่วยอะไรดีคะ'));
      const r = await service.generateReply(defaultParams);
      expect(r?.text).toContain('สวัสดี');
    });

    // ── เคสที่สำคัญที่สุดของ Task นี้: เทิร์นที่ 2 ของบทสนทนาปกติ ──
    // "ยอดเท่าไหร่" (เทิร์น 1, มี tool) → "โอนยังไงคะ" (เทิร์น 2, get_bank_info คืน string ล้วน)
    // ถ้าไม่ seed ledger จาก history เทิร์นนี้จะ grounded.size === 0 แล้วโดน block ทั้งที่ยอดถูกต้อง
    it('ทวนยอดเดิมในเทิร์นถัดไปได้ แม้ tool เทิร์นนั้นไม่คืนตัวเลข (seed จาก history)', async () => {
      prisma.chatMessage.findMany.mockResolvedValue([
        { role: 'CUSTOMER', text: 'ยอดเท่าไหร่' },
        { role: 'BOT', text: 'งวดนี้ 1,515.83 บาทค่ะ' },
      ]);
      toolExecutor.execute.mockResolvedValue({
        ok: true,
        data: { bankName: 'KBank', accountNumber: '203-1-16520-5', formatted: '…' },
      });
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('get_bank_info'))
        .mockResolvedValueOnce(textResponse('โอน 1,515.83 บาท มาที่บัญชีนี้ได้เลยค่ะ'));

      const r = await service.generateReply(defaultParams);
      expect(r?.text).toContain('1,515.83');
      expect(r?.handoffTriggered).toBe(false);
      expect(handoff.handoff).not.toHaveBeenCalled();
    });
  });
```
> `handoff` = mock ตัวใหม่ที่ประกาศคู่กับ `toolExecutor` ใน `beforeEach` ของ describe นี้:
> `handoff = { handoff: jest.fn().mockResolvedValue({ handoffId: 'sess-1', estimatedTime: '2 ชั่วโมง' }) };`
> แล้วใส่ `{ provide: HandoffService, useValue: handoff }` ใน providers (ต้องใส่ใน `describe('when ANTHROPIC_API_KEY is not set')` `:48-73` ด้วย ไม่งั้นทั้งไฟล์แดง)
> ⚠️ **ต้องแก้ mock เดิมด้วย — ไม่งั้นเคสจะ "ผ่านแบบหลอก"**: `beforeEach` ของ `describe('model routing (Phase 7.2)')` `:261` ตั้ง
> `toolExecutor = { execute: jest.fn().mockResolvedValue({ ok: true, data: { ok: 1 }, triggeredHandoff: false }) };`
> — `data: { ok: 1 }` ไม่มีคีย์เงินเลย ⇒ เคส `:291-300` ที่โมเดลตอบ `'ยอดคงเหลือของคุณคือ 5,000 บาทค่ะ'` จะโดน guard block ทุกครั้ง.
> เดิมทีทางบล็อกคืน `null` เคสนี้จึงแดงตรง ๆ; หลังเปลี่ยนเป็น "ตอบข้อความ handoff" (Step 7) มันจะ **ยังเขียว** เพราะ `result.model` / `result.toolsUsed` ที่มัน assert เหมือนกันทั้ง 2 ทาง —
> กลายเป็นเคส model-routing ที่จริง ๆ แล้ววิ่งอยู่บนเส้นทาง handoff โดยไม่มีใครรู้.
> **แก้เป็น `data: { totalAmount: 5000 }`** (นี่คือความจริงของ pipeline: เลขที่บอทพูดต้องมาจาก tool) + เพิ่ม `expect(result!.handoffTriggered).toBe(false);` ในเคสนั้นเพื่อปักหมุดว่ามันวิ่งเส้นทางปกติ — ห้ามแก้ด้วยการปิด guard และห้ามลบเคส

- [ ] **Step 6:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/chatbot-finance/services/finance-ai.service.spec.ts`
- [ ] **Step 7:** implement ใน `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts`:
  - import + inject:
```ts
import {
  collectGroundedPrices,
  collectGroundedPricesFromText,
  collectGroundedPricesFromToolText,
  guardGrounding,
  FINANCE_GROUNDED_PRICE_KEYS,
} from '../../../utils/price-grounding.util';
import { HandoffService } from './handoff.service';
```
  เพิ่มพารามิเตอร์ท้าย constructor (`:57-62`): `private handoff: HandoffService,`
  - ข้อความที่ใช้ตอนบล็อก — ประกาศระดับไฟล์ข้าง ๆ `MAX_TOOL_ITERATIONS` (`:23`). **ห้ามใช้ `FALLBACK_REPLY` ที่บอกว่า "ระบบขัดข้อง"** เพราะระบบไม่ได้ล่ม:
```ts
/** B3 §5 — ทางที่ guard บล็อก: บอกความจริง + ส่งต่อพนักงาน (ห้ามอ้างว่าระบบล่ม) */
const GROUNDING_BLOCKED_REPLY =
  'ขอโทษค่ะ 🙏 น้องเบสขอให้พนักงานยืนยันตัวเลขให้อีกครั้งนะคะ\nส่งต่อให้พนักงานติดต่อกลับแล้วค่ะ';
```
  - ใน `generateReply` ประกาศ **ถัดจาก `const dbHistory = await this.loadHistory(params.roomId);` (`:96`)** — ต้องอยู่หลัง `dbHistory` เพราะบรรทัดถัดไป seed จากมัน:
```ts
      // B3 §5 — backstop เดียวกับบอทขาย: ทุกเลขบาทที่ตอบต้องมีที่มา
      const groundedPrices = new Set<number>();
      // ⚠️ น้องเบสเป็น multi-turn (ต่างจากบอทขาย): เทิร์นถัด ๆ ไปอาจไม่เรียก tool
      // ที่คืนตัวเลขเลย (เช่น get_bank_info คืน string ล้วน) การทวนยอดเดิมที่ตัวเอง
      // เพิ่งบอกไปจึงต้องนับเป็น grounded ไม่งั้น guard จะบล็อกบทสนทนาปกติ
      // (ข้อความใน history = ข้อความที่ "ส่งออกไปแล้ว" = ผ่าน guard มาแล้ว หรือ
      //  พนักงานพิมพ์เอง — STAFF/BOT ถูก map เป็น assistant ที่ loadHistory :275-279)
      for (const h of dbHistory) {
        if (h.role === 'assistant') collectGroundedPricesFromText(h.content, groundedPrices);
      }
```
  - ใน `toolResults` map ต่อจาก `if (result.triggeredHandoff) handoffTriggered = true;`:
```ts
            if (result.ok) {
              // ⚠️ ต้องส่ง FINANCE_GROUNDED_PRICE_KEYS — ค่า default คือชุดของบอทขาย
              collectGroundedPrices(result.data, groundedPrices, FINANCE_GROUNDED_PRICE_KEYS);
              // FAQ/โปรโมชั่นเป็นข้อความที่แอดมินพิมพ์เอง = ground truth
              // (util ตัวเดียวกับบอทขาย Task 6/8 — ห้าม inline ซ้ำ)
              collectGroundedPricesFromToolText(block.name, result.data, groundedPrices);
            }
```
  - ในบล็อกที่ Claude ตอบเป็น text (`if (response.stop_reason !== 'tool_use')` :132-163) แทรก **ก่อน** `void this.aiUsage.record({... status:'success' })`:
```ts
          const grounding = guardGrounding(text, groundedPrices);
          if (!grounding.ok) {
            this.logger.warn(
              `[FinanceAI] GroundingGuard HALLUCINATION_BLOCKED room=${params.roomId} reason=${grounding.reason} reply=${JSON.stringify(text).slice(0, 200)} grounded=${JSON.stringify([...groundedPrices])}`,
            );
            Sentry.captureMessage('FinanceAI grounding blocked', {
              level: 'warning',
              tags: { module: 'chatbot-finance', action: 'grounding_blocked' },
              extra: { reason: grounding.reason, toolsUsed },
            });
            void this.aiUsage.record({
              service: 'finance-ai',
              method: 'generateReply',
              model: activeModel,
              inputTokens: totalInput,
              outputTokens: totalOutput,
              status: 'error',
              errorKind: 'grounding_blocked',
            });

            // ห้ามคืน null: ผู้เรียกจะตอบ FALLBACK_REPLY = "ระบบขัดข้อง" ซึ่งเป็นคำโกหก
            // (ระบบทำงานปกติ — โมเดลต่างหากที่พูดเลขไม่มีที่มา) และไม่มีใครไปหาสตาฟ
            // แทนที่ด้วย: เข้าคิวพนักงานจริง + ตอบข้อความที่ตรงกับสิ่งที่เกิดขึ้น
            try {
              await this.handoff.handoff({
                roomId: params.roomId,
                reason: 'grounding_blocked',
                priority: 'high',
                summary:
                  `น้องเบสตอบตัวเลขที่ไม่มีที่มา (${grounding.reason}) — ลูกค้าถาม: ` +
                  params.userMessage.slice(0, 120),
                tags: ['grounding'],
              });
            } catch (err) {
              // handoff ล้มก็ยังต้องตอบลูกค้าให้ตรงความจริง — ห้ามพาลงทาง "ระบบขัดข้อง"
              this.logger.error(
                `[FinanceAI] handoff after grounding block failed: ${err instanceof Error ? err.message : err}`,
              );
              Sentry.captureException(err);
            }

            return {
              text: GROUNDING_BLOCKED_REPLY,
              model: activeModel,
              inputTokens: totalInput,
              outputTokens: totalOutput,
              toolsUsed,
              handoffTriggered: true,
            };
          }
```
- [ ] **Step 8:** รันผ่าน: `cd apps/api && npx jest src/modules/chatbot-finance` → เขียวทั้ง module
- [ ] **Step 9:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/utils/price-grounding.util.ts src/modules/chatbot-finance/services/finance-ai.service.ts` → ไม่มี error ใหม่
- [ ] **Step 10:** Commit: `feat(finance-bot): ใส่ grounding guard ให้น้องเบส + คีย์เงินฝั่งการเงิน (B3 Task 11)`

---

### Task 12: น้องเบสส่งรูปสินค้าได้ — ขยาย `replyAndSave` เป็น multi-message reply

> spec §5: "ภาพ: ขยาย `replyAndSave` ส่ง LINE image array (LINE reply รับ 5 messages/call, มีตัวอย่าง 2-message อยู่แล้ว)" — ตัวอย่างคือ `replyVerifyFlexAndSave` (`chatbot-finance.service.ts:548-580`) ที่ส่ง `[text, flex]` ใน call เดียว

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts` (`AiReply` :14-21, `generateReply` loop + return :156-163)
- Modify: `apps/api/src/modules/chatbot-finance/services/line-finance-client.service.ts` (union `LineMessage` :5-28)
- Modify: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` (`replyAndSave` :490-542, call site :319-325)
- Modify: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` (เพิ่ม describe ใหม่ + **แก้ 3 เคสเดิมที่ assert `replyText`** — `:119`, `:146`, `:154`)

**Interfaces:**
- Consumes: `collectAttachmentsFromToolResult` / `MAX_BOT_ATTACHMENTS` / `BotAttachment` (Task 2)
- Produces:
```ts
// finance-ai.service.ts
export interface AiReply {
  text: string; model: string; inputTokens: number; outputTokens: number;
  toolsUsed: string[]; handoffTriggered: boolean;
  attachments?: BotAttachment[];   // ← ใหม่
}
```
```ts
// line-finance-client.service.ts
interface LineImageMessage {
  type: 'image';
  originalContentUrl: string;   // ต้องเป็น HTTPS สาธารณะ (gallery[] เท่านั้น)
  previewImageUrl: string;
  quickReply?: LineQuickReply;
}
type LineMessage = LineTextMessage | LineFlexMessage | LineStickerMessage | LineImageMessage;
```
```ts
// chatbot-finance.service.ts
private async replyAndSave(
  roomId: string,
  replyToken: string,
  text: string,
  intent?: string,
  modelMeta?: {...},
  quickReply?: LineQuickReply,
  images?: { url: string }[],   // ← ใหม่ (optional = call site เดิม 6 จุดไม่พัง)
): Promise<string>;
```

**พฤติกรรมที่ต้องคงไว้:**
- คืนค่าเดิม = **id ของข้อความ text** (feedback quick reply แทนที่ `__MSG_ID__` ด้วยค่านี้) — ห้ามคืน id ของรูป
- `quickReply` ต้องแปะกับ **ข้อความสุดท้าย** ใน array (LINE แสดง quick reply ของ message ตัวสุดท้าย) ไม่ใช่ text เสมอไป
- ไม่มีรูป → array มีสมาชิกเดียว = พฤติกรรมเดียวกับเดิม **ในสายตาลูกค้า** (แต่ช่องทางส่งเปลี่ยน — ดูย่อหน้าถัดไป)

> ⚠️ **การเปลี่ยนช่องทางส่ง = breaking change ของ spec เดิม (ยืนยันกับโค้ดแล้ว)**
> วันนี้ `replyAndSave` เรียก `this.lineClient.replyWithQuickReply(replyToken, text, qr)` หรือ `this.lineClient.replyText(replyToken, text)`
> (`chatbot-finance.service.ts:531-537`). แผนนี้เปลี่ยนเป็น `this.lineClient.replyMessage(replyToken, messages)`
> (`line-finance-client.service.ts:94` — มีอยู่แล้ว, signature `(replyToken: string, messages: LineMessage[]) => Promise<void>`) เสมอ
> → **เคสเดิม 2 เคสใน `chatbot-finance.service.spec.ts` จะแดง** และต้องแก้ในคอมมิตเดียวกัน:
> - `:119` `expect(lineClient.replyText).toHaveBeenCalledWith('rt-1', 'สวัสดีค่ะ');`
>   → `expect(lineClient.replyMessage).toHaveBeenCalledWith('rt-1', [{ type: 'text', text: 'สวัสดีค่ะ' }]);`
> - `:154` `expect(lineClient.replyText).toHaveBeenCalledWith('rt-1', expect.stringContaining('ระบบขัดข้อง'));`
>   → `expect(lineClient.replyMessage).toHaveBeenCalledWith('rt-1', [expect.objectContaining({ type: 'text', text: expect.stringContaining('ระบบขัดข้อง') })]);`
> - `:146` `expect(lineClient.replyText).not.toHaveBeenCalled();` (เคส handoff) → เปลี่ยนเป็น `replyMessage` ด้วย ไม่งั้นเคสนี้จะผ่านแบบไร้ความหมาย
> `lineClient` mock ที่ `:42-46` มี `replyMessage: jest.fn()` อยู่แล้ว ✅ (ไม่มี `replyWithQuickReply` — ยิ่งยืนยันว่าไม่มีเคสไหนพึ่งมัน)

- [ ] **Step 1:** เขียนเทสต์ที่ล้มก่อน — ต่อท้าย `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` (ก่อน `});` บรรทัดสุดท้าย). **ชื่อที่ต้องใช้ให้ตรงของจริง**: entry point คือ **`service.handleEvent(...)`** (ไม่ใช่ `handleWebhookEvent`) และ helper สร้าง event คือ **`makeTextEvent(text)`** (`:100-110`, module-scope ในไฟล์ spec); mock ที่ใช้คือ `lineClient` / `sessions` / `ai` (`:42-65`):

```ts
describe('น้องเบสส่งรูปสินค้า (B3 Task 12)', () => {
  it('ส่ง text + image ใน reply เดียว และบันทึกทั้งสองข้อความ', async () => {
    ai.generateReply.mockResolvedValue({
      text: 'iPhone 15 128GB ราคา 28,900 บาทค่ะ',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 5,
      toolsUsed: ['search_products'],
      handoffTriggered: false,
      attachments: [{ productId: 'prd-1', imageUrl: 'https://cdn.example.com/p1.jpg' }],
    });

    await service.handleEvent(makeTextEvent('iPhone 15 มีไหม'));

    const messages = lineClient.replyMessage.mock.calls.at(-1)![1];
    expect(messages[0]).toMatchObject({ type: 'text' });
    expect(messages[1]).toMatchObject({
      type: 'image',
      originalContentUrl: 'https://cdn.example.com/p1.jpg',
      previewImageUrl: 'https://cdn.example.com/p1.jpg',
    });
    expect(sessions.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'IMAGE', mediaUrl: 'https://cdn.example.com/p1.jpg' }),
    );
  });

  it('quick reply แปะกับข้อความสุดท้าย (รูป) เมื่อมีรูป', async () => {
    ai.generateReply.mockResolvedValue({
      text: 'ราคา 28,900 บาทค่ะ',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      toolsUsed: ['search_products'], // toolsUsed > 0 → มี feedback quick reply
      handoffTriggered: false,
      attachments: [{ productId: 'prd-1', imageUrl: 'https://cdn.example.com/p1.jpg' }],
    });

    await service.handleEvent(makeTextEvent('ราคาเท่าไหร่'));
    const messages = lineClient.replyMessage.mock.calls.at(-1)![1];
    expect(messages.at(-1).quickReply).toBeDefined();
    expect(messages[0].quickReply).toBeUndefined();
  });

  it('ไม่มี attachments → ส่งข้อความเดียวเหมือนเดิม', async () => {
    ai.generateReply.mockResolvedValue({
      text: 'สวัสดีค่ะ',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      toolsUsed: [],
      handoffTriggered: false,
    });
    await service.handleEvent(makeTextEvent('สวัสดี'));
    expect(lineClient.replyMessage.mock.calls.at(-1)![1]).toHaveLength(1);
  });

  it('ส่งรูปมากสุด 2 ใบ (กันเกินโควตา 5 ข้อความ/reply)', async () => {
    ai.generateReply.mockResolvedValue({
      text: 'มี 3 เครื่องค่ะ',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      toolsUsed: ['search_products'],
      handoffTriggered: false,
      attachments: [
        { productId: 'a', imageUrl: 'https://c/a.jpg' },
        { productId: 'b', imageUrl: 'https://c/b.jpg' },
        { productId: 'c', imageUrl: 'https://c/c.jpg' },
      ],
    });
    await service.handleEvent(makeTextEvent('มีอะไรบ้าง'));
    expect(lineClient.replyMessage.mock.calls.at(-1)![1]).toHaveLength(3); // 1 text + 2 image
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts`
- [ ] **Step 3:** ให้ `FinanceAiService` คืน attachments — ใน `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts`:
  - import `{ collectAttachmentsFromToolResult, type BotAttachment } from '../../../utils/bot-attachments.util';`
  - `AiReply` เพิ่ม `attachments?: BotAttachment[];`
  - ประกาศถัดจาก `groundedPrices`: `const attachments = new Map<string, BotAttachment>();`
  - ในลูป `toolResults` (ในบล็อก `if (result.ok)` เดียวกับ Task 11) เพิ่ม
    `collectAttachmentsFromToolResult(block.name, result.data, attachments);`
  - ใน return ที่สำเร็จ (:156-163) เพิ่ม
    `...(attachments.size > 0 ? { attachments: [...attachments.values()] } : {}),`
- [ ] **Step 4:** เพิ่ม image type ใน `apps/api/src/modules/chatbot-finance/services/line-finance-client.service.ts` (หลัง `LineStickerMessage`):
```ts
/** รูปภาพ — LINE ต้องการ URL สาธารณะ HTTPS เท่านั้น (Product.gallery[]; ห้ามใช้ photos[] ที่เป็น base64) */
interface LineImageMessage {
  type: 'image';
  originalContentUrl: string;
  previewImageUrl: string;
  quickReply?: LineQuickReply;
}

type LineMessage = LineTextMessage | LineFlexMessage | LineStickerMessage | LineImageMessage;
```
- [ ] **Step 5:** ขยาย `replyAndSave` ใน `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` — แทน body ทั้งก้อน (:504-541):

```ts
    // บันทึกข้อความ text ก่อนเพื่อเอา id ไปใส่ใน feedback quick reply
    const savedMsg = await this.sessions.saveMessage({
      roomId,
      role: MessageRole.BOT,
      text,
      intent,
      modelUsed: modelMeta?.model,
      inputTokens: modelMeta?.inputTokens,
      outputTokens: modelMeta?.outputTokens,
      toolsUsed: modelMeta?.toolsUsed,
      costUsd: modelMeta?.costUsd,
    });

    // B3 §5 — รูปสินค้าตามหลังข้อความใน reply เดียวกัน (LINE รับได้ 5 ข้อความ/ครั้ง)
    const imageList = (images ?? []).filter((i) => !!i.url).slice(0, MAX_BOT_ATTACHMENTS);
    for (const img of imageList) {
      await this.sessions.saveMessage({
        roomId,
        role: MessageRole.BOT,
        type: MessageType.IMAGE,
        text: '[image]',
        mediaUrl: img.url,
        intent,
      });
    }

    try {
      const messages: LineMessage[] = [
        { type: 'text', text },
        ...imageList.map((i) => ({
          type: 'image' as const,
          originalContentUrl: i.url,
          previewImageUrl: i.url,
        })),
      ];

      if (quickReply) {
        // LINE แสดง quick reply ของ "ข้อความสุดท้าย" เท่านั้น — ถ้าแปะไว้ที่ text
        // แล้วมีรูปตามหลัง ปุ่มจะหายไปเฉย ๆ
        const resolvedQuickReply: LineQuickReply = {
          items: quickReply.items.map((item) => ({
            ...item,
            action: {
              ...item.action,
              ...(item.action.type === 'postback'
                ? { data: item.action.data.replace('__MSG_ID__', savedMsg.id) }
                : {}),
            },
          })),
        } as LineQuickReply;
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          quickReply: resolvedQuickReply,
        } as LineMessage;
      }

      await this.lineClient.replyMessage(replyToken, messages);
    } catch (err) {
      this.logger.error(`[Finance] reply failed: ${err instanceof Error ? err.message : err}`);
    }

    return savedMsg.id;
```
  พร้อม import `{ MAX_BOT_ATTACHMENTS } from '../../../utils/bot-attachments.util';`, `MessageType` จาก `@prisma/client` และ type `LineMessage` (ต้อง `export type LineMessage` จาก `line-finance-client.service.ts` ด้วย)
- [ ] **Step 6:** ต่อ call site ที่ `:319-325`:
```ts
      await this.replyAndSave(
        session.id,
        event.replyToken,
        aiReply.text,
        intent,
        { model: aiReply.model, inputTokens: aiReply.inputTokens, outputTokens: aiReply.outputTokens, toolsUsed: aiReply.toolsUsed, costUsd },
        feedbackQuickReply,
        // ส่งเฉพาะ attachment ที่มีรูปจริง — ลิงก์อยู่ในข้อความที่โมเดลเขียนแล้ว
        aiReply.attachments?.filter((a) => !!a.imageUrl).map((a) => ({ url: a.imageUrl! })),
      );
```
- [ ] **Step 6b:** แก้ 3 เคสเดิมใน `chatbot-finance.service.spec.ts` ให้ assert `replyMessage` แทน `replyText` (`:119`, `:146`, `:154` — ข้อความแทนที่อยู่ในกล่อง ⚠️ ด้านบนของ Task นี้). นี่คือการอัปเดต assertion ให้ตรง "ช่องทางส่งใหม่" ไม่ใช่การผ่อนกฎ — **ข้อความที่ลูกค้าได้รับต้องเหมือนเดิมทุกตัวอักษร** ให้ assert เนื้อ text เดิมไว้ครบ
- [ ] **Step 7:** รันผ่าน: `cd apps/api && npx jest src/modules/chatbot-finance` → เขียวทั้ง module (call site เดิมอีก 5 จุดของ `replyAndSave` ต้องไม่แดง)
- [ ] **Step 8:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/modules/chatbot-finance` → ไม่มี error ใหม่
- [ ] **Step 9:** Commit: `feat(finance-bot): น้องเบสส่งรูปสินค้าใน reply เดียวกับข้อความ (B3 Task 12)`

---

### Task 13: หน้า AI Settings บอกความจริง — status strip จาก env flags + ทำเครื่องหมาย checkbox ที่เป็น no-op

> spec §5: "endpoint เล็กคืน boolean env flags → status strip บนหน้าเดิม; แก้/annotate checkbox LINE_FINANCE/TIKTOK ที่เป็น no-op — **ไม่สร้าง status card ซ้ำกับของที่แก้ไขได้อยู่แล้ว**"
> ข้อเท็จจริงที่ยืนยันแล้วในโค้ด: `TIKTOK` ถูกตัดทิ้งที่ `ai-auto-reply.service.ts:46-50` (`STUB_CHANNELS`) และ `LINE_FINANCE` ไม่เคยผ่าน `shouldAutoReply` เลยเพราะน้องเบสไม่เดินผ่าน MessageRouter → ติ๊ก 2 ช่องนี้ = ไม่มีผลอะไรทั้งสิ้น

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` (+`getRuntimeStatus()`)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (+`GET ai/status` วางถัดจาก `ai/settings` :669-679)
- Modify: `apps/web/src/pages/AiSettingsPage.tsx` (`CHANNELS` :22-27, การ์ดช่องทาง :96-121, `AiSettingsPage` :404-441)
- Create: `apps/web/src/pages/AiSettingsPage.status.test.tsx`

**Interfaces:**
- Produces:
```ts
// GET /staff-chat/ai/status — @Roles('OWNER')
interface AiRuntimeStatus {
  fbBotDisabled: boolean;        // env FB_BOT_DISABLED === 'true'
  fbWhitelistCount: number;      // จำนวน PSID ใน FB_BOT_WHITELIST_PSIDS
  centralBranchSet: boolean;     // SystemConfig shop_bot_central_branch_id มีค่า
  promptpaySet: boolean;         // SystemConfig shop_bot_promptpay_id มีค่า
  tiktokAdapterStub: boolean;    // true เสมอ — adapter TikTok เป็น stub
  financeBotSeparatePipeline: boolean; // true เสมอ — น้องเบสไม่อ่านค่า channel นี้
}
```
> 2 ฟิลด์ท้าย (`tiktokAdapterStub` / `financeBotSeparatePipeline`) **จงใจไม่ render ใน strip** — ข้อความ "ค่านี้ไม่มีผล" ไปอยู่ใต้ checkbox โดยตรง (hardcode ใน `CHANNELS`) ซึ่งอ่านง่ายกว่า. เก็บไว้ใน payload เพราะเป็น "ข้อเท็จจริงเชิงสถาปัตยกรรม" ที่ frontend ในอนาคตอาจต้องใช้ และเพราะค่ามันคงที่จึงไม่มีต้นทุน query — **ถ้าไม่อยากมีฟิลด์ที่ไม่มีผู้อ่าน ให้ตัดออกทั้งจาก interface, endpoint และเทสต์พร้อมกัน**

- [ ] **Step 1:** เพิ่ม `getRuntimeStatus()` ใน `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` (ใช้ `this.config` + `getSettings()` ที่มีอยู่แล้ว — ไม่ query เพิ่ม):

```ts
  /**
   * B3 §5 — สถานะที่ "แก้จากหน้าเว็บไม่ได้" (env flag / ข้อจำกัดสถาปัตยกรรม)
   *
   * เจตนา: ไม่ทำการ์ดซ้ำกับ setting ที่หน้านี้แก้ได้อยู่แล้ว — แสดงเฉพาะสิ่งที่
   * เจ้าของร้านมองไม่เห็นและเข้าใจผิดบ่อย (เช่นติ๊ก TikTok แล้วคิดว่าบอทตอบ)
   */
  async getRuntimeStatus(): Promise<{
    fbBotDisabled: boolean;
    fbWhitelistCount: number;
    centralBranchSet: boolean;
    promptpaySet: boolean;
    tiktokAdapterStub: boolean;
    financeBotSeparatePipeline: boolean;
  }> {
    const settings = await this.getSettings();
    const whitelist = (this.config.get<string>('FB_BOT_WHITELIST_PSIDS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      fbBotDisabled: this.config.get<string>('FB_BOT_DISABLED') === 'true',
      fbWhitelistCount: whitelist.length,
      centralBranchSet: !!settings.shopBotCentralBranchId,
      promptpaySet: !!settings.shopBotPromptpayId,
      tiktokAdapterStub: true,
      financeBotSeparatePipeline: true,
    };
  }
```
- [ ] **Step 2:** เพิ่ม route ใน `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (ถัดจาก `@Get('ai/settings')` :669-673):
```ts
  @Get('ai/status')
  @Roles('OWNER')
  async getAiStatus() {
    return this.aiAutoReply.getRuntimeStatus();
  }
```
- [ ] **Step 3:** เขียนเทสต์ที่ล้มก่อน — `apps/web/src/pages/AiSettingsPage.status.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AiRuntimeStatusStrip } from './AiSettingsPage';

// pattern เดียวกับ page test เดิมของ repo (เช่น CannedResponseAdminPage.test.tsx:7-23):
// import หน้าเพจเข้ามาจะลาก `@/lib/api` (axios + interceptor) และ `sonner` ตามมาด้วย
// ถึงจะ render แค่ component ย่อยก็ตาม — mock ไว้ให้เป็นมาตรฐานเดียวกัน
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), patch: vi.fn(), post: vi.fn() },
  getErrorMessage: (e: any) => e?.message ?? 'error',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('AiRuntimeStatusStrip', () => {
  it('เตือนเมื่อบอท Facebook ถูกปิดด้วย env', () => {
    render(
      <AiRuntimeStatusStrip
        status={{
          fbBotDisabled: true,
          fbWhitelistCount: 2,
          centralBranchSet: true,
          promptpaySet: true,
          tiktokAdapterStub: true,
          financeBotSeparatePipeline: true,
        }}
      />,
    );
    expect(screen.getByText(/บอท Facebook ปิดอยู่/)).toBeTruthy();
    expect(screen.getByText(/2/)).toBeTruthy();
  });

  it('เตือนเมื่อยังไม่ได้ตั้งสาขาศูนย์กลาง (บอทจะไม่ตอบช่องร้านค้าเลย)', () => {
    render(
      <AiRuntimeStatusStrip
        status={{
          fbBotDisabled: false,
          fbWhitelistCount: 0,
          centralBranchSet: false,
          promptpaySet: false,
          tiktokAdapterStub: true,
          financeBotSeparatePipeline: true,
        }}
      />,
    );
    expect(screen.getByText(/ยังไม่ได้ตั้งสาขาศูนย์กลาง/)).toBeTruthy();
  });

  it('ทุกอย่างพร้อม → ไม่มีข้อความเตือนสีแดง', () => {
    const { container } = render(
      <AiRuntimeStatusStrip
        status={{
          fbBotDisabled: false,
          fbWhitelistCount: 0,
          centralBranchSet: true,
          promptpaySet: true,
          tiktokAdapterStub: true,
          financeBotSeparatePipeline: true,
        }}
      />,
    );
    expect(container.querySelectorAll('[data-status="warn"]')).toHaveLength(0);
  });
});
```
- [ ] **Step 4:** รันให้เห็น fail: `cd apps/web && npx vitest run src/pages/AiSettingsPage.status.test.tsx`
- [ ] **Step 5:** implement ใน `apps/web/src/pages/AiSettingsPage.tsx`:
  - เพิ่ม type + component (export เพื่อให้เทสต์เรียกได้):
```tsx
export interface AiRuntimeStatus {
  fbBotDisabled: boolean;
  fbWhitelistCount: number;
  centralBranchSet: boolean;
  promptpaySet: boolean;
  tiktokAdapterStub: boolean;
  financeBotSeparatePipeline: boolean;
}

export function AiRuntimeStatusStrip({ status }: { status: AiRuntimeStatus }) {
  const rows: { label: string; ok: boolean; hint: string }[] = [
    {
      label: status.fbBotDisabled
        ? `บอท Facebook ปิดอยู่ (FB_BOT_DISABLED) — ยกเว้น ${status.fbWhitelistCount} คนใน whitelist`
        : 'บอท Facebook เปิดอยู่',
      ok: !status.fbBotDisabled,
      hint: 'สวิตช์นี้อยู่ที่ env ของเซิร์ฟเวอร์ แก้จากหน้านี้ไม่ได้',
    },
    {
      label: status.centralBranchSet
        ? 'ตั้งสาขาศูนย์กลางแล้ว'
        : 'ยังไม่ได้ตั้งสาขาศูนย์กลาง — บอทจะไม่ตอบช่อง LINE Shop / Facebook / เว็บ',
      ok: status.centralBranchSet,
      hint: 'ตั้งได้ในส่วน "SHOP Bot Setup" ด้านล่าง',
    },
    {
      label: status.promptpaySet ? 'ตั้ง PromptPay แล้ว' : 'ยังไม่ได้ตั้ง PromptPay',
      ok: status.promptpaySet,
      hint: 'ใช้ตอนบอทออกคิวรับเงิน',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base leading-snug">สถานะระบบ (แก้จากหน้านี้ไม่ได้)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.label}
            data-status={r.ok ? 'ok' : 'warn'}
            className={`rounded-md border p-3 ${r.ok ? 'border-border bg-card' : 'border-destructive/40 bg-destructive/5'}`}
          >
            <p className="text-sm text-foreground leading-snug">{r.label}</p>
            <p className="text-xs text-muted-foreground leading-snug mt-0.5">{r.hint}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```
  - ใน `AiSettingsPage` เพิ่ม query + render **ก่อน** `<ChannelRoutingCard />`:
```tsx
  const statusQuery = useQuery<AiRuntimeStatus>({
    queryKey: ['ai-settings', 'status'],
    queryFn: () => api.get('/staff-chat/ai/status').then((r: any) => r.data?.data ?? r.data),
  });
  // ...ใน JSX:
        {statusQuery.data && <AiRuntimeStatusStrip status={statusQuery.data} />}
```
  - **annotate checkbox ที่เป็น no-op** — เปลี่ยน `CHANNELS` (:22-27) เป็น:
```tsx
const CHANNELS = [
  {
    value: 'LINE_FINANCE',
    label: 'LINE Finance',
    noop: 'น้องเบสตอบเองอยู่แล้ว — ค่านี้ไม่มีผล',
  },
  { value: 'LINE_SHOP', label: 'LINE Shop', noop: null },
  { value: 'FACEBOOK', label: 'Facebook', noop: null },
  { value: 'TIKTOK', label: 'TikTok', noop: 'ยังไม่ได้เชื่อมต่อ TikTok — ค่านี้ไม่มีผล' },
  { value: 'WEB', label: 'Web', noop: null },
] as const;
```
    แล้วใน map (:106-120) เพิ่มใต้ label:
```tsx
                {ch.noop && (
                  <span className="block text-xs text-muted-foreground leading-snug">{ch.noop}</span>
                )}
```
    (คง checkbox ให้กดได้ตามเดิม — ห้ามลบทิ้ง เพราะค่าที่บันทึกไว้แล้วจะหายเงียบ ๆ ตอน save)
- [ ] **Step 6:** รันผ่าน: `cd apps/web && npx vitest run src/pages/AiSettingsPage.status.test.tsx` → เขียว
- [ ] **Step 7:** `cd apps/api && npx tsc --noEmit` → 0; `cd apps/web && npx tsc --noEmit` → 0; `cd apps/web && npx eslint src/pages/AiSettingsPage.tsx` → 0 error
- [ ] **Step 8:** Commit: `feat(ai-settings): แสดงสถานะ env ที่แก้จากหน้าเว็บไม่ได้ + ทำเครื่องหมายช่องที่ไม่มีผล (B3 Task 13)`

---

### Task 14: `ProductQuoteService` (B2) ใช้ resolver ตัวเดียวกับสัญญาจริง

> ⚠️ **ขอบเขต Task นี้ถูกย่อลงเพราะ B2 ship ก่อนและทำงานส่วนใหญ่ไปแล้ว (ยืนยันกับแผน B2 แล้ว)**
> spec §5 บรรทัดสุดท้ายเขียนไว้ว่า "แก้ `ProductDetectService` เลิกคิดค่างวดเอง" แต่ **B2 Task 10** (`docs/superpowers/plans/2026-08-04-b2-inbox-product-picker.md:2406-2842`) ทำไปครบแล้ว:
> - เขียน `product-detect.service.ts` ใหม่ทั้งหัวไฟล์ (บรรทัด 1-61) พร้อม **constructor 2 อาร์กิวเมนต์** `(private prisma: PrismaService, private productQuote: ProductQuoteService)` (:2549-2552)
> - **สร้าง `product-detect.service.spec.ts` แล้ว** (:2412, 4 เคส) — B3 สร้างซ้ำไม่ได้
> - แก้ป้าย `(ดาวน์ …%)` → จำนวนเงิน ทั้ง `ai-suggest.service.ts:100` (:2678) และ `ProductContextCard.tsx` (แทนทั้งไฟล์, :2685)
> - `gallery` แทน `photos`, จำนวนเครื่องจริง
> ⇒ ถ้า B3 ทำตามข้อความเดิมจะเป็นการ **เขียนทับงาน B2 ด้วย constructor 1 อาร์กิวเมนต์** = พังทั้ง `StaffChatModule` และ spec ของ B2
>
> **สิ่งที่ยังไม่มีใครทำ และเป็นเนื้องานทั้งหมดของ Task นี้:** `ProductQuoteService` ของ B2 **ก็อปตรรกะ resolve config มาไว้ในตัวเอง** (`computeProductQuote` สร้าง `ratePctByMonths` + fallback `interestRate × m` + `allowedMonths` เอง — B2 :944-975) ซึ่งเป็นตรรกะเดียวกับ `bc-installment-config.util.ts` ของ Task 4 ⇒ มี 2 ก็อปปี้ในระบบ วันที่แก้กติกาที่หนึ่งแล้วลืมอีกที่ ตัวเลขในกล่องแชทจะเริ่มไม่ตรงกับสัญญาอีกครั้ง (อาการเดิมของ #1335)

**Preconditions (ต้องจริงก่อนเริ่ม — ถ้าไม่จริงแปลว่า B2 ยังไม่ merge ให้หยุด):**
- `apps/api/src/modules/staff-chat/services/product-quote.service.ts` มีอยู่จริง และ export `computeProductQuote` / `resolveProductPrices` / `ProductQuoteService`
- `apps/api/src/modules/staff-chat/services/product-detect.service.ts` มี constructor 2 อาร์กิวเมนต์และ **ไม่มี** การคำนวณค่างวดด้วยมือแล้ว
- `product-detect.service.spec.ts` + `product-quote.service.spec.ts` มีอยู่และเขียว

**Files:**
- Modify: `apps/api/src/utils/bc-installment-config.util.ts` — แยกส่วน pure ออกมา export เพิ่ม `toBcConfig(row)` (ตัว `resolveBcConfigForCategory` เรียกมันต่อ พฤติกรรมไม่เปลี่ยน)
- Modify: `apps/api/src/utils/bc-installment-config.util.spec.ts` — เพิ่มเคสของ `toBcConfig` (pure, ไม่แตะ DB)
- Modify: `apps/api/src/modules/staff-chat/services/product-quote.service.ts` — `computeProductQuote` เลิกสร้าง rate map/fallback เอง → เรียก `toBcConfig`
- **ไม่แตะ** `product-detect.service.ts` / `ai-suggest.service.ts` / `ProductContextCard.tsx` / spec ใด ๆ ของ B2

**Interfaces:**
- Consumes: `toBcConfig` / `resolveBcConfigForCategory` (Task 4)
- Produces:
```ts
// apps/api/src/utils/bc-installment-config.util.ts (เพิ่ม export ใหม่ 1 ตัว)
/** map แถว InterestConfig (+rates) → BcConfig — pure, ไม่แตะ DB */
export function toBcConfig(row: {
  minDownPaymentPct: unknown;
  storeCommissionPct: unknown;
  vatPct: unknown;
  interestRate: unknown;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  rates: { months: number; ratePct: unknown }[];
}): BcConfig;
```
> `computeProductQuote` **ยังต้องเป็น pure + sync เหมือนเดิม** — ห้ามให้มันเรียก `resolveBcConfigForCategory` (async + ยิง DB) ตรง ๆ เพราะ (ก) golden test ของ B2 (`product-quote.service.spec.ts`, 7 เคส) เรียกมันแบบ sync พร้อม config literal และ (ข) `getQuotes` จงใจโหลด config ด้วย `findMany` ครั้งเดียวต่อชุดเพื่อกัน N+1 ตอน search คืน 20 เครื่อง. สิ่งที่ต้องรวมคือ **ตรรกะ map แถว → BcConfig** ไม่ใช่ตัว query

- [ ] **Step 1:** เขียนเทสต์ที่ล้มก่อน — ต่อท้าย `apps/api/src/utils/bc-installment-config.util.spec.ts` (ใช้ `baseCfg` / `makePrisma` / `Prisma` ที่ประกาศไว้แล้วหัวไฟล์ตั้งแต่ Task 4 Step 1 — แค่เพิ่ม `toBcConfig` เข้าไปใน import บรรทัดแรก):

```ts
describe('toBcConfig — ตัว map ที่ทุกผู้อ่านต้องใช้ร่วมกัน (B3 Task 14)', () => {
  it('มี rate rows → allowedMonths/ratePctByMonths มาจากตารางตรง ๆ', () => {
    const c = toBcConfig({
      ...baseCfg,
      rates: [
        { months: 6, ratePct: new Prisma.Decimal('0.45') },
        { months: 12, ratePct: new Prisma.Decimal('0.90') },
      ],
    });
    expect(c.allowedMonths).toEqual([6, 12]);
    expect(c.ratePctByMonths.get(12)!.toString()).toBe('0.9');
  });

  it('ไม่มี rate rows → สังเคราะห์ interestRate × m ตามช่วง min..max', () => {
    const c = toBcConfig(baseCfg);
    expect(c.allowedMonths).toEqual([6, 7, 8]);
    expect(c.ratePctByMonths.get(8)!.toString()).toBe('0.8');
  });

  it('resolveBcConfigForCategory คืนผลเท่ากับ toBcConfig ของแถวเดียวกัน (ไม่มีตรรกะซ้อน)', async () => {
    const r = await resolveBcConfigForCategory(makePrisma(baseCfg), 'PHONE_NEW');
    const direct = toBcConfig(baseCfg);
    expect(r.config!.allowedMonths).toEqual(direct.allowedMonths);
    expect(r.config!.minDownPct.toString()).toBe(direct.minDownPct.toString());
    expect([...r.config!.ratePctByMonths.entries()].map(([m, v]) => [m, v.toString()])).toEqual(
      [...direct.ratePctByMonths.entries()].map(([m, v]) => [m, v.toString()]),
    );
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/bc-installment-config.util.spec.ts` → `toBcConfig is not a function`
- [ ] **Step 3:** refactor `apps/api/src/utils/bc-installment-config.util.ts` — ยกก้อน map ออกมาเป็น `export function toBcConfig(row)` แล้วให้ `resolveBcConfigForCategory` เหลือแค่ `findFirst` (พร้อม `orderBy: { createdAt: 'asc' }` ของ Task 4) + `return { found: true, config: toBcConfig(config) }` — **ตรรกะเดิมทุกบรรทัด แค่ย้ายที่** (spec ของ Task 4 ทั้ง 5 เคสต้องยังเขียวโดยไม่แก้ assertion)
- [ ] **Step 4:** แก้ `apps/api/src/modules/staff-chat/services/product-quote.service.ts` — ในบล็อกกลางของ `computeProductQuote` ที่วันนี้สร้าง `ratePctByMonths` / fallback / `allowedMonths` เอง แทนด้วย:
```ts
  // B3 Task 14 — ห้ามมีตรรกะ resolve config 2 ก็อปในระบบ: ใช้ตัวเดียวกับ
  // InstallmentPreviewService (เว็บ) และ CalculateInstallmentTool (บอท)
  const bcConfig = toBcConfig(config);
  if (bcConfig.allowedMonths.length === 0) return { ...base, ...EMPTY_INSTALLMENT };

  const months = bcConfig.allowedMonths[bcConfig.allowedMonths.length - 1];
  const result = calcBcInstallment({ installmentPrice: dec(installment), months, config: bcConfig });
```
  พร้อม `import { toBcConfig } from '../../../utils/bc-installment-config.util';` และลบ `import Decimal` ที่ไม่ได้ใช้แล้วถ้ามี
- [ ] **Step 5:** พิสูจน์ว่าไม่มีอะไรเปลี่ยนค่า: `cd apps/api && npx jest src/modules/staff-chat/services/product-quote.service.spec.ts src/modules/staff-chat/services/product-detect.service.spec.ts` → **เขียวโดยไม่แก้ assertion ของ B2 แม้แต่บรรทัดเดียว** (นี่คือ golden ของการรวม resolver; ถ้าแดง = map ไม่ตรงกัน ให้ย้อน diff ไม่ใช่แก้ spec)
- [ ] **Step 6:** รันทั้ง module กันของเดิมพัง: `cd apps/api && npx jest src/modules/staff-chat src/modules/shop-catalog src/utils` → เขียว
- [ ] **Step 7:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint src/utils/bc-installment-config.util.ts src/modules/staff-chat/services/product-quote.service.ts` → ไม่มี error ใหม่
- [ ] **Step 8:** Commit: `refactor(inbox): ProductQuoteService ใช้ resolver InterestConfig ตัวเดียวกับเว็บ/บอท/สัญญา (B3 Task 14)`

### Task 15: ปิด batch — ตรวจทั้งระบบ + QA บนเบราว์เซอร์

**Files:** ไม่มีไฟล์ใหม่ (verification only)

- [ ] **Step 1:** `cd apps/api && npx jest src/utils src/modules/sales-bot src/modules/chatbot-finance src/modules/chat-engine src/modules/staff-chat src/modules/shop-catalog` → เขียวทั้งหมด ไม่มี suite ไหนแดง
- [ ] **Step 2:** `cd apps/api && npx tsc --noEmit` → 0 error; `npm run lint --workspace=apps/api` → ไม่มี error ใหม่เกินฐาน 34 จุดเดิม
- [ ] **Step 3:** `cd apps/web && npx vitest run src/pages/AiSettingsPage.status.test.tsx` → เขียว; `cd apps/web && npx tsc --noEmit` → 0; `cd apps/web && npx eslint .` → 0 error
- [ ] **Step 4:** ยืนยัน red line ด้วยสายตา: `git diff --stat main...HEAD` ต้อง **ไม่มี** ไฟล์ใต้ `apps/api/src/modules/journal/`, `apps/api/src/modules/accounting/`, `apps/api/src/modules/payments/`
- [ ] **Step 5:** ยืนยันว่า migration มีไฟล์เดียวและเป็น `ALTER ... DROP NOT NULL` เท่านั้น:
  `git diff main...HEAD --name-only -- apps/api/prisma/migrations` → ต้องเห็นแค่ `20260983000000_kb_channel_nullable/migration.sql`
  `grep -i "add column\|drop table\|drop column" apps/api/prisma/migrations/20260983000000_kb_channel_nullable/migration.sql` → ต้องไม่มีผลลัพธ์
- [ ] **Step 6:** ยืนยันว่าไม่มี `photos` (base64) หลุดเข้าเส้นทางบอท: `grep -rn "photos" apps/api/src/modules/sales-bot/ apps/api/src/modules/staff-chat/services/product-detect.service.ts` → ต้องไม่มีผลลัพธ์ที่เป็น Prisma `select`
- [ ] **Step 7:** ยืนยันว่าไม่มี module import ข้าม: `grep -rn "SalesBotModule\|ChatbotFinanceModule" apps/api/src/modules/chatbot-finance/ apps/api/src/modules/sales-bot/` → ต้องไม่มีการ import module ของอีกฝั่ง
- [ ] **Step 8:** QA local — `npm run dev` แล้วไล่ตามเช็กลิสต์ QA ใน "Deployment & Verification" ให้ครบทุกข้อ
- [ ] **Step 9:** Commit ปิดท้าย (ถ้ามีแก้จาก QA): `chore(bot): ปิด batch B3 — jest/tsc/eslint เขียวครบ`

---

## Deployment & Verification

### ลำดับ deploy (สำคัญ — มี migration)

1. **B0 ต้องอยู่บน `main` แล้ว** — B3 ใช้ `device-query-normalize.util.ts`, `product-readiness.util.ts` (`DEMO_NAME_PREFIX`), คอลัมน์ `accessoriesIncluded`/`cosmeticNotes` และต้องมีข้อมูล `cashPrice`/`installmentPrice`/`conditionGrade` จริงจาก backfill ของ B0 ไม่งั้นบอทจะตอบว่า "ยังไม่มีราคา" ทั้งกระดาน
2. Merge หลัง CI gate เขียว + code-owner review 1 คน (**owner กดเอง** — agent ห้าม `gh pr merge --admin` เว้นแต่ผู้ใช้พิมพ์อนุญาต bypass เป็นประโยคชัดเจน; ดู memory `qa-1347-reschedule-repossession-result`)
3. Deploy ปกติ (push `main` → GitHub Actions → Cloud Run + Firebase Hosting) — pipeline รัน `prisma migrate deploy` ให้เอง
4. **Migration `20260983000000` ปลอดภัยมาก**: `DROP NOT NULL` ไม่ rewrite table ไม่ล็อกยาว ไม่แตะข้อมูลเดิม (ทุกแถวยังเป็น `LINE_FINANCE`) — deploy web/api พร้อมกันได้
5. `apps/web` เรียก `GET /staff-chat/ai/status` (ใหม่) → **ต้อง deploy api ก่อนหรือพร้อมกัน** ห้าม deploy web อย่างเดียว (ไม่งั้น status strip หายไปเฉย ๆ — ไม่ crash เพราะ render เมื่อมี `statusQuery.data` เท่านั้น)

### ops step ที่ต้องทำหลัง deploy (ไม่ทำ = ฟีเจอร์ไม่ออกฤทธิ์)

| สิ่งที่ต้องทำ | ทำที่ไหน | ไม่ทำแล้วเป็นอะไร |
|---|---|---|
| **อัปเดต system prompt น้องเบส** ให้รู้จัก 3 tool ใหม่ | **ไม่มี UI — ต้องรัน SQL บน prod** (ดูบล็อกใต้ตาราง). โค้ดฝั่ง constant แก้ไปแล้วใน Task 10 แต่จะมีผลเฉพาะเมื่อ **ยังไม่มีแถว** `finance_bot_system_prompt` ใน `system_config` | Claude เห็น tool ใน `tools[]` แต่ prompt ไม่เคยบอกให้ใช้ → น้องเบสจะยังตอบ "ขอโทษค่ะ เรื่องสินค้าต้องสอบถามแอดมิน" เหมือนเดิม **นี่คือ ops step ที่พลาดบ่อยที่สุดของ batch นี้** |
| ตรวจ `SHOP_BASE_URL` บน Cloud Run | `gcloud run services describe <api> --format='value(spec.template.spec.containers[0].env)'` | `webUrl` เป็น null ทุกเครื่อง → บอทไม่ส่งลิงก์ (ไม่ crash) |
| ตัดสินใจเปิด/ปิด `FB_BOT_DISABLED` | env ของ Cloud Run (owner) | บอทไม่ตอบ Facebook เลย — status strip ใหม่จะบอกสถานะนี้ให้เห็นแล้ว |
| ตั้ง `shop_bot_central_branch_id` | `/settings` → AI Settings → SHOP Bot Setup | `shouldAutoReply` คืน false ทุกห้องของ LINE Shop/FB/WEB (`ai-auto-reply.service.ts:85-97`) → บอทขายเงียบสนิท |
| **แจ้งทีมสตาฟ: guard ของน้องเบสจะเข้าคิว handoff เอง** (Task 11) | บอกด้วยปาก/กลุ่มไลน์สตาฟ | ห้องที่ guard บล็อกจะถูกตั้ง `handoffMode = true` (`handoff.service.ts:31-38`) = **บอทเงียบทั้งห้องจนกว่าพนักงานจะเคลียร์** ถ้าไม่มีใครรู้ ลูกค้าจะค้างรอ. สัปดาห์แรกหลัง deploy ให้ดูจำนวน `HALLUCINATION_BLOCKED` ใน Cloud Run log ควบคู่ Sentry tag `action=grounding_blocked` — ถ้ารัวผิดปกติแปลว่าลืมคีย์ใน `FINANCE_GROUNDED_PRICE_KEYS` ไม่ใช่โมเดลมั่ว |

**วิธีอัปเดต prompt จริง (ไม่มี UI — ยืนยันกับโค้ดแล้ว):**

1. เช็กก่อนว่ามีแถวไหม (ถ้า **ไม่มี** = constant ที่แก้ใน Task 10 ทำงานอยู่แล้ว ข้ามข้อ 2 ได้):
```sql
SELECT key, length(value) AS len, updated_at
FROM system_config WHERE key = 'finance_bot_system_prompt';
```
2. ถ้ามีแถว → upsert ทับด้วย prompt ใหม่ (เนื้อหาเดิม + บล็อกด้านล่าง). `key` เป็น `@unique` จึง upsert ตรง ๆ ได้ และ `getSystemPrompt()` **ไม่กรอง `deletedAt`** จึงเห็นผลทันที:
```sql
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
VALUES (gen_random_uuid(), 'finance_bot_system_prompt', $$<prompt เต็มฉบับใหม่>$$, 'System prompt น้องเบส', now(), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```
3. **รอ ≤ 5 นาที** ก่อนทดสอบ — `FinanceAiService` cache prompt ไว้ 5 นาที (`PROMPT_CACHE_TTL`, `finance-ai.service.ts:54`) และ `invalidatePromptCache()` **ไม่มี caller** จึงล้าง cache ด้วยมือไม่ได้ (ทางเลือก: redeploy/restart revision เพื่อล้างทันที)
4. เก็บ prompt ฉบับที่ใช้จริงไว้ใน PR description ด้วย — ตอนนี้ไม่มีที่ไหนเก็บ history ของค่าใน DB

**ข้อความที่ต้องเติมใน system prompt ของน้องเบส (ทั้ง constant `prompts/system-prompt.ts` และค่าใน DB):**
```
# ตอบเรื่องสินค้าได้ด้วย
ถ้าลูกค้าถามเรื่องเครื่องใหม่/ราคา/ค่างวด/โปรโมชั่น ให้ใช้ tool เหล่านี้:
- search_products — ค้นสต็อกจริง ส่งคำที่ลูกค้าพิมพ์ไปได้เลย (ไทยก็ได้)
- calculate_installment — คำนวณค่างวดของเครื่องที่เจาะจงแล้ว (ต้องมี productId จาก search_products)
- list_promotions — โปรที่ใช้กับเครื่องนั้นได้จริง
กติกา: ห้ามบอกตัวเลขราคา/ค่างวดที่ไม่ได้มาจากผลลัพธ์ tool เด็ดขาด
ถ้าผลลัพธ์มี priceMissingCount > 0 แปลว่ามีเครื่องแต่ยังไม่ตั้งราคา — ให้บอกลูกค้าว่าจะให้พนักงานเช็คราคาให้
เครื่องที่ reserved = true คือ "มีของแต่ติดจองชั่วคราว" ห้ามบอกว่าไม่มี
```

### verify บน prod (หลัง deploy)

- [ ] `curl -s https://<api>/api/health` → 200
- [ ] ยืนยัน migration ลง: `SELECT is_nullable FROM information_schema.columns WHERE table_name='chat_knowledge_base' AND column_name='channel';` → `YES`
- [ ] `GET /staff-chat/ai/status` ด้วย token OWNER → คืน JSON 6 ฟิลด์ (ไม่ 404 = api ใหม่ขึ้นแล้ว)
- [ ] ทักบอทจากบัญชี LINE Shop ทดสอบ: **"ไอโฟน 15 โปรแม็กซ์ 256 มีไหม"** → ต้องได้ราคาจริง + ถ้ามีรูปในระบบต้องได้ **2 ข้อความ** (ข้อความแล้วตามด้วยรูป)
- [ ] ถามต่อ **"ผ่อน 12 งวดเดือนละเท่าไหร่"** → ตัวเลขต้องตรงกับที่กดในหน้าเว็บ `/products/:id` ของเครื่องเดียวกัน (เปิดเทียบจริง — นี่คือ red line)
- [ ] ถามรุ่นที่มีของแต่ยังไม่ตั้งราคา → บอทต้อง **ไม่เดาราคา** และต้องมีห้องขึ้น handoff badge ให้ staff (flow #1332)
- [ ] ทักน้องเบสจากบัญชี LINE Finance ทดสอบ: **"ยอดงวดนี้เท่าไหร่"** → ต้องยังตอบยอดได้ (พิสูจน์ว่า grounding guard ใหม่ไม่ block ตัวเลขการเงิน)
- [ ] ถามน้องเบสต่อ: **"มีไอโฟน 15 ขายไหม"** → ต้องตอบสินค้าได้ (ถ้ายังตอบไม่ได้ = ยังไม่อัปเดต prompt ใน DB)
- [ ] เช็ก Cloud Run log ว่าไม่มี `HALLUCINATION_BLOCKED` รัว ๆ — ถ้ามีแปลว่าลืมคีย์ใน `GROUNDED_PRICE_KEYS` (ดู log `grounded=[...]` เทียบกับเลขที่โดน block)

### QA เบราว์เซอร์ (local เท่านั้น — prod ปฏิเสธ seed accounts)

1. login `admin@bestchoice.com / admin1234` → `/settings` → AI Settings: เห็น "สถานะระบบ (แก้จากหน้านี้ไม่ได้)" 3 แถว และช่อง TikTok/LINE Finance มีข้อความ "ค่านี้ไม่มีผล"
2. หน้า FAQ ของน้องเบส: สร้าง FAQ ใหม่เลือก **"ทุกช่องทาง"** → บันทึกได้ และแถวในตารางแสดง "ทุกช่องทาง"
3. เปิด Unified Inbox ห้องที่ลูกค้าพิมพ์ชื่อรุ่น → การ์ดสินค้าแสดง **ค่างวดที่ตรงกับหน้าเว็บ** (Task 14) และรูปมาจาก gallery
4. ยิงข้อความเข้า webhook จำลอง (หรือใช้ปุ่ม "ส่งข้อความทดสอบ" ในหน้า AI Settings) แล้วดูใน inbox ว่าเห็น 2 bubble: ข้อความ + รูป และ bubble รูปมี `type=IMAGE`
5. เปิด DevTools → Network → `GET /staff-chat/ai/status` ตอบ 200 (ไม่ใช่ 403 — ต้อง login เป็น OWNER)

### Rollback

- **โค้ด**: revert commit ของ B3 ได้ตรง ๆ — บอทกลับไปตอบแบบเดิมทันที
- **Migration**: ไม่ต้อง revert (คอลัมน์ nullable ที่ทุกแถวมีค่าอยู่แล้ว = superset ของเดิม) ถ้าจำเป็นจริง ๆ ต้องล้าง `channel IS NULL` ก่อนแล้วค่อย `SET NOT NULL`:
  ```sql
  UPDATE chat_knowledge_base SET channel = 'LINE_FINANCE' WHERE channel IS NULL;
  ALTER TABLE chat_knowledge_base ALTER COLUMN channel SET NOT NULL;
  ```
- **ข้อความ/รูปที่ส่งไปแล้ว** = irreversible ตามธรรมชาติของแชท

---

## สิ่งที่ batch นี้ไม่ทำ

| ไม่ทำ | เหตุผล |
|---|---|
| แตะ `MessageRouterService` เพื่อให้น้องเบสใช้ | spec §0/§5: น้องเบสไม่เคยเดินผ่าน router (`finance-domain.handler.ts` เป็น stub) — แก้ router = แก้ผิดที่ 100% |
| ให้บอทกดจอง / hold เครื่องแทนลูกค้า | spec §8 ตัดออกชัดเจน; การจอง/ตัดหน้าเป็นงานของ B5 |
| ส่ง Flex card / carousel สินค้า | ยังไม่จำเป็น — text + image 2 bubble ตอบโจทย์ "ตอบได้เท่าแอดมิน" แล้ว และ Flex ต้องออกแบบ + แปลข้าม LINE/FB (FB ไม่มี Flex) เป็นงานดีไซน์แยก |
| ใช้ share endpoint `/api/shop/share/:id` เป็น `webUrl` | เป็นของ **B4** §6 — B3 ใช้ `${SHOP_BASE_URL}/products/:id` ตรง ๆ ไปก่อน (จุดแก้เดียวคือ `search-products.tool.ts` + `calculate-installment.tool.ts`) |
| idempotency ของข้อความบอท (`clientMessageId`) | trigger คือข้อความลูกค้า 1 ครั้ง ไม่ใช่ปุ่มที่กดซ้ำได้ (ต่างจาก primitive ของ B2 ที่ staff กดปุ่มเอง) — เพิ่มทีหลังได้โดยไม่ต้องรื้ออะไร |
| สลับ `ProductDetectService.extractKeywords` (:63-80) ไปใช้ `parseDeviceQuery` | ⚠️ **เจ้าของทับกันใน spec** — §2.4 บอกว่าผู้ใช้ util คือ inbox detect (B2), §4 บอก "detection ใช้ util B0", §5 บอกแค่ "เลิกคิดค่างวดเอง"; B2 จงใจไม่แตะ (แผน B2 :2515 ระบุ "`extractKeywords` :63-80 คงเดิม") และ B3 ก็ไม่แตะ `product-detect.service.ts` เลย (Task 14 ถูกย่อเหลือแค่รวม resolver) ⇒ การเปลี่ยน detection คือ behavior change ของทั้งกล่องแชท ต้องมี owner เคาะ + spec เทียบผลลัพธ์เดิมก่อน |
| เดิน `channel` ของห้องเข้า `SalesBotInput` เพื่อกรอง KB ต่อช่อง | `SalesBotInput` (`sales-bot.service.ts:23-28`) ไม่มีฟิลด์นี้ — ต้องแก้ทั้ง `AiAutoReplyService` + `MessageRouterService` เพื่อผลลัพธ์ที่เหมือนเดิม (FAQ ของ 3 ช่องบอทขายเป็นชุดเดียวกัน) → ใช้ `channel IN (LINE_SHOP, FACEBOOK, WEB) OR NULL` แทน |
| แก้ `list_promotions` ให้คืนตัวเลขส่วนลด (`discountValue`) | ต้องเพิ่มคีย์ใน `GROUNDED_PRICE_KEYS` + ตัดสินใจว่า % vs บาท แสดงยังไงในแชท — ตอนนี้เลขส่วนลดอยู่ในข้อความที่แอดมินเขียน (`description`) ซึ่ง `collectGroundedPricesFromText` รองรับแล้ว |
| ย้าย `GET_INSTALLMENT_RATES_TOOL` เข้าน้องเบส | น้องเบสได้ `search_products` + `calculate_installment` ซึ่งอิงสต็อก/ราคาจริงแล้ว; เรตกลางจาก PricingTemplate เป็นทางหนีของบอทขาย (#1332 flow) ที่ผูกกับ handoff ของ MessageRouter — ยกมาโดยไม่มี flow นั้นจะได้แค่ตัวเลขลอย |
| แก้บั๊ก bot-defense 429 / crawler classification | เป็นของ **B4** §6 |
| ซ่อน `costPrice` จาก SALES | เป็นของ **B1** §3 — tool ของ B3 **ไม่ select `costPrice` เลย** จึงไม่มี leak ใหม่ |
