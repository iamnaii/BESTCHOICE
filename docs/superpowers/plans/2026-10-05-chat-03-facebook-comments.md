# F3 Facebook Comment Work Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** คอมเมนต์ลูกค้าไม่ตกหล่น มีเจ้าของงาน และแยกการตอบสาธารณะจากแชทส่วนตัวชัดเจน

**Architecture:** เพิ่ม comment ingestion/queue ข้าง Facebook DM adapter เดิม เก็บ provider events แบบ idempotent; room/customer links เป็น optional ที่มี audit ไม่แปลง comment เป็น DM

**Tech Stack:** NestJS/Prisma, existing Facebook webhook HMAC, React, mocked provider + isolated DB

**Spec:** [design](../specs/2026-10-05-chat-operations-six-features-design.md), [master](2026-10-05-chat-operations-master.md); ขึ้นกับ F1

## Global Constraints

กติกา 1–10 ของ spec. ห้าม subscribe/change Meta app จริงหรือส่งคอมเมนต์จริงระหว่าง local checks. เก็บ pageId ในทุก identity key. ไม่สร้าง PSID จาก author ID/ชื่อ. private reply ปิดจนมีหลักฐาน capability

## Review Focus

- สิทธิ์ provider ยังไม่พร้อม: T1 มี explicit disabled capability
- webhook ซ้ำ/กลับลำดับ/ลบก่อนเพิ่ม/เพจปลอม: T2
- comment author คนชื่อเดียวกันไม่ merge เป็นคนเดียว: T2
- ส่งตอบสำเร็จแต่ timeout/echo แข่งกัน: T3
- public composer ไม่ปนโน้ต/ข้อมูลเครดิต: T3

### Task 1: พิสูจน์ capability และกำหนด provider contract

**Files:** Create `docs/guides/facebook-comments-capability.md`, `apps/api/src/modules/chat-adapters/facebook-comment-client.ts`, `facebook-comment-client.spec.ts`, `apps/api/src/modules/chat-adapters/facebook-comment-capability.ts`

**Interfaces:** `FacebookCommentClient.getCapabilities(pageId): Promise<{receive:boolean;publicReply:boolean;privateReply:boolean;reason:string|null;graphVersion:string}>`; `replyPublic({pageId,commentId,text}):Promise<{status:'CONFIRMED';externalId:string}|{status:'UNKNOWN';errorCode:string}|{status:'FAILED';errorCode:string}>`. อย่า return success ถ้าไม่มี provider acknowledgement

- [ ] อ่าน version และ token routing ใน `facebook.adapter.ts`, integration settings และ Facebook app review module โดยไม่พิมพ์ token. ตรวจเอกสารทางการของ version นั้นและ test app's permission/subscription inventory แบบ read-only
- [ ] บันทึก receive payload, edit/remove ordering fields, permissions, page token ownership, allowed public reply endpoint, private reply eligibility/window, token expiry behavior พร้อมวันที่และ URL ใน capability doc. สิ่งที่อ่านไม่ได้ระบุ `UNVERIFIED` และ capability=false; ไม่ใช้ blog ภายนอกเป็นข้อยืนยัน
- [ ] วันที่จัดทำแผน Meta docs ตอบ 429 จึงต้องใช้ gate นี้จริง. หากยังเข้าเอกสารไม่ได้ งาน receive fixture/UI ดำเนินต่อได้ แต่ live-send acceptance ยังไม่ผ่าน; ห้ามเดา private-reply endpoint
- [ ] Unit contract test ค่าปิด:

```ts
const caps = capabilityFromEvidence({ graphVersion: 'test', verified: false });
expect(caps).toEqual({ receive: false, publicReply: false,
  privateReply: false, graphVersion: 'test', reason: 'ยังไม่ยืนยันสิทธิ์การเชื่อมต่อ' });
```

นิยาม pure helper `capabilityFromEvidence(input:{graphVersion:string;verified:boolean;receive?:boolean;publicReply?:boolean;privateReply?:boolean})` ใน capability file; verified=false ต้อง override ทุก boolean เป็น false

- [ ] ทดสอบ adapter ด้วย fixture response error/token expired/rate limit/timeout ไม่มี network; endpoint mapping อยู่จุดเดียวใน client หลังยืนยัน T1. commit `docs(chat): define Facebook comment capability gate`

### Task 2: รับ webhook เป็นงานโดยไม่สูญหายหรือ merge คนผิด

**Files:** Modify `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts`, `chat-adapters.module.ts`, schema; create migration `20261005000400_facebook_comment_queue/migration.sql`, `facebook-comment-ingest.service.ts`, `facebook-comment-ingest.service.spec.ts` ใน chat-adapters; create `apps/api/src/modules/staff-chat/facebook-comments.controller.ts`, `dto/facebook-comment.dto.ts`, `services/facebook-comment-work.service.ts`, `apps/api/e2e/chat-operations-comments.e2e-spec.ts`

**Interfaces:** โมเดล Thread/Event ตาม spec เพิ่ม unique `(pageId,rootCommentId)` และ event key ที่รวม verb+provider revision/content hash เมื่อ provider ไม่มี delivery ID. event timestamp อย่างเดียวห้ามใช้ dedupe การแก้ไข. `ingest(entry):Promise<{persisted:number}>`. API `GET /staff-chat/facebook-comments`, `PATCH /staff-chat/facebook-comments/:id/assign`, `PATCH /staff-chat/facebook-comments/:id/status`, `PATCH /staff-chat/facebook-comments/:id/link`; link ต้องมี expectedRevision และ evidence reason

- [ ] Write fixture tests: signed page payload มีทั้ง messaging และ changes ใน entry เดียว ต้องประมวลผลทั้งคู่; pageId ไม่อยู่ configured allowlist ถูก reject/ignore พร้อม metric; HMAC fail ไม่เขียน DB
- [ ] ต่อ branch changes หลัง verify raw HMAC เดิม แยก parser จาก messaging. durable persist ก่อน ACK; DB unavailable ให้ retryable failure ไม่ตอบ success ที่ทำงานหาย. ถ้า batch บางรายการสำเร็จแล้ว retry ต้อง dedupe เฉพาะที่บันทึกแล้ว ไม่ทำ DM ซ้ำ
- [ ] ใช้ unique + row version/lock ต่อ thread; retain tombstone สำหรับ remove. หาก payload ไม่มีลำดับที่พิสูจน์ว่าใหม่กว่า ให้ mark needs reconciliation และ refetch provider state ผ่าน client; ห้าม resurrect จาก arrival order. sanitize text/render เป็น text ไม่ innerHTML
- [ ] Identity test ที่ต้องมี:

```ts
expect(commentIdentityKey('page-A', 'author-7')).not.toBe(
  commentIdentityKey('page-B', 'author-7'),
);
// helper defined in facebook-comment-ingest.service.ts
// commentIdentityKey(pageId, authorId) = `facebook-comment:${pageId}:${authorId}`
```

ทดสอบต่อใน DB ว่าชื่อเหมือน Messenger customer ไม่ตั้ง customerId/roomId ให้เอง. link/unlink ต้องตรวจ actor เข้าถึง comment/customer/room ทุกตัวและมี audit โดยไม่แก้ sale attribution

- [ ] Work service คืน scope-consistent counts/pagination. งาน comment ใช้ assignee ของตัวเอง ไม่เรียก claimIfUnassigned ของ DM room. edit ลูกค้าหลัง resolved เปิดงานใหม่ตาม revision; page's own reply ไม่เปิดงานลูกค้าเอง
- [ ] รัน unit + isolated comments suite (duplicate event 20 ครั้งยังมี thread เดียว; add/edit/delete/retry แข่งกัน); regression Facebook messaging เดิมต้องผ่าน. commit `feat(chat): ingest Facebook comments as scoped work`

### Task 3: Public reply, outbound uncertainty และ UI

**Files:** Create `apps/api/src/modules/chat-adapters/facebook-comment-reply.service.ts`, `facebook-comment-reply.service.spec.ts`; create `apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx`, `FacebookCommentPanel.test.tsx`, `hooks/useFacebookComments.ts`, `apps/web/e2e/facebook-comment-work.spec.ts`; modify Facebook comments controller, F1 work query and Inbox host; schema add `FacebookCommentReply` ใน migration แยก `20261005000500_facebook_comment_reply/migration.sql`

**Interfaces:** `POST /staff-chat/facebook-comments/:id/replies` `{clientRequestId,text}`; reply row unique requestKey, threadId, authorId, text, status PENDING/CONFIRMED/FAILED/UNKNOWN, externalId nullable, timestamps. Capability=false ตอบ 409 พร้อม reason; clientRequestId retry ต้องคืนสถานะเดิม ไม่ส่งใหม่เงียบ ๆ

- [ ] Contract tests success acknowledgement, hard provider error, timeout หลังส่ง: timeout ต้องเป็น UNKNOWN และ thread ยังไม่เป็น RESPONDED. Retry UNKNOWN ทำ reconciliation ก่อน ไม่มี blind resend; ไม่มี external ID proof ให้พนักงานเปิด Meta ตรวจแล้ว reconcile พร้อม audit
- [ ] UI มี header “คอมเมนต์สาธารณะ”, post permalink, parent/replies, assignee, status; ปุ่ม “ตอบสาธารณะ” แยกจากโน้ตและเปิด Messenger. ไม่ reuse canned credit/financial template ใน public composer
- [ ] Button enable predicate ที่ต้องทดสอบ:

```ts
export function canReplyPublic(input: {
  capability: boolean; deleted: boolean; pending: boolean; text: string;
}) {
  return input.capability && !input.deleted && !input.pending && input.text.trim().length > 0;
}
```

เพิ่มใน component helper หรือแยก pure fileและใช้จาก UI; server ตรวจ predicate/authorization ซ้ำ. เมื่อพบ Meta self-reply echo ให้ reconcile กับ reply pending ถ้าระบุได้แน่นอน ไม่สร้างสองคำตอบ

- [ ] เชื่อมคิว F1 kind FACEBOOK_COMMENT, deep link และ notifications เฉพาะ staff. DM follow-up link ไม่ตั้งสถานะ “ทักแล้ว” จนมีหลักฐานการส่งจริง. privateReply ยังคง disabled ตาม T1 ถ้าไม่ผ่าน
- [ ] รัน 1440/390 e2e บน signed fixture/local provider และ `npm run local:check`; output แยก “local ผ่าน” กับ “live Meta ยังไม่ยืนยัน”. commit `feat(inbox): manage and reply to Facebook comment work`

**รับงาน F3:** ไม่มี comment ตกจาก retry, ไม่ผูกคนผิด, ทีมรู้ว่างานไหนตอบแล้วจาก acknowledgement จริง. การเปิดรับ/ส่งจริงต้องผ่าน capability test บน test app ก่อน และแยกจาก authorization deploy
