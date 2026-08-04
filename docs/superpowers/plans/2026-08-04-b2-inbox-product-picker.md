# B2 — Inbox ส่งข้อมูล/รูปสินค้าถึงลูกค้าได้ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้แอดมินใน Unified Inbox ส่ง **รูป + ข้อมูลสินค้าที่ถูกต้อง** ถึงลูกค้าได้จริงทุกช่องทาง (LINE/FB) — โดย (1) ขยาย `sendStaffMessage` ให้เป็น primitive ส่งภาพแบบ idempotent ตัวเดียวของระบบ, (2) ซ่อมบั๊ก live ที่รูปอัปโหลดจาก composer ไม่เคยถึงลูกค้า, (3) เพิ่ม product picker ที่ค้น/แทรกสรุป/ส่งการ์ด/ส่งรูปได้ ด้วยราคาคอลัมน์ + งวดจริงจาก InterestConfig — spec: `docs/superpowers/specs/2026-08-04-product-answering-readiness-design.md` §4

**Architecture:** `MessageRouterService.sendStaffMessage` เป็น **จุดส่งออกจุดเดียว** ที่มี exactly-once (migration `20260976` `@@unique([roomId, clientMessageId])` มีอยู่แล้ว) — ขยายให้รับ `{type, mediaUrl, mediaType, deliveryMediaUrl}` แล้วให้ทุกทางส่ง (upload composer, product card, product photo) วิ่งผ่านมันหมด; `ProductQuoteService` (ใหม่, staff-chat) เป็นแหล่งเดียวของ "ราคา + ค่างวด" ฝั่งแชท (columns-first → prices[] fallback + `calcBcInstallment` + InterestConfig จริง) ใช้ร่วมกันระหว่าง product picker / product card / ProductContextCard; UI เพิ่ม `ProductPickerDialog` ใน composer และแก้ `SessionActions` ให้ส่ง `?customerId=&productId=`

**Tech Stack:** NestJS + Prisma (apps/api), React 18 + React Query + shadcn/ui (apps/web), decimal.js (`calcBcInstallment`), jest (api) / vitest (web)

## Global Constraints

- Branch: `feat/pa-b2-inbox-product-picker` (แตกจาก main หลัง B0 + B1 merge แล้ว)
- **ไม่มี migration ใน batch นี้** — schema เดิมพอทุกอย่าง (`ChatMessage.type/mediaUrl/mediaType/clientMessageId/outboundSentAt` + `@@unique([roomId, clientMessageId])` มีครบตั้งแต่ migration `20260976000000`); migration ล่าสุดในเรโปคือ `20260981000000_add_credit_note_source_fields`, B0 จองเลข `20260982000000` ไปแล้ว — **ห้ามสร้าง migration ใน B2** และ **ห้ามใส่ `ChatRoom.attachedProductId` กลับมา** (spec §1 ตัดออกแล้ว)
- **Red line:** ห้ามแตะ accounting/finance JE paths ทั้งหมด (`apps/api/src/modules/journal/**`, `accounting/**`, `payments/**`); batch นี้ไม่แตะเส้นทางเงินสัญญาเลย — `calcBcInstallment` ถูกเรียกแบบ **read-only เพื่อแสดงผล** ไม่มีการเขียน Contract/Payment/JournalEntry ใดๆ; ตัวเลขค่างวดที่แสดงต้องมี golden test ยืนยันเลขตรงกับ `calcBcInstallment` ทุกบาท
- **รูปที่ส่งลูกค้าได้ต้องมาจาก `Product.gallery[]` เท่านั้น** — `Product.photos[]` เป็น base64 data URL (`products-online-listing.service.ts:8` `DATA_URL_RE`) ส่ง LINE/FB ไม่ได้ และ **ห้าม select `photos` ในทุก query ของ batch นี้** (payload บวมระดับ MB)
- LINE ต้องการ public HTTPS ที่ `originalContentUrl` (`line-shop.adapter.ts:69-75`), FB ต้องการ URL ที่ดึงได้จริง (`facebook.adapter.ts:73-77`) → รูปที่ staff อัปโหลด persist เป็น **storage key** เหมือนเดิม (inbox re-sign เองที่ `room-manager.service.ts:319-326` ผ่าน `signMessageMedia` ซึ่ง **ปล่อย http(s) URL ผ่านไปเฉยๆ** — `media-url.util.ts` `isStorageKey`) แต่ส่งให้ adapter เป็น **signed URL อายุ 6 วัน** (`getSignedDownloadUrl(key, 518400)` — ใต้ลิมิต V4 signing 7 วัน)
- เงินใช้ `Prisma.Decimal` / `decimal.js` เท่านั้นในการคำนวณ; แปลงเป็น `number` ได้เฉพาะตอน serialize ออก API/ข้อความ
- UI copy ภาษาไทยทั้งหมด; ห้าม hardcoded hex/`text-gray-*` — ใช้ design tokens (`bg-card`, `text-muted-foreground`, `border-border`)
- **คำสั่งเทสต์ (ต่างกันคนละแอป — อย่าสลับ):**
  - api: `cd apps/api && npx jest src/modules/<path>.spec.ts`
  - web: `cd apps/web && npx vitest run src/pages/<path>.test.tsx` (apps/web ใช้ **vitest** ตาม `apps/web/vitest.config.ts`; `npx jest` ใน apps/web จะพัง — ไม่มี jest config)
  - ห้ามเพิ่ม DB-backed vitest นอก `journal/cpa-templates`
- ปิดท้ายทุก batch: `cd apps/api && npx tsc --noEmit` = 0, `cd apps/api && npx eslint .` = 0, `cd apps/web && npx tsc --noEmit` = 0, `cd apps/web && npx eslint .` = 0
- QA เบราว์เซอร์บน **local เท่านั้น** (prod ปฏิเสธ seed accounts) — `admin@bestchoice.com / admin1234`
- ทุก commit ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## File Structure

**สร้างใหม่ (apps/api)**
| ไฟล์ | รับผิดชอบ |
|---|---|
| `apps/api/src/modules/staff-chat/services/product-quote.service.ts` | แหล่งเดียวของ "ราคา + ค่างวด" ฝั่งแชท: `resolveProductPrices` (columns-first → prices[] fallback), `computeProductQuote` (pure, ใช้ `calcBcInstallment`), `getQuotes` (โหลด InterestConfig ครั้งเดียวต่อ batch — ไม่มี N+1) |
| `apps/api/src/modules/staff-chat/services/product-quote.service.spec.ts` | golden test เลขค่างวด + fallback ราคา |
| `apps/api/src/modules/staff-chat/services/product-card-text.util.ts` | สร้างข้อความการ์ดสินค้า (pure) — ไม่มี hardcode '12 งวด' |
| `apps/api/src/modules/staff-chat/services/product-card-text.util.spec.ts` | golden test ข้อความ |
| `apps/api/src/modules/staff-chat/services/chat-commerce.service.spec.ts` | test search select / summary / 2-bubble idempotent |
| `apps/api/src/modules/chat-engine/services/room-manager.upload-file.spec.ts` | test บั๊ก live (รูป composer ไม่ถึงลูกค้า) |
| `apps/api/src/modules/staff-chat/services/ai-suggest.service.spec.ts` | test mock gate (prod ว่าง / dev `[MOCK] `) |

**แก้ไข (apps/api)**
| ไฟล์ | แก้อะไร |
|---|---|
| `apps/api/src/modules/chat-engine/services/message-router.service.ts:474-599` | `sendStaffMessage` รับ `type/mediaUrl/mediaType/deliveryMediaUrl` + stamp `externalMessageId` |
| `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts` | เพิ่ม describe idempotency ของรูป |
| `apps/api/src/modules/chat-engine/services/room-manager.service.ts:288-294, 648-682` | `markOutboundSent(id, externalMessageId?)` + `uploadFile` reroute (role STAFF + ส่งจริง) |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts:521-541` | upload รับ `clientMessageId` + คืน `delivered` |
| `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts:307-318` | อัปเดต spec upload ให้ตรง signature ใหม่ (4 args + `delivered`) |
| `apps/api/src/modules/staff-chat/services/chat-commerce.service.ts:174-285` | `searchProducts` ยกเครื่อง (gallery, ห้าม photos), `getProductSummary` ใหม่, `sendProductCard` = 2 bubble idempotent |
| `apps/api/src/modules/staff-chat/chat-commerce.controller.ts` | เพิ่ม ACCOUNTANT ทุก route + route `GET products/:id/summary` + body ใหม่ของ product-card |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | provider `ProductQuoteService` |
| `apps/api/src/modules/staff-chat/services/product-detect.service.ts` | เลิก select `photos` → `gallery`, จำนวนเครื่องจริง, ค่างวดจาก `ProductQuoteService` |
| `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts:36-39, 100, 262-266` | gate mock ตาม NODE_ENV + prefix `[MOCK] ` + แก้ป้าย "ดาวน์ %" ที่เป็นจำนวนเงิน |
| `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts:5,24` | ลบ dead injection `AiSuggestService` |

**สร้างใหม่ (apps/web)**
| ไฟล์ | รับผิดชอบ |
|---|---|
| `apps/web/src/pages/UnifiedInboxPage/components/ProductPickerDialog.tsx` | ค้นสินค้า → แทรกสรุป / ส่งการ์ด / ส่งรูป |
| `apps/web/src/pages/UnifiedInboxPage/components/ProductPickerDialog.test.tsx` | vitest component test |
| `apps/web/src/pages/UnifiedInboxPage/components/contract-create-url.ts` | `buildContractCreateUrl` (pure) |
| `apps/web/src/pages/UnifiedInboxPage/components/contract-create-url.test.ts` | vitest |

**แก้ไข (apps/web)**
| ไฟล์ | แก้อะไร |
|---|---|
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx:1005-1015, 1060-1081` | ปุ่มเปิด ProductPickerDialog ใน composer + mount dialog |
| `apps/web/src/pages/UnifiedInboxPage/index.tsx:398-420` | upload ส่ง `clientMessageId` + toast ตาม `delivered` |
| `apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx:157-168` | "สร้างสัญญา" → เมนูเลือกเครื่อง → `?customerId=&productId=` |
| `apps/web/src/pages/UnifiedInboxPage/components/ProductContextCard.tsx` | render รูป gallery, จำนวนเครื่องจริง, ปุ่มส่งให้ลูกค้า, ลิงก์หน้าเต็ม, แก้ป้าย "ดาวน์ %" |

---

### Task 1: primitive — `sendStaffMessage` ส่งรูปได้แบบ idempotent

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts` (jsdoc :474-513, signature :514-523, guard ก่อน :524, saveMessage :552-558, adapter call :581-586)
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts` (ต่อท้ายไฟล์ หลังบรรทัด 129)

**Interfaces:**
- Consumes: `RoomManagerService.saveMessage({roomId, role, type?, text?, mediaUrl?, mediaType?, staffId?, clientMessageId?})` (`room-manager.service.ts:214-231`), `RoomManagerService.findByClientMessageId(roomId, clientMessageId)` (:282-286), `RoomManagerService.markOutboundSent(messageId)` (:289-294), `IChannelAdapter.sendMessage(OutboundMessage): Promise<SendResult>` (`chat-engine/interfaces/channel-adapter.interface.ts`)
- Produces:
```ts
sendStaffMessage(params: {
  roomId: string;
  staffId: string;
  text?: string;
  clientMessageId?: string;
  type?: MessageType;
  mediaUrl?: string;
  mediaType?: string;
  deliveryMediaUrl?: string;
}): Promise<{
  success: boolean;
  error?: string;
  message?: { id: string; clientMessageId: string | null; createdAt: Date };
}>
```

- [ ] **Step 1:** เพิ่ม failing tests ต่อท้าย `message-router.service.spec.ts` — harness ใหม่ที่จำลอง unique index บน `(roomId, clientMessageId)`:

```ts
// ─── B2: image primitive + exactly-once on clientMessageId ───────────────────

function makeStaffSender() {
  const room = {
    id: 'r1',
    channel: ChatChannel.LINE_SHOP,
    externalUserId: 'U1',
    lineUserId: null,
  };
  // จำลอง @@unique([roomId, clientMessageId]) ด้วย Map
  const store = new Map<string, any>();
  let seq = 0;
  const roomManager = {
    findById: jest.fn().mockResolvedValue(room),
    findByClientMessageId: jest.fn(async (_roomId: string, token: string) => store.get(token) ?? null),
    saveMessage: jest.fn(async (p: any) => {
      if (p.clientMessageId && store.has(p.clientMessageId)) {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      const row = {
        id: `m${++seq}`,
        clientMessageId: p.clientMessageId ?? null,
        createdAt: new Date('2026-08-04T03:00:00.000Z'),
        outboundSentAt: null as Date | null,
        type: p.type,
        mediaUrl: p.mediaUrl,
        role: p.role,
      };
      if (p.clientMessageId) store.set(p.clientMessageId, row);
      return row;
    }),
    markOutboundSent: jest.fn(async (id: string, externalMessageId?: string) => {
      for (const row of store.values()) {
        if (row.id === id) {
          row.outboundSentAt = new Date();
          if (externalMessageId) row.externalMessageId = externalMessageId;
        }
      }
    }),
  };
  const adapter = {
    channel: ChatChannel.LINE_SHOP,
    sendMessage: jest.fn().mockResolvedValue({ success: true, externalMessageId: 'ext-1' }),
  };
  const router = new MessageRouterService(
    roomManager as any,
    { initiateHandoff: jest.fn() } as any,
    { get: jest.fn().mockReturnValue(undefined) } as any,
  );
  router.registerAdapter(adapter as any);
  return { router, adapter, roomManager, store };
}

describe('MessageRouterService.sendStaffMessage — IMAGE bubble', () => {
  it('ส่ง imageUrl ให้ adapter และ persist type/mediaUrl ลง ChatMessage', async () => {
    const { router, adapter, roomManager } = makeStaffSender();
    const res = await router.sendStaffMessage({
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'staff-chat/r1/1.jpg',
      mediaType: 'image/jpeg',
      deliveryMediaUrl: 'https://signed.example/1.jpg',
      clientMessageId: 'tok-img',
    });

    expect(res.success).toBe(true);
    expect(roomManager.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.IMAGE,
        mediaUrl: 'staff-chat/r1/1.jpg',
        mediaType: 'image/jpeg',
        clientMessageId: 'tok-img',
      }),
    );
    // adapter ต้องได้ URL ที่ public (ไม่ใช่ storage key) และไม่มี text ปนใน bubble รูป
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://signed.example/1.jpg',
        type: MessageType.IMAGE,
        text: undefined,
      }),
    );
  });

  it('retry ด้วย clientMessageId เดิม (ส่งสำเร็จแล้ว) → ไม่เรียก adapter ซ้ำ', async () => {
    const { router, adapter } = makeStaffSender();
    const params = {
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'https://cdn.example/g0.jpg',
      clientMessageId: 'tok-same',
    };
    await router.sendStaffMessage(params);
    const second = await router.sendStaffMessage(params);

    expect(second.success).toBe(true);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1); // ลูกค้าได้รูปครั้งเดียว
  });

  it('P2002 race (คู่แข่งชนะ) → คืน success โดยไม่เรียก adapter', async () => {
    const { router, adapter, roomManager } = makeStaffSender();
    const winner = {
      id: 'm-winner',
      clientMessageId: 'tok-race',
      createdAt: new Date('2026-08-04T03:00:00.000Z'),
      outboundSentAt: null as Date | null,
    };
    // อ่านครั้งแรกยังไม่เห็น row (คู่แข่ง INSERT ไม่เสร็จ) → saveMessage ชน unique
    // → อ่านซ้ำเจอ row ของคู่แข่ง. ต้องไม่ยิง adapter ซ้ำ (ลูกค้าได้รูปครั้งเดียว)
    roomManager.findByClientMessageId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    roomManager.saveMessage.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const res = await router.sendStaffMessage({
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'https://cdn.example/g0.jpg',
      clientMessageId: 'tok-race',
    });
    expect(res.success).toBe(true);
    expect(res.message?.id).toBe('m-winner');
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });

  it('ไม่มีทั้ง text และ mediaUrl → ปฏิเสธก่อนบันทึก', async () => {
    const { router, adapter, roomManager } = makeStaffSender();
    const res = await router.sendStaffMessage({ roomId: 'r1', staffId: 'u1', text: '   ' });
    expect(res).toEqual({ success: false, error: 'ไม่มีเนื้อหาที่จะส่ง' });
    expect(roomManager.saveMessage).not.toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** รัน `cd apps/api && npx jest src/modules/chat-engine/services/message-router.service.spec.ts` → คาดว่า **4 tests ใหม่ fail** (TS error `type`/`mediaUrl` ไม่มีใน params + adapter ได้ `type: 'TEXT'`), 5 tests เดิมยังเขียว
- [ ] **Step 3:** แก้ signature ที่ `message-router.service.ts:514-523` เป็น:

```ts
  async sendStaffMessage(params: {
    roomId: string;
    staffId: string;
    text?: string;
    clientMessageId?: string;
    /** ชนิดข้อความที่จะ persist + ส่งออก (ไม่ระบุ = TEXT) */
    type?: MessageType;
    /** ค่าที่ persist ลง ChatMessage.mediaUrl — storage key หรือ public URL */
    mediaUrl?: string;
    mediaType?: string;
    /**
     * URL ที่ส่งให้ "ช่องทาง" จริง — ใช้เมื่อค่าที่ persist เป็น storage key
     * (LINE/FB ต้องการ public HTTPS). ไม่ระบุ = ใช้ mediaUrl
     */
    deliveryMediaUrl?: string;
  }): Promise<{
    success: boolean;
    error?: string;
    message?: { id: string; clientMessageId: string | null; createdAt: Date };
  }> {
    if (!params.text?.trim() && !params.mediaUrl) {
      return { success: false, error: 'ไม่มีเนื้อหาที่จะส่ง' };
    }
```

- [ ] **Step 4:** เพิ่ม field ลง `saveMessage` (:552-558):

```ts
        saved = await this.roomManager.saveMessage({
          roomId: params.roomId,
          role: MessageRole.STAFF,
          type: params.type ?? MessageType.TEXT,
          text: params.text,
          mediaUrl: params.mediaUrl,
          mediaType: params.mediaType,
          staffId: params.staffId,
          clientMessageId: params.clientMessageId,
        });
```

- [ ] **Step 5:** แทน adapter call เดิม (:581-586) ด้วย:

```ts
    const outboundType = params.type ?? MessageType.TEXT;
    const deliveryUrl = params.deliveryMediaUrl ?? params.mediaUrl;
    const isImageBubble = outboundType === MessageType.IMAGE && !!deliveryUrl;
    // LINE (line-shop.adapter.ts:69-75) และ FB (facebook.adapter.ts:73-77) เลือก
    // payload จาก imageUrl ก่อน text เสมอ — ถ้าส่ง text มาด้วยจะถูกทิ้งเงียบๆ
    // ผู้เรียกที่อยากได้ทั้งรูปและข้อความต้องส่ง 2 bubble (ดู ChatCommerceService)
    const result = await adapter.sendMessage({
      externalUserId,
      channel: room.channel,
      type: outboundType,
      text: isImageBubble ? undefined : params.text,
      ...(isImageBubble ? { imageUrl: deliveryUrl, mediaUrl: deliveryUrl } : {}),
    });
```

- [ ] **Step 6:** อัปเดต jsdoc หัวเมธอด (:474-478) เพิ่มบรรทัด:

```ts
   * รองรับทั้ง TEXT และ IMAGE — bubble รูปใช้ `mediaUrl` (ค่าที่ persist) กับ
   * `deliveryMediaUrl` (URL ที่ส่งให้ช่องทาง เมื่อ mediaUrl เป็น storage key).
   * idempotency ทำงานเหมือนกันทั้งสองชนิดเพราะผูกกับ clientMessageId ไม่ใช่ชนิด.
```

- [ ] **Step 7:** รันใหม่ `cd apps/api && npx jest src/modules/chat-engine/services/message-router.service.spec.ts` → **9 passed** (5 เดิม + 4 ใหม่)
- [ ] **Step 8:** Commit: `feat(inbox): sendStaffMessage รองรับ IMAGE bubble แบบ idempotent (clientMessageId เดิมไม่ส่งซ้ำ)`

---

### Task 2: กัน FB echo ซ้ำ — stamp `externalMessageId` ตอนส่งสำเร็จ

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts:288-294` (`markOutboundSent`)
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts:594` (call site)
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts` (เพิ่ม 1 test ใน describe ของ Task 1)

**Interfaces:**
- Consumes: `SendResult.externalMessageId?: string` (FB adapter คืน `data.message_id`, `facebook.adapter.ts:141-142`; LINE adapter ไม่คืน → undefined)
- Produces: `markOutboundSent(messageId: string, externalMessageId?: string): Promise<void>`

**บริบท:** dedup ของ FB echo อยู่ที่ `facebook-webhook.controller.ts:319-330` = (1) `message.app_id === FACEBOOK_APP_ID` (2) fallback `ChatMessage.externalMessageId` UNIQUE (`schema.prisma` `externalMessageId String? @unique`; jsdoc อธิบายที่ `:298-303`) — **ไม่ได้อิง `role`** ดังนั้นการเปลี่ยน uploadFile จาก BOT→STAFF ใน Task 3 ปลอดภัย แต่เมื่อ B2 เริ่มส่งรูปออก FB จริง echo จะกลับมา และถ้า env `FACEBOOK_APP_ID` ไม่ได้ตั้ง layer 2 จะใช้ไม่ได้เพราะเราไม่เคยเก็บ mid ของข้อความที่เราส่งเอง

- [ ] **Step 1:** เพิ่ม failing test ท้าย describe `sendStaffMessage — IMAGE bubble`:

```ts
  it('stamp externalMessageId ที่ adapter คืนมา (กัน FB echo สร้าง bubble ซ้ำ)', async () => {
    const { router, roomManager } = makeStaffSender();
    await router.sendStaffMessage({
      roomId: 'r1',
      staffId: 'u1',
      text: 'สวัสดีค่ะ',
      clientMessageId: 'tok-echo',
    });
    expect(roomManager.markOutboundSent).toHaveBeenCalledWith('m1', 'ext-1');
  });
```

- [ ] **Step 2:** รัน → fail (`markOutboundSent` ถูกเรียกด้วย arg เดียว)
- [ ] **Step 3:** แก้ `room-manager.service.ts:288-294`:

```ts
  /**
   * Mark a message as successfully delivered to the customer (idempotency flag).
   * เก็บ platform message id ด้วยเมื่อ adapter คืนมา — FB echo webhook dedup
   * ชั้นที่ 2 อาศัย UNIQUE บน ChatMessage.externalMessageId
   * (facebook-webhook.controller.ts:298-303) ถ้าไม่ stamp ไว้ echo ของข้อความที่
   * เราส่งเองจะกลายเป็น bubble STAFF ซ้ำเมื่อ env FACEBOOK_APP_ID ไม่ได้ตั้ง
   */
  async markOutboundSent(messageId: string, externalMessageId?: string): Promise<void> {
    try {
      await this.prisma.chatMessage.update({
        where: { id: messageId },
        data: {
          outboundSentAt: new Date(),
          ...(externalMessageId ? { externalMessageId } : {}),
        },
      });
    } catch (err) {
      // echo webhook อาจมาถึงก่อน HTTP ของเราจะ return แล้วจอง mid ไปก่อน —
      // ยอมเสีย stamp ดีกว่า throw (ข้อความส่งถึงลูกค้าแล้ว ถ้า throw client จะ retry = ส่งซ้ำ)
      if ((err as { code?: string })?.code === 'P2002' && externalMessageId) {
        this.logger.warn(
          `[markOutboundSent] externalMessageId ${externalMessageId} ถูกใช้แล้ว — stamp เฉพาะ outboundSentAt`,
        );
        await this.prisma.chatMessage.update({
          where: { id: messageId },
          data: { outboundSentAt: new Date() },
        });
        return;
      }
      throw err;
    }
  }
```

- [ ] **Step 4:** แก้ call site `message-router.service.ts:594`:

```ts
    await this.roomManager.markOutboundSent(saved.id, result.externalMessageId);
```

- [ ] **Step 5:** รัน `cd apps/api && npx jest src/modules/chat-engine/services/message-router.service.spec.ts` → **10 passed**
- [ ] **Step 6:** Commit: `fix(inbox): stamp externalMessageId หลังส่งสำเร็จ — กัน FB echo สร้าง bubble ซ้ำ`

---

### Task 3: ซ่อมบั๊ก live — รูปจาก composer ไม่เคยถึงลูกค้า

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts:648-682` (`uploadFile` — jsdoc :648-651 + เมธอด :652-682)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts:524-541` (เมธอด `uploadFile` ใต้ `@Post('rooms/:id/upload')` :521)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts:307-318` (spec เดิมเรียกด้วย 3 อาร์กิวเมนต์ — พังแน่ถ้าไม่แก้)
- Create: `apps/api/src/modules/chat-engine/services/room-manager.upload-file.spec.ts`

**Interfaces:**
- Consumes: `StorageService.upload(key, buffer, contentType)` (`storage.service.ts:70`), `StorageService.getSignedDownloadUrl(key, expiresIn = 900)` (:122), `StorageService.configured` getter (:66-68), `MessageRouterService.sendStaffMessage` (Task 1)
- Produces:
```ts
uploadFile(
  roomId: string,
  file: Express.Multer.File,
  userId: string | undefined,
  clientMessageId?: string,
): Promise<{
  success: boolean;
  url: string;
  key: string;
  filename: string;
  /** true = ส่งถึงลูกค้าผ่านช่องทางแล้ว; false = บันทึกในห้องอย่างเดียว */
  delivered: boolean;
  error?: string;
}>
```

**บั๊กเดิม:** `uploadFile` เรียก `saveMessage({ role: MessageRole.BOT })` อย่างเดียว ไม่เคยเรียก adapter → รูปที่แอดมินอัปโหลดโผล่แค่ในกล่องแชทฝั่งเรา ลูกค้าไม่เคยได้รับ (spec §0 "Admin / Inbox")

- [ ] **Step 1:** สร้าง `room-manager.upload-file.spec.ts` (failing):

```ts
import { MessageRole, MessageType } from '@prisma/client';
import { RoomManagerService } from './room-manager.service';

function makeFile(mimetype: string, originalname: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: 4,
    buffer: Buffer.from('abcd'),
    stream: undefined as never,
    destination: '',
    filename: originalname,
    path: '',
  };
}

function makeManager() {
  const prisma = {
    chatMessage: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    chatRoom: {
      findUnique: jest.fn().mockResolvedValue({ firstResponseAt: new Date() }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const storage = {
    configured: true,
    upload: jest.fn().mockResolvedValue('k'),
    getSignedDownloadUrl: jest.fn(
      async (key: string, ttl: number) => `https://signed.example/${key}?ttl=${ttl}`,
    ),
  };
  const messageRouter = {
    sendStaffMessage: jest.fn().mockResolvedValue({ success: true, message: { id: 'm1' } }),
  };
  const manager = new RoomManagerService(
    prisma as any,
    storage as any,
    undefined,
    messageRouter as any,
  );
  return { manager, prisma, storage, messageRouter };
}

describe('RoomManagerService.uploadFile — รูปต้องถึงลูกค้าจริง', () => {
  it('รูป → ส่งผ่าน sendStaffMessage ด้วย signed URL อายุ 6 วัน + persist storage key', async () => {
    const { manager, storage, messageRouter } = makeManager();
    const res = await manager.uploadFile('r1', makeFile('image/jpeg', 'promo.jpg'), 'u1', 'tok-1');

    expect(messageRouter.sendStaffMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'r1',
        staffId: 'u1',
        type: MessageType.IMAGE,
        mediaType: 'image/jpeg',
        clientMessageId: 'tok-1',
      }),
    );
    const arg = messageRouter.sendStaffMessage.mock.calls[0][0];
    expect(arg.mediaUrl).toMatch(/^staff-chat\/r1\//); // persist เป็น storage key
    expect(arg.deliveryMediaUrl).toContain('ttl=518400'); // 6 วัน
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(expect.any(String), 518400);
    expect(res.delivered).toBe(true);
  });

  it('ไฟล์ที่ไม่ใช่รูป → บันทึกเป็น STAFF (ไม่ใช่ BOT) และไม่ส่งออกช่องทาง', async () => {
    const { manager, prisma, messageRouter } = makeManager();
    const res = await manager.uploadFile('r1', makeFile('application/pdf', 'doc.pdf'), 'u1');

    expect(messageRouter.sendStaffMessage).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: MessageRole.STAFF,
          type: MessageType.FILE,
        }),
      }),
    );
    expect(res.delivered).toBe(false);
  });

  it('adapter ส่งไม่สำเร็จ → upload ยังสำเร็จ แต่ delivered=false + error ติดมา', async () => {
    const { manager, messageRouter } = makeManager();
    messageRouter.sendStaffMessage.mockResolvedValue({ success: false, error: 'LINE 400' });
    const res = await manager.uploadFile('r1', makeFile('image/png', 'a.png'), 'u1');

    expect(res.success).toBe(true);
    expect(res.delivered).toBe(false);
    expect(res.error).toBe('LINE 400');
  });
});
```

- [ ] **Step 2:** รัน `cd apps/api && npx jest src/modules/chat-engine/services/room-manager.upload-file.spec.ts` → fail (ยังเป็น role BOT + ไม่มี `delivered`)
- [ ] **Step 3:** เพิ่มค่าคงที่ใต้ `private readonly logger` (`room-manager.service.ts:36`):

```ts
  /**
   * อายุ signed URL ที่ยื่นให้ adapter — ยาวกว่าที่ inbox ใช้ (1 ชม.) เพราะ LINE
   * โหลด originalContentUrl ตอนลูกค้าเปิดดู ไม่ใช่ตอนส่ง. 6 วัน = ใต้เพดาน
   * V4 signing (7 วัน) และไม่ต้องเปิด object ให้เป็น public (PDPA)
   */
  private static readonly ADAPTER_MEDIA_TTL_SEC = 6 * 24 * 3600; // 518400
```

- [ ] **Step 4:** แทนที่ `uploadFile` ทั้งเมธอด **พร้อม jsdoc เดิม (:648-682 — อย่าเลยไปถึง 683 ซึ่งเป็นเมธอดถัดไป)**:

```ts
  /**
   * Store an uploaded file and deliver it to the customer.
   *
   * บั๊กเดิม (ถึง 2026-08-04): เมธอดนี้ saveMessage เป็น role BOT อย่างเดียว
   * ไม่เคยเรียก adapter → รูปที่แอดมินอัปโหลดไม่เคยถึงลูกค้าเลย. ตอนนี้รูปวิ่ง
   * ผ่าน sendStaffMessage (มี clientMessageId exactly-once) ส่วนไฟล์ที่ไม่ใช่รูป
   * ยังบันทึกในห้องอย่างเดียว (LINE ไม่มี file bubble) แต่ persist เป็น STAFF
   * และคืน delivered=false ให้ UI บอกแอดมินตรงๆ
   *
   * ข้อจำกัดที่ยอมรับ: ถ้า sendStaffMessage ล้มเหลว "ก่อน" บันทึก (room ไม่พบ /
   * ไม่มี adapter ของ channel) รูปจะไม่ถูก persist เลย. ทั้ง 5 channel ลงทะเบียน
   * adapter ครบที่ chat-adapters.module.ts:85-89 และ roomId มาจากห้องที่เปิดอยู่
   * → เกิดได้เฉพาะตอน config พัง; แอดมินเห็น error จาก toast (Task 8) แล้วส่งใหม่ได้
   */
  async uploadFile(
    roomId: string,
    file: Express.Multer.File,
    userId: string | undefined,
    clientMessageId?: string,
  ): Promise<{
    success: boolean;
    url: string;
    key: string;
    filename: string;
    delivered: boolean;
    error?: string;
  }> {
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    };
    const ext = extMap[file.mimetype] || '';
    const key = `staff-chat/${roomId}/${Date.now()}${ext}`;

    await this.storageService.upload(key, file.buffer, file.mimetype);
    const downloadUrl = this.storageService.configured
      ? await this.storageService.getSignedDownloadUrl(key, 3600)
      : key;

    const isImage = file.mimetype.startsWith('image/');

    if (isImage && this.messageRouter && userId) {
      const deliveryMediaUrl = this.storageService.configured
        ? await this.storageService.getSignedDownloadUrl(
            key,
            RoomManagerService.ADAPTER_MEDIA_TTL_SEC,
          )
        : key;
      const sent = await this.messageRouter.sendStaffMessage({
        roomId,
        staffId: userId,
        type: MessageType.IMAGE,
        mediaUrl: key,
        mediaType: file.mimetype,
        deliveryMediaUrl,
        clientMessageId,
      });
      return {
        success: true,
        url: downloadUrl,
        key,
        filename: file.originalname,
        delivered: sent.success,
        ...(sent.success ? {} : { error: sent.error }),
      };
    }

    await this.saveMessage({
      roomId,
      role: MessageRole.STAFF,
      type: isImage ? MessageType.IMAGE : MessageType.FILE,
      text: file.originalname,
      mediaUrl: key,
      mediaType: file.mimetype,
      staffId: userId,
      clientMessageId,
    });

    return { success: true, url: downloadUrl, key, filename: file.originalname, delivered: false };
  }
```

- [ ] **Step 5:** แก้ endpoint `staff-chat.controller.ts:524-541` ให้รับ `clientMessageId` (multipart field — `FileInterceptor` ของ multer parse ทั้ง stream จึงได้ทั้ง file และ text field ไม่ว่า append ลำดับไหน); เดคอเรเตอร์ `@Post`/`@Roles`/`@UseInterceptors` (:521-523) คงเดิม:

```ts
  async uploadFile(
    @Param('id') roomId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024, message: 'ไฟล์มีขนาดเกิน 10MB' }),
          new FileTypeValidator({ fileType: /^(image\/(jpeg|png|webp)|application\/pdf|application\/(msword|vnd\.openxmlformats))/ }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
    @Body('clientMessageId') clientMessageId: string | undefined,
    @Req() req: Request,
  ) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    return this.roomManager.uploadFile(roomId, file, userId, clientMessageId);
  }
```

- [ ] **Step 5b:** **แก้ spec เดิมที่จะพังจากการเปลี่ยน signature** — `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts:307-318` เรียก `controller.uploadFile(roomId, file, req)` แบบ 3 อาร์กิวเมนต์ และ mock ผลลัพธ์ที่ยังไม่มี `delivered` (จะ TS error + `req` เป็น undefined ตอนรัน). แทน describe ทั้งบล็อกด้วย:

```ts
  describe('POST /staff-chat/rooms/:id/upload', () => {
    it('delegates to roomManager.uploadFile with room, file, user id, clientMessageId', async () => {
      const file = { originalname: 'x.png', mimetype: 'image/png', buffer: Buffer.from('') } as any;
      const uploadResult = {
        success: true,
        url: 'signed-url',
        key: 'k',
        filename: 'x.png',
        delivered: true,
      };
      jest.spyOn(roomManager, 'uploadFile').mockResolvedValue(uploadResult);

      const result = await controller.uploadFile('room-1', file, 'tok-1', {
        user: { id: 'user-1' },
      } as any);

      expect(roomManager.uploadFile).toHaveBeenCalledWith('room-1', file, 'user-1', 'tok-1');
      expect(result).toEqual(uploadResult);
    });

    it('ไม่ส่ง clientMessageId มาก็ยังทำงาน (ผู้เรียกเก่า)', async () => {
      const file = { originalname: 'x.pdf', mimetype: 'application/pdf', buffer: Buffer.from('') } as any;
      jest.spyOn(roomManager, 'uploadFile').mockResolvedValue({
        success: true,
        url: 'signed-url',
        key: 'k',
        filename: 'x.pdf',
        delivered: false,
      });

      await controller.uploadFile('room-1', file, undefined, { user: { id: 'user-1' } } as any);

      expect(roomManager.uploadFile).toHaveBeenCalledWith('room-1', file, 'user-1', undefined);
    });
  });
```

- [ ] **Step 6:** รัน `cd apps/api && npx jest src/modules/chat-engine/services/room-manager.upload-file.spec.ts` → **3 passed**; รัน spec ของ controller `cd apps/api && npx jest src/modules/staff-chat/staff-chat.controller.spec.ts` → เขียว (2 tests ในบล็อก upload); แล้วรัน regression `cd apps/api && npx jest src/modules/chat-engine` → เขียวหมด
- [ ] **Step 7:** Commit: `fix(inbox): รูปที่แอดมินอัปโหลดส่งถึงลูกค้าจริง (บั๊ก live — เดิมบันทึก role BOT ไม่เรียก adapter)`

---

### Task 4: `ProductQuoteService` — ราคาคอลัมน์ + งวดจริงจาก InterestConfig

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/product-quote.service.ts`
- Create: `apps/api/src/modules/staff-chat/services/product-quote.service.spec.ts`
- Modify: `apps/api/src/modules/staff-chat/staff-chat.module.ts` (เพิ่มใน `providers`)

**Interfaces:**
- Consumes: `calcBcInstallment(input: BcCalcInput): BcCalcOutput` (`apps/api/src/utils/installment-calc.util.ts:18`; type `BcCalcInput`/`BcCalcOutput` อยู่ที่ `apps/api/src/utils/installment-calc.types.ts` — `config` ต้องมีครบ `{minDownPct, commissionPct, vatPct, ratePctByMonths, allowedMonths}` และผลลัพธ์มี `isValid/monthlyPayment/downAmount` เป็น `Decimal`), `PrismaService.interestConfig.findMany` (`InterestConfig.productCategories String[]` + relation `rates → InterestConfigRate {months, ratePct, deletedAt}`)
- Produces:
```ts
export type DecimalLike = string | number | { toString(): string };

export interface ProductPriceInput {
  category: string;                       // ProductCategory
  cashPrice: DecimalLike | null;
  installmentPrice: DecimalLike | null;
  prices?: { label: string; amount: DecimalLike }[];
}

export interface QuoteConfigInput {
  minDownPaymentPct: DecimalLike;
  storeCommissionPct: DecimalLike;
  vatPct: DecimalLike;
  interestRate: DecimalLike;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  rates: { months: number; ratePct: DecimalLike }[];
}

export interface ProductQuote {
  cashPrice: number | null;
  installmentPrice: number | null;
  months: number | null;
  monthlyPayment: number | null;
  downAmount: number | null;
}

export function resolveProductPrices(p: ProductPriceInput): { cash: number | null; installment: number | null };
export function computeProductQuote(p: ProductPriceInput, config: QuoteConfigInput | null): ProductQuote;
class ProductQuoteService {
  getQuotes(inputs: ProductPriceInput[]): Promise<ProductQuote[]>;
  getQuote(input: ProductPriceInput): Promise<ProductQuote>;
}
```

- [ ] **Step 1:** เขียน failing spec `product-quote.service.spec.ts`:

```ts
import { computeProductQuote, resolveProductPrices } from './product-quote.service';

const CONFIG_WITH_RATES = {
  minDownPaymentPct: '0.2000',
  storeCommissionPct: '0.0500',
  vatPct: '0.0700',
  interestRate: '0.0250',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  rates: [
    { months: 6, ratePct: '0.1500' },
    { months: 12, ratePct: '0.3000' },
  ],
};

describe('resolveProductPrices — columns-first แล้วค่อย fallback prices[]', () => {
  it('อ่านคอลัมน์ก่อนเสมอ', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_NEW',
        cashPrice: '32900',
        installmentPrice: '34900',
        prices: [{ label: 'ราคาเงินสด', amount: '1' }],
      }),
    ).toEqual({ cash: 32900, installment: 34900 });
  });

  it('คอลัมน์ว่าง → ใช้ label ตรงตัวก่อน แล้วค่อย prefix', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_USED',
        cashPrice: null,
        installmentPrice: null,
        prices: [
          { label: 'ราคาเงินสด', amount: '20000' },
          { label: 'ราคาผ่อน GFIN', amount: '23000' },
          { label: 'ราคาผ่อน BESTCHOICE', amount: '22000' },
        ],
      }),
    ).toEqual({ cash: 20000, installment: 22000 });
  });

  it('ไม่มีทั้งคอลัมน์และ row → null (ห้าม fallback prices[0])', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_USED',
        cashPrice: null,
        installmentPrice: null,
        prices: [{ label: 'ราคาขายต่อ (Refurbished)', amount: '9999' }],
      }),
    ).toEqual({ cash: null, installment: null });
  });
});

describe('computeProductQuote — golden (ต้องตรงกับ calcBcInstallment ทุกบาท)', () => {
  it('เลือกงวดยาวสุดในตารางอัตรา + ดาวน์ขั้นต่ำ', () => {
    // 20,000 / 12 งวด / rate 30% / down 20% / com 5% / vat 7%
    // down 4,000 → financed 16,000 → ดอกเบี้ย 4,800 → คอม 800
    // subtotal 21,600 → vat 1,512 → total 23,112 → งวดละ 1,926.00
    expect(
      computeProductQuote(
        { category: 'PHONE_NEW', cashPrice: '19500', installmentPrice: '20000' },
        CONFIG_WITH_RATES,
      ),
    ).toEqual({
      cashPrice: 19500,
      installmentPrice: 20000,
      months: 12,
      monthlyPayment: 1926,
      downAmount: 4000,
    });
  });

  it('ไม่มี InterestConfigRate → สังเคราะห์ rate ต่อเดือน × จำนวนงวด (เหมือน installment-preview)', () => {
    // rate 2.5%/เดือน × 10 งวด = 25% → financed 16,000 → ดอก 4,000 + คอม 800
    // subtotal 20,800 → vat 1,456 → total 22,256 → งวดละ 2,225.60
    expect(
      computeProductQuote(
        { category: 'PHONE_USED', cashPrice: null, installmentPrice: '20000' },
        { ...CONFIG_WITH_RATES, minInstallmentMonths: 6, maxInstallmentMonths: 10, rates: [] },
      ),
    ).toEqual({
      cashPrice: null,
      installmentPrice: 20000,
      months: 10,
      monthlyPayment: 2225.6,
      downAmount: 4000,
    });
  });

  it('ไม่มีราคาผ่อน → ไม่มีบรรทัดผ่อน (ไม่ throw)', () => {
    expect(
      computeProductQuote(
        { category: 'PHONE_NEW', cashPrice: '32900', installmentPrice: null },
        CONFIG_WITH_RATES,
      ),
    ).toEqual({
      cashPrice: 32900,
      installmentPrice: null,
      months: null,
      monthlyPayment: null,
      downAmount: null,
    });
  });

  it('ไม่มี InterestConfig ของหมวดนี้ → ไม่มีบรรทัดผ่อน', () => {
    expect(
      computeProductQuote(
        { category: 'ACCESSORY', cashPrice: '590', installmentPrice: '590' },
        null,
      ),
    ).toEqual({
      cashPrice: 590,
      installmentPrice: 590,
      months: null,
      monthlyPayment: null,
      downAmount: null,
    });
  });
});
```

- [ ] **Step 2:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/product-quote.service.spec.ts` → fail (ไม่มีไฟล์)
- [ ] **Step 3:** สร้าง `product-quote.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../prisma/prisma.service';
import { calcBcInstallment } from '../../../utils/installment-calc.util';

export type DecimalLike = string | number | { toString(): string };

export interface ProductPriceInput {
  /** ProductCategory ของเครื่อง — ใช้จับคู่ InterestConfig.productCategories */
  category: string;
  cashPrice: DecimalLike | null;
  installmentPrice: DecimalLike | null;
  /** ProductPrice rows (deletedAt: null) — ใช้เป็น fallback เมื่อคอลัมน์ยังว่าง */
  prices?: { label: string; amount: DecimalLike }[];
}

export interface QuoteConfigInput {
  minDownPaymentPct: DecimalLike;
  storeCommissionPct: DecimalLike;
  vatPct: DecimalLike;
  interestRate: DecimalLike;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  rates: { months: number; ratePct: DecimalLike }[];
}

export interface ProductQuote {
  cashPrice: number | null;
  installmentPrice: number | null;
  /** งวดยาวสุดที่ตารางอัตราอนุญาต (null = ผ่อนไม่ได้ / ไม่มีราคาผ่อน) */
  months: number | null;
  monthlyPayment: number | null;
  downAmount: number | null;
}

const dec = (v: DecimalLike): Decimal => new Decimal(v.toString());

const EMPTY_INSTALLMENT = { months: null, monthlyPayment: null, downAmount: null } as const;

/**
 * ลำดับการอ่านราคา — columns-first แล้วค่อย prices[] เหมือน
 * `installment-preview.service.ts:39-43` (api) และ `getDisplayPrices.ts:26-37` (web).
 * ห้าม fallback ไป prices[0] เด็ดขาด: prod มี default row ปนหลาย label
 * ('ราคาขาย' / 'ราคาขายต่อ (Refurbished)') ที่ไม่ใช่ราคาขายจริงของเครื่องนั้น
 */
export function resolveProductPrices(p: ProductPriceInput): {
  cash: number | null;
  installment: number | null;
} {
  const rows = p.prices ?? [];
  const pick = (exact: string, prefix: string) =>
    rows.find((r) => r.label === exact) ?? rows.find((r) => r.label.startsWith(prefix));

  const cashRow = pick('ราคาเงินสด', 'ราคาเงินสด');
  const instRow = pick('ราคาผ่อน BESTCHOICE', 'ราคาผ่อน');

  return {
    cash: p.cashPrice != null ? Number(p.cashPrice) : cashRow ? Number(cashRow.amount) : null,
    installment:
      p.installmentPrice != null
        ? Number(p.installmentPrice)
        : instRow
          ? Number(instRow.amount)
          : null,
  };
}

/**
 * คำนวณ "ราคา + ค่างวดเริ่มต้น" สำหรับแสดงในแชท (pure — ไม่แตะ DB, ไม่เขียนอะไร).
 * งวด = งวดยาวสุดในตารางอัตรา, ดาวน์ = ขั้นต่ำของ config → ตัวเลขที่เห็นในแชท
 * คือตัวเลขที่ทำสัญญาได้จริง ไม่ใช่ค่าคงที่ '12 งวด' ที่เคย hardcode ไว้
 */
export function computeProductQuote(
  p: ProductPriceInput,
  config: QuoteConfigInput | null,
): ProductQuote {
  const { cash, installment } = resolveProductPrices(p);
  const base = { cashPrice: cash, installmentPrice: installment };

  if (installment == null || installment <= 0 || !config) {
    return { ...base, ...EMPTY_INSTALLMENT };
  }

  const ratePctByMonths = new Map<number, Decimal>();
  for (const r of config.rates) ratePctByMonths.set(r.months, dec(r.ratePct));
  if (ratePctByMonths.size === 0) {
    // fallback เดียวกับ installment-preview.service.ts:76-81 — rate ต่อเดือน × จำนวนงวด
    const perMonth = dec(config.interestRate);
    for (let m = config.minInstallmentMonths; m <= config.maxInstallmentMonths; m++) {
      ratePctByMonths.set(m, perMonth.mul(m));
    }
  }
  const allowedMonths = Array.from(ratePctByMonths.keys()).sort((a, b) => a - b);
  if (allowedMonths.length === 0) return { ...base, ...EMPTY_INSTALLMENT };

  const months = allowedMonths[allowedMonths.length - 1];
  const result = calcBcInstallment({
    installmentPrice: dec(installment),
    months,
    config: {
      minDownPct: dec(config.minDownPaymentPct),
      commissionPct: dec(config.storeCommissionPct),
      vatPct: dec(config.vatPct),
      ratePctByMonths,
      allowedMonths,
    },
  });
  if (!result.isValid) return { ...base, ...EMPTY_INSTALLMENT };

  return {
    ...base,
    months,
    monthlyPayment: result.monthlyPayment.toNumber(),
    downAmount: result.downAmount.toNumber(),
  };
}

@Injectable()
export class ProductQuoteService {
  constructor(private prisma: PrismaService) {}

  /**
   * โหลด InterestConfig ครั้งเดียวต่อชุด (กัน N+1 เวลา search คืน 20 เครื่อง)
   * แล้ว map ทีละเครื่องด้วย computeProductQuote
   */
  async getQuotes(inputs: ProductPriceInput[]): Promise<ProductQuote[]> {
    if (inputs.length === 0) return [];
    const categories = [...new Set(inputs.map((i) => i.category))];
    const configs = await this.prisma.interestConfig.findMany({
      where: {
        productCategories: { hasSome: categories },
        deletedAt: null,
        isActive: true,
      },
      include: { rates: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'asc' },
    });

    // config ตัวแรกสุด (createdAt asc) ชนะต่อหมวด — deterministic ต่างจาก
    // installment-preview.service.ts:61-68 ที่ findFirst ไม่มี orderBy
    const byCategory = new Map<string, (typeof configs)[number]>();
    for (const c of configs) {
      for (const cat of c.productCategories) {
        if (!byCategory.has(cat)) byCategory.set(cat, c);
      }
    }

    return inputs.map((i) => computeProductQuote(i, byCategory.get(i.category) ?? null));
  }

  async getQuote(input: ProductPriceInput): Promise<ProductQuote> {
    const [quote] = await this.getQuotes([input]);
    return quote;
  }
}
```

- [ ] **Step 4:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/product-quote.service.spec.ts` → **7 passed**
- [ ] **Step 5:** ลงทะเบียน provider ใน `staff-chat.module.ts` — เพิ่ม `import { ProductQuoteService } from './services/product-quote.service';` (ใต้บรรทัด 28 ที่ import `ChatCommerceService`) และเพิ่ม `ProductQuoteService` ใน array `providers` (บรรทัด 72 — เป็นบรรทัดเดียวยาว วางถัดจาก `ChatCommerceService,`). ไม่ต้องแก้ `exports` (ใช้ภายในโมดูลเท่านั้น) และไม่ต้อง forwardRef — `ChatCommerceService` inject `MessageRouterService` ตรงๆ ได้แบบเดียวกับ `CannedResponseSenderService` (`canned-response-sender.service.ts:33`) เพราะ `StaffChatModule` import `ChatEngineModule` อยู่แล้ว (:58)
- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit` → 0 errors; Commit: `feat(inbox): ProductQuoteService — ราคาคอลัมน์ + ค่างวดจริงจาก InterestConfig (golden test)`

---

### Task 5: ข้อความการ์ดสินค้า (pure util) — ลบ hardcode '12 งวด'

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/product-card-text.util.ts`
- Create: `apps/api/src/modules/staff-chat/services/product-card-text.util.spec.ts`

**Interfaces:**
- Consumes: `ProductQuote` (Task 4)
- Produces:
```ts
export interface ProductCardFacts {
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  category: string;
  status: string;
  conditionGrade: string | null;
  batteryHealth: number | null;
  shopWarrantyDays: number | null;
  branchName: string | null;
}
export function fmtBaht(n: number): string;
export function buildProductCardText(
  p: ProductCardFacts,
  quote: ProductQuote,
  shareUrl: string | null,
): string;
```

- [ ] **Step 1:** เขียน failing spec `product-card-text.util.spec.ts`:

```ts
import { buildProductCardText, fmtBaht } from './product-card-text.util';

const USED: Parameters<typeof buildProductCardText>[0] = {
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  color: 'สีชมพู',
  storage: '128GB',
  category: 'PHONE_USED',
  status: 'IN_STOCK',
  conditionGrade: 'A',
  batteryHealth: 92,
  shopWarrantyDays: 30,
  branchName: 'ลาดพร้าว',
};

describe('buildProductCardText', () => {
  it('ประกอบครบทุกบรรทัดจากข้อมูลจริง + ลิงก์', () => {
    const text = buildProductCardText(
      USED,
      { cashPrice: 19500, installmentPrice: 20000, months: 12, monthlyPayment: 1926, downAmount: 4000 },
      'https://www.bestchoicephone.com/products/p1',
    );
    expect(text).toContain('Apple iPhone 13 128GB สีชมพู');
    expect(text).toContain('เงินสด 19,500 บาท');
    expect(text).toContain('ผ่อน 12 งวด งวดละ 1,926 บาท (ดาวน์ 4,000 บาท)');
    expect(text).toContain('สภาพ A');
    expect(text).toContain('แบตเตอรี่ 92%');
    expect(text).toContain('ประกันร้าน 30 วัน');
    expect(text).toContain('สาขาลาดพร้าว');
    expect(text).toContain('พร้อมขาย');
    expect(text).toContain('https://www.bestchoicephone.com/products/p1');
  });

  it('ไม่มีราคาผ่อน → ไม่มีบรรทัดผ่อน และห้ามมีข้อความ 12 งวดตายตัว', () => {
    const text = buildProductCardText(
      { ...USED, category: 'PHONE_NEW', conditionGrade: null, batteryHealth: null },
      { cashPrice: 32900, installmentPrice: null, months: null, monthlyPayment: null, downAmount: null },
      null,
    );
    expect(text).not.toContain('ผ่อน');
    expect(text).not.toContain('12 งวด');
    expect(text).not.toContain('สภาพ');
    expect(text).not.toContain('แบตเตอรี่');
    expect(text).toContain('เงินสด 32,900 บาท');
  });

  it('ไม่มีราคาเลย → บอกให้สอบถามแอดมิน (ห้ามโชว์ 0 บาท)', () => {
    const text = buildProductCardText(
      USED,
      { cashPrice: null, installmentPrice: null, months: null, monthlyPayment: null, downAmount: null },
      null,
    );
    expect(text).toContain('สอบถามราคากับแอดมิน');
    expect(text).not.toContain('0 บาท');
  });

  it('เครื่องติดจอง → บอกสถานะตรงๆ', () => {
    const text = buildProductCardText(
      { ...USED, status: 'RESERVED' },
      { cashPrice: 19500, installmentPrice: null, months: null, monthlyPayment: null, downAmount: null },
      null,
    );
    expect(text).toContain('ติดจองชั่วคราว');
  });
});

describe('fmtBaht', () => {
  it('คั่นหลักพันและตัดทศนิยมที่ไม่จำเป็น', () => {
    expect(fmtBaht(1926)).toBe('1,926');
    expect(fmtBaht(2225.6)).toBe('2,225.6');
  });
});
```

- [ ] **Step 2:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/product-card-text.util.spec.ts` → fail
- [ ] **Step 3:** สร้าง `product-card-text.util.ts`:

```ts
import type { ProductQuote } from './product-quote.service';

export interface ProductCardFacts {
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  /** ProductCategory */
  category: string;
  /** ProductStatus */
  status: string;
  conditionGrade: string | null;
  batteryHealth: number | null;
  shopWarrantyDays: number | null;
  branchName: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  IN_STOCK: 'พร้อมขาย',
  RESERVED: 'ติดจองชั่วคราว',
  SOLD_CASH: 'ขายแล้ว',
  SOLD_INSTALLMENT: 'ขายผ่อนแล้ว',
  SOLD_RESELL: 'ขายแล้ว',
};

const GRADE_TEXT: Record<string, string> = {
  A: 'สภาพ A (สวยมาก)',
  B: 'สภาพ B (สวย)',
  C: 'สภาพ C (มีตำหนิ)',
};

export function fmtBaht(n: number): string {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

/**
 * ข้อความการ์ดสินค้าที่ส่งให้ลูกค้า — ทุกตัวเลขมาจาก ProductQuote (ราคาคอลัมน์ +
 * InterestConfig จริง) ไม่มีค่าคงที่ 'ผ่อนได้สูงสุด 12 งวด' และไม่มี fallback
 * prices[0] แบบเดิมอีกแล้ว
 */
export function buildProductCardText(
  p: ProductCardFacts,
  quote: ProductQuote,
  shareUrl: string | null,
): string {
  const title =
    [p.brand, p.model, p.storage, p.color].filter(Boolean).join(' ').trim() || p.name;
  const lines: string[] = [`📱 ${title}`];

  lines.push(
    quote.cashPrice != null
      ? `💰 เงินสด ${fmtBaht(quote.cashPrice)} บาท`
      : '💰 สอบถามราคากับแอดมินได้เลยค่ะ',
  );

  if (quote.months != null && quote.monthlyPayment != null) {
    const down = quote.downAmount != null ? ` (ดาวน์ ${fmtBaht(quote.downAmount)} บาท)` : '';
    lines.push(`📆 ผ่อน ${quote.months} งวด งวดละ ${fmtBaht(quote.monthlyPayment)} บาท${down}`);
  }

  if (p.category === 'PHONE_USED' && p.conditionGrade) {
    lines.push(`⭐ ${GRADE_TEXT[p.conditionGrade] ?? `สภาพ ${p.conditionGrade}`}`);
  }
  if (p.batteryHealth != null) lines.push(`🔋 แบตเตอรี่ ${p.batteryHealth}%`);
  if (p.shopWarrantyDays != null) lines.push(`🛡️ ประกันร้าน ${p.shopWarrantyDays} วัน`);
  if (p.branchName) lines.push(`📍 สาขา${p.branchName}`);

  lines.push(`สถานะ: ${STATUS_TEXT[p.status] ?? p.status}`);
  if (shareUrl) lines.push(shareUrl);

  return lines.join('\n');
}
```

- [ ] **Step 4:** รัน → **5 passed**; Commit: `feat(inbox): ข้อความการ์ดสินค้าจากข้อมูลจริง — ลบ hardcode 'ผ่อนได้สูงสุด 12 งวด'`

---

### Task 6: `ChatCommerceService` — search/summary/การ์ด 2 bubble + ACCOUNTANT

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/chat-commerce.service.ts` (imports+ctor :1-26, `searchProducts` :170-223, `sendProductCard` :225-285 — บรรทัด 286 คือปีกกาปิดคลาส **ห้ามลบ**)
- Modify: `apps/api/src/modules/staff-chat/chat-commerce.controller.ts` (ทั้งไฟล์)
- Create: `apps/api/src/modules/staff-chat/services/chat-commerce.service.spec.ts`

**Interfaces:**
- Consumes: `ProductQuoteService.getQuotes` (Task 4), `buildProductCardText` (Task 5), `MessageRouterService.sendStaffMessage` (Task 1), `shopBaseUrl(): string | null` (`apps/api/src/utils/shop-base-url.util.ts:10`)
- Produces:
```ts
searchProducts(query: string, limit?: number): Promise<ChatProductHit[]>
getProductSummary(productId: string): Promise<{
  productId: string; title: string; text: string;
  photoUrl: string | null; shareUrl: string | null;
}>
sendProductCard(params: {
  sessionId: string; staffId: string; productId: string;
  clientMessageId: string; parts?: ('PHOTO' | 'TEXT')[];
}): Promise<{ sent: number; photoSkipped: boolean; errors: string[] }>
```
```ts
interface ChatProductHit {
  id: string; name: string; brand: string; model: string;
  color: string | null; storage: string | null;
  status: string; category: string;
  conditionGrade: string | null; batteryHealth: number | null;
  branchName: string | null;
  photoUrl: string | null;      // gallery[0] เท่านั้น
  cashPrice: number | null; installmentPrice: number | null;
  months: number | null; monthlyPayment: number | null; downAmount: number | null;
  shareUrl: string | null;
}
```

- [ ] **Step 1:** เขียน failing spec `chat-commerce.service.spec.ts`:

```ts
import { ChatCommerceService } from './chat-commerce.service';

function makeService(product?: any) {
  const prisma = {
    product: {
      findMany: jest.fn().mockResolvedValue(product ? [product] : []),
      findFirst: jest.fn().mockResolvedValue(product ?? null),
    },
  };
  const roomManager = { saveMessage: jest.fn() };
  const messageRouter = { sendStaffMessage: jest.fn().mockResolvedValue({ success: true }) };
  const productQuote = {
    getQuotes: jest.fn().mockResolvedValue([
      { cashPrice: 19500, installmentPrice: 20000, months: 12, monthlyPayment: 1926, downAmount: 4000 },
    ]),
  };
  const svc = new ChatCommerceService(
    prisma as any,
    roomManager as any,
    messageRouter as any,
    productQuote as any,
  );
  return { svc, prisma, messageRouter, productQuote };
}

const PRODUCT = {
  id: 'p1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  color: 'สีชมพู',
  storage: '128GB',
  status: 'IN_STOCK',
  category: 'PHONE_USED',
  conditionGrade: 'A',
  batteryHealth: 92,
  shopWarrantyDays: 30,
  cashPrice: '19500',
  installmentPrice: '20000',
  gallery: ['https://cdn.example/p1-0.jpg', 'https://cdn.example/p1-1.jpg'],
  branch: { name: 'ลาดพร้าว' },
  prices: [],
};

describe('ChatCommerceService.searchProducts', () => {
  it('ห้าม select photos[] (base64) และคืนรูปจาก gallery[0]', async () => {
    const { svc, prisma } = makeService(PRODUCT);
    const rows = await svc.searchProducts('iphone');

    const select = prisma.product.findMany.mock.calls[0][0].select;
    expect(select.photos).toBeUndefined();
    expect(select.gallery).toBe(true);
    expect(rows[0].photoUrl).toBe('https://cdn.example/p1-0.jpg');
    expect(rows[0].monthlyPayment).toBe(1926);
    expect(rows[0].branchName).toBe('ลาดพร้าว');
  });

  it('รวมเครื่องติดจองด้วย (แอดมินต้องเห็นว่ามีของแต่ถูกจอง)', async () => {
    const { svc, prisma } = makeService(PRODUCT);
    await svc.searchProducts('iphone');
    expect(prisma.product.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['IN_STOCK', 'RESERVED'],
    });
  });

  it('คำค้นสั้นกว่า 2 ตัว → คืน [] โดยไม่ยิง DB', async () => {
    const { svc, prisma } = makeService(PRODUCT);
    expect(await svc.searchProducts('i')).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

describe('ChatCommerceService.sendProductCard — 2 bubble idempotent', () => {
  it('ส่งรูปก่อนแล้วตามด้วยข้อความ ด้วย token คนละตัวที่คำนวณได้แน่นอน', async () => {
    const { svc, messageRouter } = makeService(PRODUCT);
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });

    expect(res).toEqual({ sent: 2, photoSkipped: false, errors: [] });
    expect(messageRouter.sendStaffMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        roomId: 'r1',
        type: 'IMAGE',
        mediaUrl: 'https://cdn.example/p1-0.jpg',
        clientMessageId: 'tok-img',
      }),
    );
    const second = messageRouter.sendStaffMessage.mock.calls[1][0];
    expect(second.clientMessageId).toBe('tok-txt');
    expect(second.text).toContain('ผ่อน 12 งวด งวดละ 1,926 บาท');
  });

  it('เครื่องไม่มี gallery → ข้าม bubble รูป ส่งเฉพาะข้อความ + แจ้ง photoSkipped', async () => {
    const { svc, messageRouter } = makeService({ ...PRODUCT, gallery: [] });
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });

    expect(res.photoSkipped).toBe(true);
    expect(res.sent).toBe(1);
    expect(messageRouter.sendStaffMessage).toHaveBeenCalledTimes(1);
  });

  it('parts=["PHOTO"] → ส่งเฉพาะรูป', async () => {
    const { svc, messageRouter } = makeService(PRODUCT);
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
      parts: ['PHOTO'],
    });
    expect(res.sent).toBe(1);
    expect(messageRouter.sendStaffMessage).toHaveBeenCalledTimes(1);
    expect(messageRouter.sendStaffMessage.mock.calls[0][0].type).toBe('IMAGE');
  });

  it('bubble ใดล้มเหลว → รายงาน error โดยไม่ throw', async () => {
    const { svc, messageRouter } = makeService(PRODUCT);
    messageRouter.sendStaffMessage
      .mockResolvedValueOnce({ success: false, error: 'LINE 400' })
      .mockResolvedValueOnce({ success: true });
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });
    expect(res.sent).toBe(1);
    expect(res.errors).toEqual(['LINE 400']);
  });
});
```

- [ ] **Step 2:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/chat-commerce.service.spec.ts` → fail
- [ ] **Step 3:** แก้ imports + constructor ของ `chat-commerce.service.ts` (:1-26):

```ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MessageRole, MessageType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RoomManagerService } from '../../chat-engine/services/room-manager.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { ProductQuoteService } from './product-quote.service';
import { buildProductCardText } from './product-card-text.util';
import { shopBaseUrl } from '../../../utils/shop-base-url.util';

export type ProductCardPart = 'PHOTO' | 'TEXT';

@Injectable()
export class ChatCommerceService {
  private readonly logger = new Logger(ChatCommerceService.name);

  constructor(
    private prisma: PrismaService,
    private roomManager: RoomManagerService,
    private messageRouter: MessageRouterService,
    private productQuote: ProductQuoteService,
  ) {}
```

- [ ] **Step 4:** แทน `searchProducts` (:170-223) ทั้งเมธอด:

```ts
  /**
   * ค้นสินค้าสำหรับ product picker ในกล่องแชท.
   * ห้าม select `photos` — เป็น base64 data URL (products-online-listing.service.ts:8)
   * ส่ง LINE/FB ไม่ได้และทำ payload บวมระดับ MB. รูปที่ส่งลูกค้าได้คือ gallery[] เท่านั้น
   */
  async searchProducts(query: string, limit = 10) {
    if (!query || query.trim().length < 2) {
      return [];
    }
    const searchTerm = query.trim();

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: { in: ['IN_STOCK', 'RESERVED'] },
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { brand: { contains: searchTerm, mode: 'insensitive' } },
          { model: { contains: searchTerm, mode: 'insensitive' } },
          { imeiSerial: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        color: true,
        storage: true,
        status: true,
        category: true,
        conditionGrade: true,
        batteryHealth: true,
        shopWarrantyDays: true,
        cashPrice: true,
        installmentPrice: true,
        gallery: true,
        branch: { select: { name: true } },
        prices: {
          where: { deletedAt: null },
          select: { label: true, amount: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 20),
    });

    const quotes = await this.productQuote.getQuotes(
      products.map((p) => ({
        category: p.category,
        cashPrice: p.cashPrice,
        installmentPrice: p.installmentPrice,
        prices: p.prices,
      })),
    );
    const base = shopBaseUrl();

    return products.map((p, i) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      model: p.model,
      color: p.color,
      storage: p.storage,
      status: p.status,
      category: p.category,
      conditionGrade: p.conditionGrade,
      batteryHealth: p.batteryHealth,
      branchName: p.branch?.name ?? null,
      photoUrl: p.gallery[0] ?? null,
      cashPrice: quotes[i].cashPrice,
      installmentPrice: quotes[i].installmentPrice,
      months: quotes[i].months,
      monthlyPayment: quotes[i].monthlyPayment,
      downAmount: quotes[i].downAmount,
      shareUrl: base ? `${base}/products/${p.id}` : null,
    }));
  }
```

- [ ] **Step 5:** แทน `sendProductCard` (:225-285 — jsdoc :225-227 + เมธอด :228-285; **อย่ากินบรรทัด 286 ที่เป็นปีกกาปิดคลาส**) ด้วย `getProductSummary` + `sendProductCard` ใหม่:

```ts
  /**
   * ข้อมูลการ์ดสินค้าชุดเดียวที่ทั้ง "แทรกสรุป" (ฝั่ง UI) และ "ส่งการ์ด"
   * (ฝั่ง server) ใช้ร่วมกัน — ข้อความจึงไม่มีทาง drift ระหว่าง 2 ทาง
   */
  async getProductSummary(productId: string): Promise<{
    productId: string;
    title: string;
    text: string;
    photoUrl: string | null;
    shareUrl: string | null;
  }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        color: true,
        storage: true,
        status: true,
        category: true,
        conditionGrade: true,
        batteryHealth: true,
        shopWarrantyDays: true,
        cashPrice: true,
        installmentPrice: true,
        gallery: true,
        branch: { select: { name: true } },
        prices: { where: { deletedAt: null }, select: { label: true, amount: true } },
      },
    });
    if (!product) {
      throw new NotFoundException('ไม่พบสินค้าที่ระบุ');
    }

    const [quote] = await this.productQuote.getQuotes([
      {
        category: product.category,
        cashPrice: product.cashPrice,
        installmentPrice: product.installmentPrice,
        prices: product.prices,
      },
    ]);
    const base = shopBaseUrl();
    // ก่อน B4 (share endpoint) ใช้ /products/:id ของหน้าร้านตรงๆ
    const shareUrl = base ? `${base}/products/${product.id}` : null;
    const facts = {
      name: product.name,
      brand: product.brand,
      model: product.model,
      color: product.color,
      storage: product.storage,
      category: product.category,
      status: product.status,
      conditionGrade: product.conditionGrade,
      batteryHealth: product.batteryHealth,
      shopWarrantyDays: product.shopWarrantyDays,
      branchName: product.branch?.name ?? null,
    };

    return {
      productId: product.id,
      title: [product.brand, product.model, product.storage, product.color]
        .filter(Boolean)
        .join(' ')
        .trim() || product.name,
      text: buildProductCardText(facts, quote, shareUrl),
      photoUrl: product.gallery[0] ?? null,
      shareUrl,
    };
  }

  /**
   * ส่งการ์ดสินค้าเป็น 2 bubble (รูป → ข้อความ) ผ่าน primitive เดียวกับ
   * ข้อความปกติ. token ของแต่ละ bubble คำนวณจาก clientMessageId ของผู้เรียก
   * แบบ deterministic (`-img` / `-txt`) → กด "ส่ง" ซ้ำหรือ retry ทั้ง request
   * ลูกค้าจะไม่ได้รับซ้ำ (unique [roomId, clientMessageId])
   */
  async sendProductCard(params: {
    sessionId: string;
    staffId: string;
    productId: string;
    clientMessageId: string;
    parts?: ProductCardPart[];
  }): Promise<{ sent: number; photoSkipped: boolean; errors: string[] }> {
    const summary = await this.getProductSummary(params.productId);
    const parts: ProductCardPart[] = params.parts?.length ? params.parts : ['PHOTO', 'TEXT'];
    const errors: string[] = [];
    let sent = 0;
    let photoSkipped = false;

    if (parts.includes('PHOTO')) {
      if (!summary.photoUrl) {
        photoSkipped = true;
      } else {
        // gallery[] เป็น public URL อยู่แล้ว (products-online-listing.service.ts:90
        // `storage.getPublicUrl(key)`) จึงไม่ต้อง deliveryMediaUrl และ signMessageMedia
        // ปล่อยผ่านเพราะไม่ใช่ storage key. ไม่ส่ง mediaType → MessageBubble.tsx:342-357
        // เข้า branch ChatImage (เงื่อนไข file คือ type==='FILE' หรือ mediaType ไม่ใช่ image/*)
        const r = await this.messageRouter.sendStaffMessage({
          roomId: params.sessionId,
          staffId: params.staffId,
          type: MessageType.IMAGE,
          mediaUrl: summary.photoUrl,
          clientMessageId: `${params.clientMessageId}-img`,
        });
        if (r.success) sent += 1;
        else errors.push(r.error ?? 'ส่งรูปสินค้าไม่สำเร็จ');
      }
    }

    if (parts.includes('TEXT')) {
      const r = await this.messageRouter.sendStaffMessage({
        roomId: params.sessionId,
        staffId: params.staffId,
        text: summary.text,
        clientMessageId: `${params.clientMessageId}-txt`,
      });
      if (r.success) sent += 1;
      else errors.push(r.error ?? 'ส่งข้อความสินค้าไม่สำเร็จ');
    }

    this.logger.log(
      `Product card sent: room=${params.sessionId} product=${params.productId} sent=${sent} skipped=${photoSkipped}`,
    );
    return { sent, photoSkipped, errors };
  }
```

- [ ] **Step 6:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/chat-commerce.service.spec.ts` → **7 passed** (3 search + 4 การ์ด)
> ⚠️ **ACCOUNTANT ยังเข้าไม่ถึงจริงจนกว่า owner จะเคาะ** — spec §4 สั่งเพิ่ม ACCOUNTANT ใน chat-commerce แต่ verify กับโค้ดแล้วยัง**ไม่พอ** end-to-end: (1) route `/inbox` มี `ProtectedRoute roles={['OWNER','BRANCH_MANAGER','FINANCE_MANAGER','SALES']}` (`apps/web/src/App.tsx:485`) → ACCOUNTANT เปิดหน้าไม่ได้; (2) `GET /staff-chat/rooms/:id/products` (`staff-chat.controller.ts:496-497`) และ `POST rooms/:id/upload` (:521-522) ก็ไม่มี ACCOUNTANT. B2 ทำตาม spec เฉพาะ chat-commerce (ไม่ขยาย role ที่อื่นเอง) — **ถ้า owner ต้องการให้ ACCOUNTANT ใช้ inbox ได้จริง ต้องเพิ่มอีก 3 จุดข้างต้นในงานแยก**

- [ ] **Step 7:** แทน `chat-commerce.controller.ts` ทั้งไฟล์ (เพิ่ม ACCOUNTANT ทุก route + route summary + body ใหม่):

```ts
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatCommerceService, ProductCardPart } from './services/chat-commerce.service';

const STAFF_ROLES = [
  'OWNER',
  'BRANCH_MANAGER',
  'FINANCE_MANAGER',
  'ACCOUNTANT',
  'SALES',
] as const;

@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatCommerceController {
  constructor(private chatCommerce: ChatCommerceService) {}

  // ─── Payment Links ────────────────────────────────────

  @Post('rooms/:id/payment-link')
  @Roles(...STAFF_ROLES)
  async createPaymentLink(
    @Param('id') roomId: string,
    @Body() body: { contractId: string; installmentNo?: number },
    @Req() req: any,
  ) {
    return this.chatCommerce.createPaymentLinkInChat({
      sessionId: roomId,
      staffId: req.user.id,
      contractId: body.contractId,
      installmentNo: body.installmentNo,
    });
  }

  // ─── Product Cards ────────────────────────────────────

  @Post('rooms/:id/product-card')
  @Roles(...STAFF_ROLES)
  async sendProductCard(
    @Param('id') roomId: string,
    @Body() body: { productId: string; clientMessageId?: string; parts?: ProductCardPart[] },
    @Req() req: any,
  ) {
    if (!body?.productId) {
      throw new BadRequestException('กรุณาระบุสินค้าที่จะส่ง');
    }
    // ไม่มี token = ส่งซ้ำได้ → บังคับให้ client ส่งมาเสมอ (idempotency)
    if (!body?.clientMessageId) {
      throw new BadRequestException('กรุณาระบุ clientMessageId');
    }
    return this.chatCommerce.sendProductCard({
      sessionId: roomId,
      staffId: req.user.id,
      productId: body.productId,
      clientMessageId: body.clientMessageId,
      parts: body.parts,
    });
  }

  // ─── Product Search ───────────────────────────────────

  @Get('products/search')
  @Roles(...STAFF_ROLES)
  async searchProducts(@Query('q') query: string) {
    return this.chatCommerce.searchProducts(query);
  }

  @Get('products/:id/summary')
  @Roles(...STAFF_ROLES)
  async getProductSummary(@Param('id') productId: string) {
    return this.chatCommerce.getProductSummary(productId);
  }
}
```

- [ ] **Step 8:** `cd apps/api && npx tsc --noEmit` → 0; รัน `cd apps/api && npx jest src/modules/staff-chat` → เขียวหมด
- [ ] **Step 9:** Commit: `feat(inbox): product picker API — search จาก gallery, summary, การ์ด 2 bubble idempotent + เปิดสิทธิ์ ACCOUNTANT`

---

### Task 7: `ProductPickerDialog` + ปุ่มในกล่องพิมพ์

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/ProductPickerDialog.tsx`
- Create: `apps/web/src/pages/UnifiedInboxPage/components/ProductPickerDialog.test.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (import :1-18, state :148-160, แถบปุ่ม composer :1005-1016, mount `MessageTemplatePicker` :1060-1081)

**Interfaces:**
- Consumes: `GET /staff-chat/products/search?q=` → `ChatProductHit[]` (Task 6), `GET /staff-chat/products/:id/summary` → `{ productId, title, text, photoUrl, shareUrl }`, `POST /staff-chat/rooms/:id/product-card` body `{ productId, clientMessageId, parts? }` → `{ sent, photoSkipped, errors }`
- Produces: `<ProductPickerDialog isOpen onClose onInsert(text) roomId />`

- [ ] **Step 1:** เขียน failing test `ProductPickerDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductPickerDialog from './ProductPickerDialog';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const HIT = {
  id: 'p1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  color: 'สีชมพู',
  storage: '128GB',
  status: 'IN_STOCK',
  category: 'PHONE_USED',
  conditionGrade: 'A',
  batteryHealth: 92,
  branchName: 'ลาดพร้าว',
  photoUrl: 'https://cdn.example/p1.jpg',
  cashPrice: 19500,
  installmentPrice: 20000,
  months: 12,
  monthlyPayment: 1926,
  downAmount: 4000,
  shareUrl: 'https://www.bestchoicephone.com/products/p1',
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('ProductPickerDialog', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset().mockResolvedValue({ data: { sent: 2, photoSkipped: false, errors: [] } });
  });

  it('ค้นแล้วโชว์ราคาเงินสด + ค่างวดจริง', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [HIT] });
    render(wrap(<ProductPickerDialog isOpen onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });

    expect(await screen.findByText('Apple iPhone 13')).toBeInTheDocument();
    expect(screen.getByText(/19,500/)).toBeInTheDocument();
    expect(screen.getByText(/1,926/)).toBeInTheDocument();
  });

  it('เครื่องที่ไม่มีรูปขึ้นเว็บ → ขึ้นคำเตือน และปุ่มส่งรูปถูกปิด', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ ...HIT, photoUrl: null }] });
    render(wrap(<ProductPickerDialog isOpen onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });
    fireEvent.click(await screen.findByText('Apple iPhone 13'));

    expect(await screen.findByText('ยังไม่มีรูปขึ้นเว็บ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ส่งรูป' })).toBeDisabled();
  });

  it('กดส่งการ์ด → POST พร้อม clientMessageId แล้วปิด dialog', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('/summary')
        ? Promise.resolve({ data: { productId: 'p1', title: 'Apple iPhone 13', text: 'สรุป', photoUrl: HIT.photoUrl, shareUrl: HIT.shareUrl } })
        : Promise.resolve({ data: [HIT] }),
    );
    const onClose = vi.fn();
    render(wrap(<ProductPickerDialog isOpen onClose={onClose} onInsert={vi.fn()} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });
    fireEvent.click(await screen.findByText('Apple iPhone 13'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งการ์ด (รูป + ข้อความ)' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/staff-chat/rooms/r1/product-card');
    expect(body).toMatchObject({ productId: 'p1', parts: ['PHOTO', 'TEXT'] });
    expect(typeof (body as any).clientMessageId).toBe('string');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('กดแทรกสรุป → ส่งข้อความจาก summary เข้ากล่องพิมพ์', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('/summary')
        ? Promise.resolve({ data: { productId: 'p1', title: 'Apple iPhone 13', text: 'สรุปสินค้า', photoUrl: null, shareUrl: null } })
        : Promise.resolve({ data: [HIT] }),
    );
    const onInsert = vi.fn();
    render(wrap(<ProductPickerDialog isOpen onClose={vi.fn()} onInsert={onInsert} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });
    fireEvent.click(await screen.findByText('Apple iPhone 13'));
    // ต้องรอ summary โหลดก่อน — ปุ่ม disabled อยู่จนกว่า summary จะมา
    // (กดตอน disabled = ไม่มี event, test จะ timeout แบบงงๆ)
    expect(await screen.findByText('สรุปสินค้า')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'แทรกสรุปในกล่องพิมพ์' }));

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith('สรุปสินค้า'));
  });
});
```

- [ ] **Step 2:** รัน `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/ProductPickerDialog.test.tsx` → fail (ไม่มีไฟล์)
- [ ] **Step 3:** สร้าง `ProductPickerDialog.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImageOff, Search, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';

interface ChatProductHit {
  id: string;
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  status: string;
  category: string;
  conditionGrade: string | null;
  batteryHealth: number | null;
  branchName: string | null;
  photoUrl: string | null;
  cashPrice: number | null;
  installmentPrice: number | null;
  months: number | null;
  monthlyPayment: number | null;
  downAmount: number | null;
  shareUrl: string | null;
}

interface ProductSummary {
  productId: string;
  title: string;
  text: string;
  photoUrl: string | null;
  shareUrl: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
  roomId: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'พร้อมขาย',
  RESERVED: 'ติดจอง',
};

const baht = (n: number | null) => (n == null ? '-' : n.toLocaleString('th-TH', { maximumFractionDigits: 2 }));

export default function ProductPickerDialog({ isOpen, onClose, onInsert, roomId }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounced = useDebounce(search, 300);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedId(null);
    }
  }, [isOpen]);

  const { data: hits = [], isFetching } = useQuery<ChatProductHit[]>({
    queryKey: ['chat-product-search', debounced],
    queryFn: () =>
      api.get('/staff-chat/products/search', { params: { q: debounced } }).then((r: any) => r.data),
    enabled: isOpen && debounced.trim().length >= 2,
    refetchOnWindowFocus: false,
  });

  const { data: summary } = useQuery<ProductSummary>({
    queryKey: ['chat-product-summary', selectedId],
    queryFn: () => api.get(`/staff-chat/products/${selectedId}/summary`).then((r: any) => r.data),
    enabled: !!selectedId,
    refetchOnWindowFocus: false,
  });

  const selected = hits.find((h) => h.id === selectedId) ?? null;

  const sendMut = useMutation({
    mutationFn: (parts: ('PHOTO' | 'TEXT')[]) =>
      api.post(`/staff-chat/rooms/${roomId}/product-card`, {
        productId: selectedId,
        clientMessageId: crypto.randomUUID(),
        parts,
      }),
    onSuccess: (res: any) => {
      const data = res?.data ?? res;
      if (data?.errors?.length) {
        toast.error(`ส่งไม่ครบ — ${data.errors[0]}`);
      } else if (data?.photoSkipped) {
        toast.warning('ส่งข้อความแล้ว — เครื่องนี้ยังไม่มีรูปขึ้นเว็บ');
      } else {
        toast.success('ส่งให้ลูกค้าแล้ว');
      }
      // การ์ดถูกบันทึกเป็น ChatMessage ฝั่ง server → ดึงข้อความ/รายการห้องใหม่
      queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      onClose();
    },
    onError: () => toast.error('ส่งข้อมูลสินค้าไม่สำเร็จ'),
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ส่งข้อมูลสินค้าให้ลูกค้า</DialogTitle>
          <DialogDescription>
            ค้นเครื่องในสต็อก แล้วเลือกว่าจะแทรกสรุปในกล่องพิมพ์ หรือส่งให้ลูกค้าเลย
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI"
            className="pl-8"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {debounced.trim().length < 2 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา
            </p>
          )}
          {debounced.trim().length >= 2 && !isFetching && hits.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              ไม่พบเครื่องที่ตรงกับคำค้น
            </p>
          )}
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setSelectedId(h.id)}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent',
                selectedId === h.id && 'bg-accent',
              )}
            >
              <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {h.photoUrl ? (
                  <img src={h.photoUrl} alt={h.name} className="size-full object-cover" />
                ) : (
                  <ImageOff className="size-4 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-snug">
                  {[h.brand, h.model].filter(Boolean).join(' ')}
                </span>
                <span className="block truncate text-[11px] leading-snug text-muted-foreground">
                  {[h.storage, h.color, h.branchName ? `สาขา${h.branchName}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[13px] font-bold leading-snug text-primary">
                  ฿{baht(h.cashPrice)}
                </span>
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {h.monthlyPayment != null && h.months != null
                    ? `ผ่อน ${h.months} งวด ฿${baht(h.monthlyPayment)}`
                    : STATUS_LABEL[h.status] ?? h.status}
                </span>
              </span>
            </button>
          ))}
        </div>

        {selected && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <Smartphone className="size-3.5 text-primary" />
              {[selected.brand, selected.model, selected.storage].filter(Boolean).join(' ')}
            </div>
            {!selected.photoUrl && (
              <p className="mt-1 text-[11px] leading-snug text-warning">ยังไม่มีรูปขึ้นเว็บ</p>
            )}
            <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
              {summary?.text ?? 'กำลังเตรียมข้อความ...'}
            </pre>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={!summary}
            onClick={() => {
              if (!summary) return;
              onInsert(summary.text);
              onClose();
            }}
          >
            แทรกสรุปในกล่องพิมพ์
          </Button>
          <Button
            variant="outline"
            disabled={!roomId || !selected?.photoUrl || sendMut.isPending}
            onClick={() => sendMut.mutate(['PHOTO'])}
          >
            ส่งรูป
          </Button>
          <Button
            disabled={!roomId || !selectedId || sendMut.isPending}
            onClick={() => sendMut.mutate(['PHOTO', 'TEXT'])}
          >
            ส่งการ์ด (รูป + ข้อความ)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4:** รัน `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/ProductPickerDialog.test.tsx` → **4 passed**
- [ ] **Step 5:** ต่อสายใน `ChatPanel.tsx` — เพิ่ม `Smartphone` เข้า import lucide บรรทัด 3, เพิ่ม import `import ProductPickerDialog from './ProductPickerDialog';` ใต้บรรทัด 12, เพิ่ม state ใต้บรรทัด 153:

```tsx
  const [showProductPicker, setShowProductPicker] = useState(false);
```

- [ ] **Step 6:** แยกตัวช่วยแทรกข้อความที่ caret ออกมาเป็นฟังก์ชันเดียว (ใช้ร่วมกับ MessageTemplatePicker) — เพิ่มใต้ `handleSelectSuggestion` (:476-480):

```tsx
  const insertAtCaret = (content: string) => {
    const textarea = inputRef.current;
    if (textarea) {
      const start = textarea.selectionStart ?? inputText.length;
      const end = textarea.selectionEnd ?? inputText.length;
      setInputText(inputText.slice(0, start) + content + inputText.slice(end));
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + content.length;
        textarea.focus();
      });
    } else {
      setInputText((prev) => prev + (prev ? '\n' : '') + content);
    }
  };
```

- [ ] **Step 7:** เพิ่มปุ่มในแถบ composer ก่อนปุ่มข้อความสำเร็จรูป — **แทรกระหว่างบรรทัด 1005 (`</Popover>`) กับ 1006 (`{/* Message template picker */}`)** เพื่อไม่ให้ปุ่มใหม่ไปคั่นระหว่างคอมเมนต์เดิมกับปุ่มของมัน:

```tsx
            {/* Product picker */}
            <button
              onClick={() => setShowProductPicker(true)}
              disabled={!session?.id}
              aria-label="ส่งข้อมูลสินค้า"
              className="p-2 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="ส่งข้อมูล/รูปสินค้า"
            >
              <Smartphone className="w-4 h-4" />
            </button>
```

- [ ] **Step 8:** ยุบ `onInsert` inline ของ `MessageTemplatePicker` (:1064-1079 — โค้ดก้อนเดียวกับ `insertAtCaret` เป๊ะ) ให้เรียกฟังก์ชันร่วม แล้ว mount dialog ใหม่ต่อท้าย (หลังบรรทัด 1081 `/>`) — ผลลัพธ์ทั้งบล็อกเป็น:

```tsx
      {/* Message Template Picker */}
      <MessageTemplatePicker
        isOpen={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        onInsert={insertAtCaret}
        roomId={session?.id ?? null}
      />

      <ProductPickerDialog
        isOpen={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        onInsert={insertAtCaret}
        roomId={session?.id ?? null}
      />
```

- [ ] **Step 9:** ยืนยัน query key ที่ invalidate ตรงกับของจริง — `grep -n "queryKey: \['chat-messages'" apps/web/src/pages/UnifiedInboxPage/index.tsx` และ `grep -n "'chat-rooms'" apps/web/src/pages/UnifiedInboxPage/index.tsx` ต้องเจอทั้งคู่ (ถ้า key เปลี่ยน ให้แก้ใน `onSuccess` ของ Step 3 ให้ตรง)
- [ ] **Step 10:** รัน `cd apps/web && npx vitest run src/pages/UnifiedInboxPage` → เขียวหมด; `cd apps/web && npx tsc --noEmit` → 0
- [ ] **Step 11:** Commit: `feat(inbox): product picker ในกล่องพิมพ์ — แทรกสรุป / ส่งการ์ด / ส่งรูปจาก gallery`

---

### Task 8: ฟีดแบ็กการอัปโหลด — บอกตรงๆ ว่าลูกค้าได้รับหรือยัง

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx:398-420` (`uploadFileMutation`)

**Interfaces:**
- Consumes: `POST /staff-chat/rooms/:id/upload` (multipart `file` + `clientMessageId`) → `{ success, url, key, filename, delivered, error? }` (Task 3)

- [ ] **Step 1:** แทน `uploadFileMutation` ทั้งก้อน:

```tsx
  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeRoomId) throw new Error('ไม่มี room');
      const formData = new FormData();
      formData.append('file', file);
      // token กัน double-send เวลา retry (unique [roomId, clientMessageId] ฝั่ง DB)
      formData.append('clientMessageId', crypto.randomUUID());
      const { data } = await api.post(`/staff-chat/rooms/${activeRoomId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data as { delivered?: boolean; error?: string };
    },
    onSuccess: (data) => {
      if (data?.delivered) {
        toast.success('ส่งรูปให้ลูกค้าแล้ว');
      } else if (data?.error) {
        toast.error(`อัปโหลดแล้วแต่ส่งถึงลูกค้าไม่สำเร็จ — ${data.error}`);
      } else {
        toast.warning('แนบไฟล์ในห้องแล้ว — ลูกค้ายังไม่ได้รับ (ช่องทางนี้ส่งไฟล์ไม่ได้)');
      }
      if (activeRoomId) {
        queryClient.invalidateQueries({ queryKey: ['chat-messages', activeRoomId] });
      }
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
        || (err instanceof Error ? err.message : 'อัพโหลดไม่สำเร็จ');
      toast.error(msg);
    },
  });
```

- [ ] **Step 2:** `cd apps/web && npx tsc --noEmit` → 0
- [ ] **Step 3:** Commit: `feat(inbox): แจ้งแอดมินตรงๆ ว่าไฟล์ที่แนบถึงลูกค้าแล้วหรือยัง`

---

### Task 9: สร้างสัญญาจากแชท — ส่ง `?customerId=&productId=`

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/contract-create-url.ts`
- Create: `apps/web/src/pages/UnifiedInboxPage/components/contract-create-url.test.ts`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx` (imports :1-7, state :30-32, ปุ่มสร้างสัญญา :157-168)

**Interfaces:**
- Consumes: `GET /staff-chat/rooms/:id/contract-prefill` → `{ customerId?, customerName?, phone?, suggestedProducts?: {id,name,brand}[] }` (`chat-to-contract.service.ts:17-22`)
- Produces: `buildContractCreateUrl(customerId: string, productId?: string | null): string`
- **หมายเหตุ:** `useContractCreateData.ts:15-19` อ่านแค่ `customerId / productId / downAmount / months` เท่านั้น (`productId` prefetch จริงที่ :182-191) — ห้ามส่ง `suggestedProducts` ไปใน URL (no-op)

- [ ] **Step 1:** เขียน failing test `contract-create-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildContractCreateUrl } from './contract-create-url';

describe('buildContractCreateUrl', () => {
  it('ไม่ระบุเครื่อง → ส่งแค่ customerId', () => {
    expect(buildContractCreateUrl('c1')).toBe('/contracts/create?customerId=c1');
  });

  it('ระบุเครื่อง → ส่ง customerId + productId (2 param ที่ wizard อ่านจริง)', () => {
    expect(buildContractCreateUrl('c1', 'p9')).toBe(
      '/contracts/create?customerId=c1&productId=p9',
    );
  });

  it('productId ว่าง/null → ไม่ใส่ param เปล่า', () => {
    expect(buildContractCreateUrl('c1', null)).toBe('/contracts/create?customerId=c1');
    expect(buildContractCreateUrl('c1', '')).toBe('/contracts/create?customerId=c1');
  });

  it('encode ค่าที่มีอักขระพิเศษ', () => {
    expect(buildContractCreateUrl('a b', 'p/1')).toBe(
      '/contracts/create?customerId=a+b&productId=p%2F1',
    );
  });
});
```

- [ ] **Step 2:** รัน `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/contract-create-url.test.ts` → fail
- [ ] **Step 3:** สร้าง `contract-create-url.ts`:

```ts
/**
 * URL ของ wizard สร้างสัญญาพร้อม prefill.
 * useContractCreateData.ts:15-19 อ่านแค่ customerId / productId / downAmount / months
 * — param อื่น (เช่น suggestedProducts) เป็น no-op จึงไม่ส่งไป
 */
export function buildContractCreateUrl(customerId: string, productId?: string | null): string {
  const params = new URLSearchParams({ customerId });
  if (productId) params.set('productId', productId);
  return `/contracts/create?${params.toString()}`;
}
```

- [ ] **Step 4:** รัน → **4 passed**
- [ ] **Step 5:** แก้ `SessionActions.tsx` — เพิ่ม import (บรรทัด 6-7):

```tsx
import { buildContractCreateUrl } from './contract-create-url';
```

เพิ่ม state + ref ใต้บรรทัด 32:

```tsx
  const [showProductList, setShowProductList] = useState(false);
  const contractRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 6:** เพิ่ม query เครื่องที่แนะนำ ใต้ `staffQuery` (:52-57):

```tsx
  // เครื่องที่ลูกค้าเอ่ยถึงในแชท — เป็นแค่ "ตัวช่วยเลือก" ฝั่ง inbox
  // เลือก 1 เครื่อง = กลายเป็น productId ใน URL ของ wizard
  const prefillQuery = useQuery({
    queryKey: ['chat-contract-prefill', session?.id],
    queryFn: () =>
      api.get(`/staff-chat/rooms/${session.id}/contract-prefill`).then((r: any) => r.data),
    enabled: showProductList && !!session?.id,
    staleTime: 60_000,
  });
  const suggestedProducts: { id: string; name: string; brand: string }[] =
    prefillQuery.data?.suggestedProducts ?? [];
```

- [ ] **Step 7:** ปิดเมนูเมื่อกด Escape/คลิกนอก — เพิ่ม effect ต่อจาก effect เดิม (:34-49):

```tsx
  useEffect(() => {
    if (!showProductList) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowProductList(false);
    };
    const onClick = (e: MouseEvent) => {
      if (contractRef.current && !contractRef.current.contains(e.target as Node))
        setShowProductList(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [showProductList]);
```

- [ ] **Step 8:** แทนปุ่ม "สร้างสัญญา" เดิม (:157-168) ด้วยเมนูเลือกเครื่อง:

```tsx
        {/* Create contract — เลือกเครื่องก่อน แล้ว prefill ทั้ง customerId + productId */}
        {session.customerId && (
          <div className="relative" ref={contractRef}>
            <button
              onClick={() => setShowProductList((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showProductList}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
            >
              <FileSignature className="w-3.5 h-3.5" />
              สร้างสัญญา
              <ChevronRight className={`w-3 h-3 transition-transform ${showProductList ? 'rotate-90' : ''}`} />
            </button>

            {showProductList && (
              <div role="menu" className="absolute left-0 top-full mt-1 w-60 bg-card border border-border rounded-lg shadow-lg z-20 py-1">
                {prefillQuery.isLoading && (
                  <div className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    กำลังโหลด...
                  </div>
                )}
                {!prefillQuery.isLoading && suggestedProducts.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground leading-snug">
                    ไม่พบเครื่องที่พูดถึงในแชท — เลือกเครื่องในขั้นตอนถัดไป
                  </div>
                )}
                {suggestedProducts.map((p) => (
                  <button
                    key={p.id}
                    role="menuitem"
                    onClick={() => {
                      navigate(buildContractCreateUrl(session.customerId, p.id));
                      setShowProductList(false);
                      onClose();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                  >
                    <span className="truncate flex-1 leading-snug">{p.name}</span>
                  </button>
                ))}
                <button
                  role="menuitem"
                  onClick={() => {
                    navigate(buildContractCreateUrl(session.customerId));
                    setShowProductList(false);
                    onClose();
                  }}
                  className="mt-1 w-full border-t border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted transition-colors leading-snug"
                >
                  ไม่ระบุเครื่อง — ไปเลือกในหน้าสร้างสัญญา
                </button>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 9:** รัน `cd apps/web && npx vitest run src/pages/UnifiedInboxPage` → เขียว; `cd apps/web && npx tsc --noEmit` → 0
- [ ] **Step 10:** Commit: `feat(inbox): สร้างสัญญาจากแชทพร้อมเลือกเครื่อง → prefill customerId + productId`

---

### Task 10: `ProductContextCard` + `ProductDetectService` — เลิกโหลด base64, ตัวเลขจริง

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/product-detect.service.ts` (imports+interface+ctor+`detectProducts` :1-61, `enrichProducts` :82-151 + ปีกกาปิดคลาส :152)
- Modify: `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts:100` (ป้ายดาวน์)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ProductContextCard.tsx` (ทั้งไฟล์)
- Create: `apps/api/src/modules/staff-chat/services/product-detect.service.spec.ts`

**Interfaces:**
- Consumes: `ProductQuoteService.getQuotes` (Task 4)
- Produces (เปลี่ยน shape ของ `DetectedProduct` แบบ additive — คีย์เดิมคงไว้ทั้งหมดเพื่อไม่ทำ `AiSuggestService` พัง):
```ts
interface DetectedProduct {
  id: string; name: string; brand: string; model: string;
  price: number;                 // = cashPrice (columns-first) — เดิมคือ prices[0]
  stock: number;                 // จำนวนเครื่อง IN_STOCK รุ่น+ความจุเดียวกัน (เดิม hardcode 1)
  imageUrl: string | null;       // gallery[0] — เดิมคือ photos[0] (base64!)
  installmentPrice: number | null;
  conditionGrade: string | null;
  pricingOptions: { downPaymentMin: number; monthlyPayment: number; installments: number; interestRate: number }[];
  activePromotions: { id: string; name: string; description: string }[];
}
```

- [ ] **Step 1:** เขียน failing spec `product-detect.service.spec.ts`:

```ts
import { ProductDetectService } from './product-detect.service';

function makeService(products: any[], counts: number[]) {
  let countCall = 0;
  const prisma = {
    product: {
      findMany: jest.fn().mockResolvedValue(products),
      count: jest.fn(async () => counts[countCall++] ?? 0),
    },
    promotion: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const productQuote = {
    getQuotes: jest.fn().mockResolvedValue([
      { cashPrice: 19500, installmentPrice: 20000, months: 12, monthlyPayment: 1926, downAmount: 4000 },
    ]),
  };
  return {
    svc: new ProductDetectService(prisma as any, productQuote as any),
    prisma,
  };
}

const ROW = {
  id: 'p1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  category: 'PHONE_USED',
  conditionGrade: 'A',
  cashPrice: '19500',
  installmentPrice: '20000',
  gallery: ['https://cdn.example/p1.jpg'],
  prices: [],
};

describe('ProductDetectService.detectProducts', () => {
  it('ห้าม select photos[] (base64) — ใช้ gallery[0] เป็นรูป', async () => {
    const { svc, prisma } = makeService([ROW], [3]);
    const out = await svc.detectProducts(['สนใจ iPhone 13 ครับ']);

    const select = prisma.product.findMany.mock.calls[0][0].select;
    expect(select.photos).toBeUndefined();
    expect(select.gallery).toBe(true);
    expect(out[0].imageUrl).toBe('https://cdn.example/p1.jpg');
  });

  it('stock = จำนวนเครื่องจริงในสต็อกรุ่น+ความจุเดียวกัน (ไม่ใช่ 1 ตายตัว)', async () => {
    const { svc, prisma } = makeService([ROW], [3]);
    const out = await svc.detectProducts(['iPhone 13']);

    expect(out[0].stock).toBe(3);
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        status: 'IN_STOCK',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
      },
    });
  });

  it('ค่างวดมาจาก ProductQuoteService ไม่ใช่สูตรมือ', async () => {
    const { svc } = makeService([ROW], [1]);
    const out = await svc.detectProducts(['iPhone 13']);

    expect(out[0].price).toBe(19500);
    expect(out[0].pricingOptions).toEqual([
      { downPaymentMin: 4000, monthlyPayment: 1926, installments: 12, interestRate: 0 },
    ]);
  });

  it('ไม่มีคำที่จับได้ → คืน [] โดยไม่ยิง DB', async () => {
    const { svc, prisma } = makeService([ROW], [1]);
    expect(await svc.detectProducts(['สวัสดีครับ'])).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/product-detect.service.spec.ts` → fail
- [ ] **Step 3:** แก้ `product-detect.service.ts` — **แทนบรรทัด 1-61** (imports + interface + constructor + `detectProducts`; `extractKeywords` :63-80 คงเดิม ไม่แตะ):

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductQuoteService, type DecimalLike } from './product-quote.service';

interface DetectedProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  /** ราคาเงินสด (columns-first) — เดิมอ่าน prices[0] ซึ่ง label ปนกันใน prod */
  price: number;
  /** จำนวนเครื่องในสต็อกรุ่น+ความจุเดียวกัน */
  stock: number;
  /** gallery[0] เท่านั้น — photos[] เป็น base64 data URL ห้ามส่งออก */
  imageUrl: string | null;
  installmentPrice: number | null;
  conditionGrade: string | null;
  pricingOptions: {
    downPaymentMin: number;
    monthlyPayment: number;
    installments: number;
    interestRate: number;
  }[];
  activePromotions: {
    id: string;
    name: string;
    description: string;
  }[];
}

@Injectable()
export class ProductDetectService {
  constructor(
    private prisma: PrismaService,
    private productQuote: ProductQuoteService,
  ) {}

  async detectProducts(messages: string[]): Promise<DetectedProduct[]> {
    const text = messages.join(' ').toLowerCase();
    const keywords = this.extractKeywords(text);
    if (keywords.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: 'IN_STOCK',
        OR: keywords.flatMap((kw) => [
          { name: { contains: kw, mode: 'insensitive' as const } },
          { brand: { contains: kw, mode: 'insensitive' as const } },
          { model: { contains: kw, mode: 'insensitive' as const } },
        ]),
      },
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        storage: true,
        category: true,
        conditionGrade: true,
        cashPrice: true,
        installmentPrice: true,
        gallery: true,
        prices: { where: { deletedAt: null }, select: { label: true, amount: true } },
      },
      take: 3,
    });

    return this.enrichProducts(products);
  }
```

- [ ] **Step 4:** แทน `enrichProducts` **พร้อมปีกกาปิดคลาส (:82-152)** ด้วยบล็อกนี้ (บล็อกมี `}` ปิดคลาสอยู่ท้ายแล้ว — ถ้าแทนแค่ :82-151 จะเหลือ `}` เกิน 1 ตัว):

```ts
  private async enrichProducts(
    products: {
      id: string;
      name: string;
      brand: string;
      model: string;
      storage: string | null;
      category: string;
      conditionGrade: string | null;
      cashPrice: DecimalLike | null;
      installmentPrice: DecimalLike | null;
      gallery: string[];
      prices: { label: string; amount: DecimalLike }[];
    }[],
  ): Promise<DetectedProduct[]> {
    if (products.length === 0) return [];

    const [quotes, counts, promotions] = await Promise.all([
      this.productQuote.getQuotes(
        products.map((p) => ({
          category: p.category,
          cashPrice: p.cashPrice,
          installmentPrice: p.installmentPrice,
          prices: p.prices,
        })),
      ),
      Promise.all(
        products.map((p) =>
          this.prisma.product.count({
            where: {
              deletedAt: null,
              status: 'IN_STOCK',
              brand: p.brand,
              model: p.model,
              storage: p.storage,
            },
          }),
        ),
      ),
      this.prisma.promotion.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
        select: { id: true, name: true, description: true },
        take: 3,
      }),
    ]);

    return products.map((product, i) => {
      const quote = quotes[i];
      return {
        id: product.id,
        name: product.name,
        brand: product.brand ?? '',
        model: product.model ?? '',
        price: quote.cashPrice ?? 0,
        stock: counts[i],
        imageUrl: product.gallery[0] ?? null,
        installmentPrice: quote.installmentPrice,
        conditionGrade: product.conditionGrade,
        pricingOptions:
          quote.months != null && quote.monthlyPayment != null
            ? [
                {
                  downPaymentMin: quote.downAmount ?? 0,
                  monthlyPayment: quote.monthlyPayment,
                  installments: quote.months,
                  interestRate: 0,
                },
              ]
            : [],
        activePromotions: promotions.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description ?? '',
        })),
      };
    });
  }
}
```

- [ ] **Step 5:** แก้ป้ายที่ผิดใน `ai-suggest.service.ts:100` (`downPaymentMin` เป็น **จำนวนเงิน** ไม่ใช่ % — ของเดิมลงท้าย `(ดาวน์ ${o.downPaymentMin}%)`):

```ts
                          `ผ่อน ${o.installments} งวด งวดละ ${o.monthlyPayment.toLocaleString()} บาท (ดาวน์ ${o.downPaymentMin.toLocaleString()} บาท)`,
```

- [ ] **Step 6:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/product-detect.service.spec.ts` → **4 passed**; `cd apps/api && npx tsc --noEmit` → 0
- [ ] **Step 7:** แทน `ProductContextCard.tsx` ทั้งไฟล์:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import api from '@/lib/api';
import { ImageOff, Send, Smartphone, Tag, BadgePercent } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface DetectedProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  installmentPrice: number | null;
  conditionGrade: string | null;
  pricingOptions: {
    downPaymentMin: number;
    monthlyPayment: number;
    installments: number;
  }[];
  activePromotions: { id: string; name: string; description: string }[];
}

interface ProductContextCardProps {
  roomId: string;
}

const baht = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 });

export default function ProductContextCard({ roomId }: ProductContextCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: products, isLoading } = useQuery<DetectedProduct[]>({
    queryKey: ['chat-products', roomId],
    queryFn: () =>
      api.get(`/staff-chat/rooms/${roomId}/products`).then((r: any) => r.data?.data ?? r.data),
    enabled: !!roomId,
    staleTime: 60_000,
  });

  const sendMut = useMutation({
    mutationFn: (productId: string) =>
      api.post(`/staff-chat/rooms/${roomId}/product-card`, {
        productId,
        clientMessageId: crypto.randomUUID(),
        parts: ['PHOTO', 'TEXT'],
      }),
    onSuccess: (res: any) => {
      const data = res?.data ?? res;
      if (data?.errors?.length) toast.error(`ส่งไม่ครบ — ${data.errors[0]}`);
      else if (data?.photoSkipped) toast.warning('ส่งข้อความแล้ว — เครื่องนี้ยังไม่มีรูปขึ้นเว็บ');
      else toast.success('ส่งให้ลูกค้าแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
    onError: () => toast.error('ส่งข้อมูลสินค้าไม่สำเร็จ'),
  });

  if (isLoading || !products || products.length === 0) return null;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center gap-2 mb-2 px-4">
        <Smartphone className="size-3.5 text-primary opacity-60" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
          สินค้าที่กำลังคุย
        </span>
      </div>

      <div className="space-y-2 px-4">
        {products.map((product) => (
          <div key={product.id} className="bg-muted/40 rounded-lg p-3 text-[12px]">
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => navigate(`/products/${product.id}`)}
                title="เปิดหน้าสินค้า"
                className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background"
              >
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="size-full object-cover" />
                ) : (
                  <ImageOff className="size-4 text-muted-foreground" />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => navigate(`/products/${product.id}`)}
                  className="block max-w-full truncate text-left text-[13px] font-semibold leading-snug hover:underline"
                >
                  {product.name}
                </button>
                <p className="truncate text-muted-foreground leading-snug">
                  {product.brand} {product.model}
                  {product.conditionGrade ? ` · สภาพ ${product.conditionGrade}` : ''}
                </p>
              </div>

              <Badge
                variant={product.stock > 0 ? 'success' : 'destructive'}
                className="shrink-0 text-[10px]"
              >
                {product.stock > 0 ? `${product.stock} เครื่อง` : 'หมด'}
              </Badge>
            </div>

            <p className="text-primary font-bold mt-1.5">฿{baht(product.price)}</p>

            {product.pricingOptions?.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {product.pricingOptions.slice(0, 2).map((opt, i) => (
                  <p key={i} className="text-muted-foreground flex items-center gap-1 leading-snug">
                    <Tag className="size-3 opacity-40" />
                    ผ่อน {opt.installments} งวด งวดละ {baht(opt.monthlyPayment)} บาท (ดาวน์{' '}
                    {baht(opt.downPaymentMin)} บาท)
                  </p>
                ))}
              </div>
            )}

            {product.activePromotions?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {product.activePromotions.map((promo) => (
                  <Badge key={promo.id} variant="secondary" className="text-[10px]">
                    <BadgePercent className="size-2.5 mr-0.5" />
                    {promo.name}
                  </Badge>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => sendMut.mutate(product.id)}
              disabled={sendMut.isPending}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-medium leading-snug text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              <Send className="size-3" />
              ส่งให้ลูกค้า
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8:** `cd apps/web && npx tsc --noEmit` → 0; `cd apps/api && npx jest src/modules/staff-chat` → เขียวหมด
- [ ] **Step 9:** Commit: `fix(inbox): ProductContextCard ใช้ gallery + จำนวนเครื่องจริง + ค่างวดจริง (เดิมโหลด base64 และป้ายดาวน์ผิดหน่วย)`

---

### Task 11: Mock AI gate + ลบ dead injection

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts:36-39` (gate) และ `:262-266` (prefix ที่ `return` ของ `getMockSuggestions`)
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts:5` (import `AiSuggestService`) และ `:24` (`private aiSuggest: AiSuggestService,`)
- Create: `apps/api/src/modules/staff-chat/services/ai-suggest.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService.get<string>('ANTHROPIC_API_KEY' | 'NODE_ENV')`
- Produces: `suggest(roomId, currentDraft?): Promise<AiSuggestResponse>` — บน production ที่ไม่มี API key คืน `{ suggestions: [], ... }`; นอก production คืน mock ที่ทุกข้อความขึ้นต้น `'[MOCK] '`

**เหตุผล:** `getMockSuggestions` มีราคา/โปรปลอมฝังไว้ (`29,900 บาท`, `ผ่อน 0% 6 งวด`) แล้วแอดมินกด "ส่ง" ได้ทันที — ถ้าหลุดขึ้น prod = ตอบราคาผิดให้ลูกค้า (`NODE_ENV=production` ตั้งจริงทั้ง `Dockerfile:52` + `deploy-gcp.yml:340`)

- [ ] **Step 1:** เขียน failing spec `ai-suggest.service.spec.ts`:

```ts
import { AiSuggestService } from './ai-suggest.service';

function makeService(env: { apiKey?: string; nodeEnv?: string }) {
  const config = {
    get: jest.fn((key: string) =>
      key === 'ANTHROPIC_API_KEY' ? env.apiKey : key === 'NODE_ENV' ? env.nodeEnv : undefined,
    ),
  };
  const prisma = {
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([{ role: 'CUSTOMER', text: 'ราคาเท่าไหร่ครับ' }]),
    },
  };
  return new AiSuggestService(
    config as any,
    prisma as any,
    { detectProducts: jest.fn().mockResolvedValue([]) } as any,
    { getFewShotExamples: jest.fn().mockResolvedValue([]) } as any,
    { getBase: jest.fn().mockResolvedValue('persona') } as any,
    { record: jest.fn() } as any,
  );
}

describe('AiSuggestService.suggest — mock gate', () => {
  it('production + ไม่มี API key → ไม่คืนข้อความ mock เลย (กันราคาปลอมถึงลูกค้า)', async () => {
    const svc = makeService({ nodeEnv: 'production' });
    const res = await svc.suggest('r1');
    expect(res.suggestions).toEqual([]);
    expect(res.detectedProducts).toEqual([]);
  });

  it('dev + ไม่มี API key → คืน mock ที่ติดป้าย [MOCK] ทุกข้อความ', async () => {
    const svc = makeService({ nodeEnv: 'development' });
    const res = await svc.suggest('r1');
    expect(res.suggestions.length).toBeGreaterThan(0);
    expect(res.suggestions.every((s) => s.text.startsWith('[MOCK] '))).toBe(true);
  });
});
```

- [ ] **Step 2:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/ai-suggest.service.spec.ts` → fail
- [ ] **Step 3:** แก้ gate ที่ `ai-suggest.service.ts:36-39`:

```ts
    if (!this.anthropic) {
      // Mock mode มีราคา/โปรที่แต่งขึ้น แล้วแอดมินกดส่งได้ทันที — ห้ามหลุดขึ้น prod
      if (this.config.get<string>('NODE_ENV') === 'production') {
        this.logger.warn(
          'AI suggest ปิดอยู่บน production (ไม่มี ANTHROPIC_API_KEY) — ไม่คืนข้อความ mock',
        );
        return { suggestions: [], detectedProducts: [], processingTimeMs: Date.now() - start };
      }
      return this.getMockSuggestions(roomId);
    }
```

- [ ] **Step 4:** ติดป้าย `[MOCK] ` ที่ return ของ `getMockSuggestions` (:262-266):

```ts
    return {
      // ป้าย [MOCK] ทำให้แอดมินเห็นทันทีว่าตัวเลขในข้อความนี้ไม่ใช่ของจริง
      suggestions: suggestions.map((s) => ({ ...s, text: `[MOCK] ${s.text}` })),
      detectedProducts: ['iPhone 16 Pro'],
      processingTimeMs: Date.now() - start,
    };
```

- [ ] **Step 5:** ลบ dead injection ใน `ai-auto-reply.service.ts` — ลบบรรทัด 5 (`import { AiSuggestService } ...`) และบรรทัด 24 (`private aiSuggest: AiSuggestService,`) — ยืนยันก่อนลบด้วย `grep -n "this.aiSuggest" apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` → ต้องไม่มีผลลัพธ์
- [ ] **Step 6:** รัน `cd apps/api && npx jest src/modules/staff-chat/services/ai-suggest.service.spec.ts src/modules/staff-chat/services/ai-auto-reply.service.spec.ts` → เขียวทั้งคู่ (spec ของ auto-reply ยังมี provider `AiSuggestService` เกินไว้ได้ — Nest ยอมให้มี provider ที่ไม่ถูกใช้)
- [ ] **Step 7:** `cd apps/api && npx tsc --noEmit` → 0; Commit: `fix(inbox): ปิดข้อความ AI mock บน production + ลบ dead injection AiSuggestService`

---

### Task 12: ปิด batch — ตรวจทั้งระบบ + QA บนเบราว์เซอร์

**Files:** ไม่มีไฟล์ใหม่ (verification only)

- [ ] **Step 1:** `cd apps/api && npx jest src/modules/chat-engine src/modules/staff-chat` → เขียวทั้งหมด (ไม่มี suite ไหนแดง)
- [ ] **Step 2:** `cd apps/api && npx tsc --noEmit` → 0 error; `cd apps/api && npx eslint .` → 0 error
- [ ] **Step 3:** `cd apps/web && npx vitest run src/pages/UnifiedInboxPage` → เขียวทั้งหมด
- [ ] **Step 4:** `cd apps/web && npx tsc --noEmit` → 0 error; `cd apps/web && npx eslint .` → 0 error
- [ ] **Step 5:** ยืนยัน red line ด้วยสายตา: `git diff --stat main...HEAD` ต้อง **ไม่มี** ไฟล์ใต้ `apps/api/src/modules/journal/`, `apps/api/src/modules/accounting/`, `apps/api/src/modules/payments/`, `apps/api/prisma/migrations/`
- [ ] **Step 6:** ยืนยันว่าไม่มี `photos` หลุดกลับเข้ามาในเส้นทางแชท: `grep -rn "photos" apps/api/src/modules/staff-chat/ apps/api/src/modules/chat-engine/` → ต้องไม่มีผลลัพธ์ที่เป็น Prisma `select`
- [ ] **Step 7:** QA local — `npm run dev` แล้ว login `admin@bestchoice.com / admin1234` เปิด `/inbox` (Unified Inbox) แล้วไล่ตามเช็กลิสต์ใน "Deployment & Verification" ข้อ QA ทั้ง 8 ข้อ
- [ ] **Step 8:** Commit ปิดท้าย (ถ้ามีแก้จาก QA): `chore(inbox): ปิด batch B2 — tsc/eslint/jest/vitest เขียวครบ`

---

## Deployment & Verification

### ลำดับ deploy
1. **ไม่มี migration** ใน batch นี้ → deploy ตามปกติของเรโป (push เข้า `main` → GitHub Actions → Cloud Run + Firebase Hosting); ไม่ต้องรัน `prisma migrate deploy` ก่อน/หลังเป็นพิเศษ
2. Merge หลัง CI gate เขียว + code-owner review 1 คน (owner กดเอง — agent ห้าม `--admin` merge เว้นแต่ผู้ใช้พิมพ์อนุญาต bypass เป็นประโยคชัดเจน)
3. Deploy ครั้งเดียวจบทั้ง api + web (frontend เรียก endpoint ใหม่ `GET /staff-chat/products/:id/summary` → **ต้อง deploy api ก่อนหรือพร้อมกัน** ห้าม deploy web อย่างเดียว)

### ops step ที่ต้องเช็กก่อนถือว่าใช้งานได้จริง
| สิ่งที่ต้องมี | เช็กยังไง | ถ้าไม่มีจะเป็นอะไร |
|---|---|---|
| `SHOP_BASE_URL` ตั้งบน Cloud Run | `gcloud run services describe <api> --format='value(spec.template.spec.containers[0].env)'` | ลิงก์ในการ์ดสินค้าหายไปเฉยๆ (ไม่ crash — `shopBaseUrl()` คืน null) |
| Storage ตั้งค่าแล้ว (`GCS_BUCKET` prod / `S3_*` local) | `GET /health` ดู probe S3/GCS | รูปจาก composer จะส่งเป็น storage key ดิบ → LINE/FB ปฏิเสธ |
| `FACEBOOK_APP_ID` ตั้งไว้ | ดู env ของ Cloud Run | echo ของรูปที่เราส่งอาจเด้งกลับเป็น bubble ซ้ำ (Task 2 ลด แต่ไม่ลบความเสี่ยง 100%) |

### สิ่งที่ owner ต้องทำ (ไม่ใช่โค้ด)
1. **กรอกรูปขึ้นเว็บ (`gallery`) ให้เครื่องที่ขายจริง** — ปุ่ม "ส่งรูป" จะ disabled ทุกเครื่องที่ยังไม่มี gallery (รูป 6 มุมใน `photos[]` ใช้ส่งลูกค้าไม่ได้ เพราะเป็น base64)
2. **กรอก `cashPrice`/`installmentPrice` รายเครื่อง** (ฟอร์มจาก B1) — ถ้าไม่มี การ์ดจะขึ้น "สอบถามราคากับแอดมินได้เลยค่ะ" แทนตัวเลข
3. **ตรวจ InterestConfig ของแต่ละหมวด** ว่ามี rate ครบทุกจำนวนงวดที่ขายจริง — ตัวเลขค่างวดในแชทเลือก "งวดยาวสุดในตาราง" เสมอ

### verify บน prod (หลัง deploy)
- [ ] `curl -s https://<api>/api/health` → 200
- [ ] Login admin จริง → เปิด Unified Inbox → กดปุ่มรูปมือถือในกล่องพิมพ์ → ค้นรุ่นที่มีสต็อก → เห็นราคา + ค่างวด (ไม่ใช่ `-`)
- [ ] ส่งการ์ดเข้าห้อง LINE ทดสอบ 1 ห้อง → ลูกค้า (เครื่องทดสอบ) ต้องได้ **2 ข้อความ**: รูป แล้วตามด้วยข้อความ
- [ ] กด "ส่งการ์ด" ซ้ำอีกครั้งบนเครื่องเดิม → ต้องได้ข้อความใหม่ (token ใหม่) — แต่ถ้า network timeout แล้ว browser retry request เดิม ต้อง **ไม่** เกิด bubble ซ้ำ
- [ ] เช็ก log Cloud Run ว่าไม่มี `no message content` / `Storage not configured`

### QA เบราว์เซอร์ (local เท่านั้น — prod ปฏิเสธ seed accounts)
1. อัปโหลดรูป jpg จาก composer → toast **"ส่งรูปให้ลูกค้าแล้ว"** + bubble ขวามือเป็น STAFF (ไม่ใช่ป้าย "Bot")
2. อัปโหลด pdf → toast **"แนบไฟล์ในห้องแล้ว — ลูกค้ายังไม่ได้รับ..."** + bubble เป็นการ์ดไฟล์
3. Product picker: พิมพ์ 1 ตัวอักษร → ขึ้น "พิมพ์อย่างน้อย 2 ตัวอักษร"; พิมพ์ 2+ → มีผลลัพธ์
4. เลือกเครื่องที่ **ไม่มี** gallery → เห็นป้าย "ยังไม่มีรูปขึ้นเว็บ" + ปุ่ม "ส่งรูป" เทา; กด "ส่งการ์ด" → toast warning + มีแค่ bubble ข้อความ
5. "แทรกสรุปในกล่องพิมพ์" → ข้อความลงที่ตำแหน่ง caret ไม่ใช่ต่อท้ายเสมอ
6. SessionActions → "สร้างสัญญา" → เลือกเครื่อง → URL เป็น `/contracts/create?customerId=...&productId=...` และ wizard เลือกเครื่องนั้นไว้ให้แล้ว
7. ProductContextCard: กดรูป/ชื่อ → ไป `/products/:id` ของแอดมิน; ปุ่ม "ส่งให้ลูกค้า" ส่งได้; badge จำนวนเครื่องต้องตรงกับสต็อกจริง
8. เปิด DevTools → Network → `GET /staff-chat/rooms/:id/products` และ `GET /staff-chat/products/search` payload ต้อง **ไม่เกิน ~50KB** (ถ้าเป็น MB แปลว่า base64 หลุดกลับมา)

### Rollback
Revert commit เดียว (ไม่มี migration, ไม่มี schema change) → พฤติกรรมกลับไปเป็นเดิมทันที ยกเว้นข้อความ/รูปที่ส่งออกไปแล้ว (irreversible ตามธรรมชาติของแชท)

---

## สิ่งที่ batch นี้ไม่ทำ (อ้าง scope ที่ spec ตัด/มอบให้ batch อื่น)

| ไม่ทำ | เหตุผล |
|---|---|
| `ChatRoom.attachedProductId` + ตัวแปรสินค้าใน canned responses | spec §1 + §4 ตัดออกแล้ว — ปุ่ม "แทรกสรุป" ให้ผลเดียวกันโดยไม่มี schema/สถานะค้าง; ถ้าเพิ่มภายหลังต้อง register ทั้ง variable service **และ** `VARIABLE_KEYS` ของ `canned-response-sender.service.ts:130-140` |
| Migration ใดๆ | ไม่จำเป็น — `ChatMessage` มีคอลัมน์ครบตั้งแต่ `20260976`; B0 ถือเลข `20260982000000` |
| Readiness badge / endpoint `GET /products/:id/readiness` | ⚠️ spec §4 เขียนว่า search select ควรมี `readiness` ด้วย — B2 **ไม่** ใส่ เพราะ endpoint/util readiness เป็นของ B0 §2.3 + B1 §3 และ picker ของแอดมินต้องเห็นสต็อกทั้งหมด (ไม่ใช่เฉพาะที่ขึ้นเว็บได้); B2 คืนข้อเท็จจริงดิบแทน (`photoUrl` null = ยังไม่มีรูปขึ้นเว็บ, `cashPrice` null = ยังไม่กรอกราคา). ถ้าต้องการ badge readiness จริง ให้ทำเป็น follow-up หลัง B0 merge |
| Detection คำไทย/ความจุ/สี (`device-query-normalize.util.ts`) | ⚠️ **เบี่ยงจาก spec โดยตั้งใจ — ต้องให้ owner เคาะ**: spec §2.4 ระบุ "ผู้ใช้: … inbox detect (B2)" และ §4 ระบุ "detection ใช้ util B0" แต่ §5 (B3) ก็ระบุ "แก้ `ProductDetectService` เลิกคิดค่างวดเอง → util เดียวกัน" = เจ้าของทับกัน. B2 เลือกแก้เฉพาะ payload/ตัวเลขที่ผิด (gallery/stock/ค่างวด) และ **ไม่แตะ `extractKeywords` (:63-80)** เพื่อไม่ให้ชนกับ B3 ที่จะ re-point ทั้งไฟล์อยู่แล้ว. ถ้า owner ต้องการให้ B2 ทำ ให้เพิ่ม Task 10.5 = สลับ `extractKeywords` → util B0 + spec เทียบผลลัพธ์เดิม |
| Share endpoint `GET /api/shop/share/:id` + OG/JSON-LD | เป็นของ B4 §6 — B2 ใช้ `${SHOP_BASE_URL}/products/:id` ตรงๆ ไปก่อน (spec §4 ระบุชัด) |
| ส่งรูป/ลิงก์จาก **บอท** (`SalesBotResult.attachments`) | เป็นของ B3 §5 — B2 สร้าง primitive ให้ B3 มาใช้ต่อเท่านั้น |
| ซ่อน `costPrice` จาก SALES ฝั่ง server | เป็นของ B1 §3; `searchProducts`/`getProductSummary` ของ B2 **ไม่ select `costPrice` เลย** อยู่แล้ว จึงไม่มี leak ใหม่ |
| ส่งไฟล์ PDF/DOC ถึงลูกค้าจริง | LINE ไม่มี file bubble; ส่งเป็นลิงก์ signed URL = เปิดเอกสารภายในให้คนนอกโดยไม่ตั้งใจ — เก็บเป็นงานแยกที่ต้องมี owner decision |
| แก้ `createPaymentLinkInChat` ให้ส่งถึงลูกค้า (`chat-commerce.service.ts:150-155` ก็ `saveMessage` เฉยๆ เหมือนกัน) | **บั๊กพี่น้องกันที่ยืนยันแล้วแต่จงใจไม่แก้ใน batch นี้** — เป็นข้อความยอดเงิน การเปลี่ยนให้ส่งอัตโนมัติเป็น behavior change ที่แอดมินอาจไม่คาด ต้องให้ owner เคาะก่อน (บันทึกไว้เป็น follow-up) |
| ปิด `[DEMO]` ออกจากผลค้นของแอดมิน | admin picker เห็นสต็อกทั้งหมดเหมือนหน้า /stock เดิม; การกรอง `[DEMO]` เป็นกติกาฝั่งลูกค้า (B0 readiness util) — owner ล้างด้วย `CLEAN=1 bash scripts/seed-demo-products-prod.sh` ก่อน launch |
