# BESTCHOICE Chat Operations — Six Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes planning only; do not interpret it as authorization to deploy or message customers.

**Goal:** ส่งมอบคิวงาน, สถานะขาย/ติดตาม, คอมเมนต์ Facebook, Mention/ส่งงาน, หลังการขายจากแชท และรายงานแยกคนกับบอท

**Architecture:** ต่อยอด UnifiedInbox, ChatRoom, Todo, Customer Journey และ AfterSales เดิม เพิ่ม staff inbox และ response cycles ที่ใช้ร่วมกัน แยกคอมเมนต์สาธารณะจาก DM และแยกใบรับเรื่องทางแชทจากการรับฝากเครื่องจริง

**Tech Stack:** React 18, TypeScript, Vite, TanStack Query, NestJS, Prisma/PostgreSQL, Jest, Vitest, Playwright

**Spec:** [ข้อกำหนดทั้ง 6 ฟีเจอร์](../specs/2026-10-05-chat-operations-six-features-design.md)

**UX reference:** [โครงหน้าจอและ interaction contracts](../specs/2026-10-05-chat-operations-ux-design.md) · [ต้นแบบกดใช้งาน](../../prototypes/chat-operations/index.html). Prototype เป็นข้อมูลจำลอง ไม่ถือว่า acceptance ฝั่ง API/permissions/Meta ผ่านแล้ว

## Global Constraints

- ใช้ข้อ 1–10 ใน Global constraints ของ spec ทุกข้อ รวม scope, first-successful-reply ownership, evidence-derived Journey และตรวจ local จาก checkout เดียวกัน
- ไม่แก้ `docs/superpowers/plans/2026-10-04-bestchoice-remaining-work.md` ซึ่งเป็น untracked work ที่มีอยู่ก่อน
- ไม่เปลี่ยน source code ในการจัดทำแผนนี้; การลงมือจริงเริ่มใน checkout/worktree ของงานและอ่าน workflow/rules ใหม่
- ค่า SLA 5/15 นาทีเป็นค่าเสนอ ปรับใน settings ได้; feature flags ปิดบน production จนผ่าน gate ของชุดนั้น

## Review Focus

1. scope ของ list/count/deep link/WebSocket ต้องตรงกัน; มี tests ใน F1-T1 และ F3-T2
2. webhook/retry/cron สองตัวพร้อมกันต้องไม่สร้างงาน/แจ้งเตือน/ส่งซ้ำ; F1-T2/T3, F3-T2/T3, F4-T1/T2
3. หลังเที่ยงคืน/นอกเวลางาน/เปลี่ยนวันนัด ไม่ยิงเตือนผิดวัน; F1-T3 และ F2-T2
4. customer merge/ห้องเปลี่ยนเจ้าของ/ถอนสิทธิ์ ไม่ย้ายเครดิตหรือรั่วข้อมูล; F2-T1, F4-T2 และ F6-T2
5. ข้อมูลเก่าไม่มีหลักฐานและใบรับเรื่องที่ยังไม่รับฝากเครื่อง ต้องไม่ถูกแสดงเป็นข้อเท็จจริงใหม่; F5-T2 และ F6-T1/T2

## แผนย่อยและ dependency

| ลำดับ | แผน | ผลที่ตรวจรับได้ | ขึ้นกับ |
|---|---|---|---|
| 1 | [F1 คิวงานและ SLA](2026-10-05-chat-01-work-queue.md) | เปิด Inbox เห็นงานวันนี้และเตือนถึงคนจริง | ไม่มี |
| 2 | [F2 สถานะขายและติดตาม](2026-10-05-chat-02-sales-follow-up.md) | เห็นหลักฐานการขายและนัดทำงานต่อ | F1 |
| 3 | [F4 Mention/ส่งงาน](2026-10-05-chat-04-team-handoff.md) | รับงาน/จบงานโดยไม่เปลี่ยนเจ้าของยอด | F1, F2 Todo revision |
| 4 | [F3 คอมเมนต์ Facebook](2026-10-05-chat-03-facebook-comments.md) | คอมเมนต์เป็นคิว มีคนตอบและหลักฐานการส่ง | F1; Meta capability gate |
| 5 | [F5 หลังการขาย](2026-10-05-chat-05-service-cases.md) | รับเรื่องจากแชทและตามเคสเดิมได้ | F1, F2, F4 |
| 6 | [F6 รายงานทีม](2026-10-05-chat-06-analytics.md) | วัดคน/บอท/งานค้าง/ยอดขายตามนิยาม | F1–F5 |

แยก PR ตาม task boundary ของแต่ละแผน ไม่รวมทั้งหกเป็น PR เดียว. F3-T1 ตรวจ capability แบบ read-only ได้ก่อนลำดับที่ 4; หาก Meta ยังไม่พร้อม ส่งอีกห้าฟีเจอร์ต่อได้ และรายงาน F3 ว่ายังไม่ผ่าน live integration

## สัญญาร่วมที่ต้องรักษา

เพิ่ม shared `chat-work.ts` ใน F1 และ export จาก `packages/shared/src/index.ts`:

```ts
export type ChatWorkKind = 'ROOM_WAIT' | 'TODO' | 'FACEBOOK_COMMENT' | 'SERVICE_REQUEST';
export type WorkQueueView = 'WAITING' | 'UNASSIGNED' | 'TODAY' | 'OVERDUE' | 'FOR_ME';
export interface ChatWorkItem {
  key: string; kind: ChatWorkKind; roomId: string | null;
  title: string; assigneeId: string | null; dueAt: string | null;
  waitingSince: string | null; targetType: string; targetId: string;
}
export interface ChatWorkPage {
  data: ChatWorkItem[]; total: number; page: number; limit: number;
  counts: Record<WorkQueueView, number>; observedAt: string;
}
export interface StaffInboxInput {
  recipientId: string;
  kind: 'CHAT_SLA' | 'FOLLOW_UP' | 'MENTION' | 'HANDOFF' | 'SERVICE_REQUEST';
  roomId?: string; todoId?: string; dedupeKey: string;
  title: string; targetType: string; targetId: string;
}
```

Access service methods: `assertRoom(roomId, actor, scope): Promise<void>`, `assertTodo(todoId, actor, scope): Promise<void>`, `eligibleStaff(roomId, actor, scope): Promise<Array<{id:string;name:string}>>`. Queue list ใช้ predicate/query builder ภายในบริการเดียวกัน ไม่อ่านทุกห้องแล้วกรองใน JavaScript. `StaffInboxService.enqueue(tx: Prisma.TransactionClient, input: StaffInboxInput): Promise<{id:string}|null>` คืน null เมื่อ master toggle ปิด. ทุก endpoint อ่าน actor จาก auth ไม่รับ actorId เพื่อเลือกสิทธิ์จาก body

## Verification recipe สำหรับผู้ลงมือ

อ่าน `workflows/create-api-module.md`, `workflows/add-api-endpoint.md`, `workflows/prisma-changes.md`, `workflows/create-page.md` และ rules ที่เกี่ยวข้องก่อนแก้จริง

Unit test แบบไม่มี DB:

```bash
npm --prefix apps/api test -- --runTestsByPath src/modules/staff-chat/services/chat-work-access.service.spec.ts
npm --prefix apps/web test -- src/pages/UnifiedInboxPage/components/WorkQueue.test.tsx
```

F1-T1 เพิ่ม config `apps/api/e2e/jest-chat-operations.json` และขยาย harness เดิมด้วยตัวเลือก allowlist `CREDIT_SUITE=chat-operations` เท่านั้น: default ใช้ `jest-chat-credit.json` เหมือนเดิม; อย่ารับ path อิสระจาก env. ภายในชุดใหม่ใช้ pattern `e2e/chat-operations-.*\.e2e-spec\.ts$`. ทุกแผนเพิ่ม test ของตัวเองลงชุดนี้ แล้วรัน:

```bash
CREDIT_SUITE=chat-operations bash tools/test-chat-credit.sh
npm run local:check
```

Harness ต้องสร้าง PostgreSQL แยกตามเดิม ไม่ใช้ DATABASE_URL ที่สืบทอดมา; ไม่รัน db.spec ตรงบนฐาน application. ขยาย managed preview ด้วย synthetic endpoints เฉพาะ feature ที่เพิ่ม หรือเปิด app/API เต็มจาก checkout เดียวกันบน DB แยก. เพิ่ม scenario ของคิว, notification, comments, service request และ analytics ให้ preview ตรวจจริง ไม่อ้างว่า smoke เดิมครอบคลุมเอง

หลังผ่าน F6 รัน API regression บน harness ที่แยกทั้งฐานหลักและ FINANCE ด้วย `CREDIT_RUN_API_REGRESSION=1 bash tools/test-chat-credit.sh` และตรวจ receipt/contract/after-sales ที่เกี่ยวข้องเท่านั้น ไม่ทำ backfill หรือ migration บน production ในขั้นนี้

## Rollout / ย้อนกลับ

- flags แยก: `chat_work_queue_enabled`, `chat_sla_alerts_enabled`, `chat_follow_up_enabled`, `chat_mentions_enabled`, `chat_facebook_comments_enabled`, `chat_service_requests_enabled`, `chat_analytics_v2_enabled`
- เปิด local synthetic ก่อน → environment ทดสอบพร้อม scoped accounts → pilot ทีมเล็ก. live activation/deploy เป็นขั้นต่างหากจากแผนนี้
- ปิด flag หยุด UI/cron/write ใหม่ แต่ไม่ลบข้อมูล; preserve read/export ของข้อมูลเก่าให้ OWNER ที่มีสิทธิ์ การ roll back schema ไม่ drop ตารางใหม่
- ติดตาม duplicate notification count, overdue queue mismatch, failed webhook persistence, unknown outbound status, orphan service link, metric coverage

## Completion checklist

- [ ] F1–F6 ผ่าน acceptance ของแต่ละแผน
- [ ] tests แยกบริษัท/สาขา/ถอนสิทธิ์/ข้อมูลเก่า/ส่งล้มผ่าน
- [ ] ไม่มี counter หรือสถานะที่เปลี่ยนความหมายโดยไม่เปลี่ยน label
- [ ] บันทึก Meta capability ที่ยืนยันได้จริง และส่วนที่จำลองอย่างตรงไปตรงมา
- [ ] `local:check` ผ่านจาก source ล่าสุด พร้อม URL ที่ยังเปิดได้และผล flow ใหม่
- [ ] ผู้ตรวจอ่านแผนกับ spec แล้วไม่พบ requirement ตกหล่น; ไม่ merge/deploy อัตโนมัติ

### UX V2 review artifact — 6 October 2026

User-requested `ui-ux-pro-max` redesign now includes a [source parity inventory](../../reports/2026-10-06-chat-ux-v2-parity.md) to prevent dropping existing Inbox work. Review http://localhost:5286 and [prototype scope](../../prototypes/chat-operations/README.md) before production integration. This completes the revised design prototype, not the six backend/frontend implementation plans above.
