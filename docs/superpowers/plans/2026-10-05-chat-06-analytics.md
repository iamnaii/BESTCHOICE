# F6 Human, Bot and Sales Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รายงานตอบคำถามได้ว่าใครรอ ใครตอบ งานค้างตรงไหน และมีรายการขายที่เชื่อมกับแชทเท่าไร โดยไม่ยกผลงานบอทให้คน

**Architecture:** response cycles จาก F1 เป็นแหล่งเวลารอ; staffId เหตุการณ์เป็นผู้ตอบ; Journey/เอกสารขายเดิมเป็น funnel และยอดขาย อ่านเป็น aggregates แบบ scoped ไม่เขียนยอดขายซ้ำ

**Tech Stack:** NestJS/Prisma/SQL aggregates, Decimal, React/Recharts เดิม, isolated data fixtures

**Spec:** [design](../specs/2026-10-05-chat-operations-six-features-design.md), [master](2026-10-05-chat-operations-master.md); ขึ้นกับ F1–F5

## Global Constraints

กติกา 1–10 ของ spec. ไม่นับ BOT เป็นคน, ไม่ใช้ assignedTo ปัจจุบันแทนผู้ตอบ, unknown ไม่ใช่ zero, ไม่อ้างยอดขายจากแชทเป็น causal attribution, ไม่แก้ค่าคอมจริง

## Review Focus

- retention/legacy echo ไม่มี staff identity: T1/T2
- response cohort คร่อมวันกับงานค้างปัจจุบันไม่ปนกัน: T1
- void/refund/ขายซ้ำลูกค้าเดียว/merge ทำให้ยอดนับซ้ำ: T2
- บริษัท/สาขา/filters/exports ต้องนิยามเดียวกัน: T2/T3
- ค่าเฉลี่ยบิดเมื่อ unknown/no-samples/จำนวนห้องไม่เท่ารอบตอบ: T1/T3

### Task 1: นิยาม metrics และ API v2

**Files:** Create `packages/shared/src/chat-analytics.ts`, `apps/api/src/modules/chat-analytics/chat-analytics-v2.service.ts`, `chat-analytics-v2.service.spec.ts`, `dto/chat-analytics-query.dto.ts`, `apps/api/e2e/chat-operations-analytics.e2e-spec.ts`; modify `chat-analytics.controller.ts`, `chat-analytics.module.ts`, shared index

**Interfaces:** `GET /chat-analytics/v2/overview`, `/v2/staff`, `/v2/work`, `/v2/funnel`, `/v2/sales`; input `{from,to,company,branchId?,channel?,staffId?}`, from inclusive/to exclusive ISO with timezone; server caps range=366 days, validates from<to. Response always includes `{period,observedAt,coverage:{from,legacyExcluded,unknownStaffCycles},...}`. `/v2/work` returns `{handoffs:{created,accepted,completed,overdueNow},followUps:{due,completed,overdueNow},comments:{received,confirmedReplies,unresolvedNow},serviceRequests:{created,linkedToCase,resolved,overdueNow}}`; range counts มาจาก event เวลาเกิด ไม่ใช่สถานะล่าสุดของ row

- [ ] Fixture LIVE cycle เริ่ม 10:00 BOT success10:01 HUMAN success10:06 ต้องนับ botMinutes=1, humanMinutes=6; human attribution ใช้ sender staff A แม้ owner ปัจจุบัน B; failed staff 10:02 ไม่เป็น response
- [ ] Define helpers `minutesUntil(start:Date,at:Date|null):number|null`, `percentileNearestRank(samples:number[],p:number):number|null` ใน v2 service หรือ pure `chat-metrics.ts` (หากแยกให้เพิ่มไฟล์ใน task). actual acceptance:

```ts
expect(minutesUntil(new Date('2026-10-05T03:00:00Z'), null)).toBeNull();
expect(percentileNearestRank([], 0.9)).toBeNull();
expect(percentileNearestRank([1, 2, 3, 4, 20], 0.9)).toBe(20);
```

- [ ] SQL aggregate cycles startedAt ใน `[from,to)` เป็น cohort; include eventual first responses จน observedAt พร้อม label. แยก openWorkNow ณ observedAt ซึ่งไม่ใช่ historical backlog ณ to; requests asking historical point-in-time ไม่รับถ้ายังไม่มี snapshot data
- [ ] Work metrics อ่าน TodoWorkEvent ของ F2/F4, FacebookCommentEvent/Reply ของ F3 และ ChatServiceRequest กับ case source ของ F5; distinct ตาม task/comment/request keys เดียวกับคิว. ถ้า event ประวัติของ service status ยังไม่มี เพิ่ม `ChatServiceRequestEvent` append-only ใน F5-T1 และเขียนทุก transition/link; ไม่อนุมานเวลาเปลี่ยนสถานะจาก updatedAt. ทดสอบงานเดียวมี Todo+service request ไม่ถูกนับเป็นสองงานในยอดรวม และ completed/linked แยกกัน
- [ ] Human metrics: nResponded/nAwaiting/nResolvedWithoutReply, median/p90 business wait, firstBot response, SLA breach policyVersion ของแต่ละ cycle. completed human response ไม่เฉลี่ยร่วมกับ unresolved; unknownStaff แยก category. count rooms vs cycles มีคนละ label
- [ ] Legacy_OPEN ไม่รวมเวลาตอบที่พิสูจน์ไม่ได้; ก่อน cutover แสดง “ยังไม่มีข้อมูลแยกคน/บอท” ไม่ดึง firstResponseAt รวมมาปะ. response cycle retention ต้องเก็บ aggregate timestamps ตามนโยบายที่เลือกโดยไม่พึ่งข้อความที่อาจถูก soft-delete 6 เดือน
- [ ] Unit + isolated analytics tests รวมข้ามเที่ยงคืน, ตอบหลัง to, missing staff, policy เปลี่ยน, empty range; commit `feat(analytics): separate human and bot response metrics`

### Task 2: Funnel, source attribution และยอดขายไม่ซ้ำ

**Files:** Create `apps/api/src/modules/chat-analytics/chat-sales-attribution.service.ts`, `chat-sales-attribution.service.spec.ts`, `apps/api/e2e/chat-operations-sales-attribution.e2e-spec.ts`; modify v2 service and use existing `customer-journey/journey-summary.service.ts`, `customer-journey/sql/journey-state.sql` and sales/contract query helpers through their exported APIs (ไม่สร้าง BOUGHT_WHERE สำเนา)

**Interfaces:** `salesSummary(query,actor):Promise<{amount:string;documentCount:number;customerCount:number;unmatchedCount:number;basis:string}>`; `funnel(query,actor)` returns `{cohortDefinition,stageBasis:'CURRENT',steps,lossReasons,coverage}`. `amount` Decimal string ไม่ใช้ float

- [ ] เลือก funnel cohort = canonical customers ที่มี first inbound chat ในช่วง; stage = current evidence ณ observedAt. lost เป็น overlay ป้ายเหตุผล ไม่ลบคนออกจาก denominator; stages skipped เช่น CASH ต้องมี skipped count
- [ ] นิยาม sales cohort = เอกสารขายเข้าเงื่อนไขในช่วงและมี inbound chat ของ canonical customer ก่อน sale time; line items/contract links ตรวจจาก source เดิม. label “ยอดขายที่เชื่อมโยงกับแชท” และ unknown/unmatched แยก; ห้ามพูดว่าโฆษณาหรือแชทเป็นเหตุให้ขายได้โดยไม่มีหลักฐาน
- [ ] เขียน fixture ลูกค้าคนเดียวมีสองห้อง + placeholder merge + CASH sale หนึ่งใบ + installment sale ที่ผูก contract หนึ่งคู่: documentCount ต้องนับ business sale สองรายการไม่ใช่สาม. void/refund ใช้นิยามยอดสุทธิเดิมของ reports และแสดง basis ชัด ไม่ผสม principal FINANCE กับ retail SHOP
- [ ] สร้าง attribution resolver ที่คืน `businessSaleKey` จาก relation จริงและใช้ DISTINCT ก่อน aggregate; snapshot salesperson จาก sales/contract source ที่มีอยู่ ถ้าไม่มีให้ unknown ไม่ใช้ room owner ใหม่แทน. ชื่อผู้ตอบและเจ้าของยอดอยู่คนละฟิลด์
- [ ] ทดสอบ SALES/BM ข้ามสาขา, FINANCE-only, shared customer across companies, export filter เหมือน on-screen, null/ไม่มีหลักฐานไม่เป็นยอดศูนย์. ห้ามเขียนยอดลง commission หรือสร้าง attribution ย้อนหลังโดยเดา
- [ ] รัน isolated attribution suite + sales-read-scope/report regression ที่เกี่ยวข้อง; commit `feat(analytics): report scoped chat-linked sales and journey funnel`

### Task 3: Dashboard, drill-down และการตรวจรับทั้งหก

**Files:** Modify `apps/web/src/pages/ChatAnalyticsPage.tsx`; create `apps/web/src/pages/chat-analytics/ResponseMetrics.tsx`, `StaffPerformanceTable.tsx`, `ChatSalesFunnel.tsx`, `AnalyticsCoverage.tsx`, `analytics-format.test.ts`, `apps/web/e2e/chat-operations-analytics.spec.ts`; add formatter `analytics-format.ts` in same folder; wire API route/feature flags and scoped query keys

**Interfaces:** cards consume API v2 shared types; drill-down links carry same scope/period/staff/channel; formatter `formatMetric(value:number|null,unit:string):string` แสดง null ว่าไม่มีข้อมูล ไม่ใช่ 0

- [ ] UI 4 กลุ่ม: งานค้างตอนนี้ / ความเร็วตอบของคนกับบอท / งานทีมและการส่งต่อ / funnel และยอดที่เชื่อมกับแชท. ไม่มี scoreboard “คนตอบเร็วที่สุด” ที่รวม BOT/unknown
- [ ] Formatter tests:

```ts
expect(formatMetric(null, 'นาที')).toBe('ยังไม่มีข้อมูล');
expect(formatMetric(0, 'นาที')).toBe('0 นาที');
```

- [ ] ส่วน coverage บอกวันเริ่มเก็บ, legacy excluded, unknown staff และ current-stage basis ของ funnel. ใช้ median/p90 พร้อม sample size และ denominator ของ rates ทุกตัว
- [ ] Click metric → รายการที่อธิบายยอดนั้นได้ ภายใต้ scope เดิม; sum drill-down เท่ากับ total หลัง pagination. หากข้อมูลเปลี่ยนระหว่างดูแสดง observedAt/refresh ไม่แสร้ง snapshot; query errors ต้อง retry ไม่เป็นศูนย์
- [ ] Integrated E2E: รับแชท → BOT → ส่งล้ม → human success → นัดติดตาม → ส่งงานและจบ → comment fixture → service request/case → sale → ตรวจ staff response attribution/ยอดไม่ซ้ำ. มือถือ 390px และ desktop 1440px
- [ ] รัน F1–F6 isolated suite, targeted web tests, broader isolated API regression ตาม master แล้ว `npm run local:check`. เก็บผล/URL/สิ่งจำลองใน `docs/reports/2026-10-05-chat-operations-verification.md` เมื่อทำจริง ไม่สร้างผลผ่านล่วงหน้า. commit `feat(analytics): expose actionable chat operations dashboard`

**รับงาน F6:** ทุกตัวเลขไล่กลับถึงหลักฐานได้ แยก bot/human/unknown และ responder/sales owner ชัด ไม่มีนับซ้ำจาก merge หรือ sale-contract links และรายงานไม่รั่ว scope
