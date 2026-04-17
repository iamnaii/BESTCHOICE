# Rich Menu Alias: Multi-Channel Management (SHOP + FINANCE)

**Date:** 2026-04-17
**Status:** Design — approved, ready for implementation plan
**Scope:** Standard (Option B from brainstorm)
**Related:** [line-experience-upgrade plan](../plans/2026-04-16-line-experience-upgrade.md)

## 1. Problem Statement

BESTCHOICE ใช้ LINE OA แยก 2 ช่อง: `line-shop` (ลูกค้า) และ `line-finance` (น้องเบส — การเงิน) ผู้ใช้ต้องการจัดการ Rich Menu ของทั้ง 2 channel พร้อม alias system เพื่อรองรับการสลับเมนูตามสถานะ verified ของลูกค้า

ปัจจุบัน:
- หน้า [/settings/rich-menu](../../../apps/web/src/pages/RichMenuPage.tsx) จัดการเมนูได้แค่ SHOP channel — ไม่มี channel selector
- [`RichMenuService`](../../../apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts) ใช้ `getShopChannelToken()` ตายตัว — สร้างเมนูฝั่ง FINANCE ไม่ได้
- `switchRichMenu(userId, isVerified, channel)` ([rich-menu.service.ts:477](../../../apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts#L477)) มีอยู่แล้วแต่ทำงานผิด — เรียก `linkRichMenuToUser()` ซึ่ง hardcoded ใช้ SHOP token
- 4 alias keys (`line.richMenu.shopDefault`, `shopVerified`, `financeDefault`, `financeVerified`) เป็นเพียง concept — ไม่มี UI ให้เซ็ต, ต้องเข้า SQL ตรงๆ
- `line-finance` integration ไม่มี `liffId` field (มีแต่ใน `line-shop`)

## 2. Goals

- จัดการ Rich Menu ของ SHOP + FINANCE แยกกันผ่าน UI เดียว
- เซ็ต alias (`default` / `verified` per channel) ผ่าน UI ได้
- Backend รองรับทั้ง 2 channel token ผ่าน param ไม่ต้อง hardcode
- ไม่แตะ `switchRichMenu()` caller (liff-api, line-oa-chatbot) — ให้ทำงานได้ทันทีหลัง alias ถูกเซ็ต

## 3. Non-Goals

- ไม่ย้ายเมนูเก่าที่สร้างไว้ — ผู้ใช้เลือกย้ายเอง (หรือลบแล้วสร้างใหม่)
- ไม่แก้ logic ใน LIFF controllers ที่เรียก `switchRichMenu` — ถ้า caller มี bug ทำในแผนแยก
- ไม่ทำ per-user assignment UI (manual link เมนูให้ user คนเดียว) — ใช้แค่ alias-based switching
- ไม่ทำ dunning/overdue state (เช่น `financeOverdue` alias) — ถ้าต้องการ เพิ่มภายหลัง

## 4. Architecture

### 4.1 Channel resolution

Backend มี helper เดียวที่ route token ตาม channel:

```ts
// rich-menu.service.ts
private async getChannelToken(channel: 'shop' | 'finance'): Promise<string> {
  const key = channel === 'shop' ? 'line-shop' : 'line-finance';
  const token = await this.integrationConfig.getValue(key, 'channelToken');
  if (!token) {
    throw new BadRequestException(`LINE ${channel} channel token not configured`);
  }
  return token;
}

/** @deprecated — delegate to getChannelToken('shop') */
private async getShopChannelToken(): Promise<string> {
  return this.getChannelToken('shop');
}
```

ทุก method ที่เคยเรียก `getShopChannelToken()` เปลี่ยนเป็นรับ `channel: 'shop' | 'finance'` และเรียก `getChannelToken(channel)` แทน

### 4.2 SystemConfig alias keys

คง keys เดิม (ตรงกับที่ `switchRichMenu` อ่านอยู่):

| Key | ใช้เมื่อ |
|---|---|
| `line.richMenu.shopDefault` | ลูกค้า add SHOP OA ยังไม่ verify |
| `line.richMenu.shopVerified` | ลูกค้า verify แล้ว (มีสัญญา active) |
| `line.richMenu.financeDefault` | ลูกค้า add FINANCE OA ยังไม่ verify |
| `line.richMenu.financeVerified` | ลูกค้า verify แล้วใน FINANCE |

### 4.3 Data flow

```
ลูกค้า add SHOP OA
  → LINE auto-uses default (ตั้งผ่าน setDefaultRichMenu)
  → ปกติจะตรงกับ shopDefault alias
  
ลูกค้า verify ผ่าน LIFF contract:
  liff-api.controller.ts → richMenuService.switchRichMenu(userId, true, 'shop')
  → อ่าน SystemConfig "line.richMenu.shopVerified"
  → linkRichMenuToUser(userId, richMenuId, 'shop')  ← ใช้ SHOP token
  → LINE แสดง shopVerified menu
```

## 5. Backend Changes

### 5.1 `RichMenuService` method signatures

ทุก method ที่ทำ LINE API call เพิ่ม `channel` param (default `'shop'` เพื่อ back-compat ถ้า caller ยังไม่ส่ง):

```ts
createCustomRichMenu(params: CreateMenuParams, channel: 'shop' | 'finance' = 'shop')
uploadRichMenuImage(richMenuId: string, imageBuffer: Buffer, channel: 'shop' | 'finance' = 'shop')
setDefaultRichMenu(richMenuId: string, channel: 'shop' | 'finance' = 'shop')
deleteRichMenu(richMenuId: string, channel: 'shop' | 'finance' = 'shop')
listRichMenus(channel: 'shop' | 'finance' = 'shop')
getDefaultRichMenuId(channel: 'shop' | 'finance' = 'shop')
linkRichMenuToUser(userId: string, richMenuId: string, channel: 'shop' | 'finance' = 'shop')
unlinkRichMenuFromUser(userId: string, channel: 'shop' | 'finance' = 'shop')
```

`switchRichMenu` ปรับให้ส่ง channel ต่อไปยัง `linkRichMenuToUser`:

```ts
async switchRichMenu(userId: string, isVerified: boolean, channel: 'shop' | 'finance') {
  const key = `line.richMenu.${channel}${isVerified ? 'Verified' : 'Default'}`;
  const richMenuId = await this.getRichMenuIdFromConfig(key);
  if (!richMenuId) {
    this.logger.warn(`Rich Menu alias not set for ${key}`);
    return;
  }
  await this.linkRichMenuToUser(userId, richMenuId, channel); // ← pass channel
}
```

### 5.2 New method: `setRichMenuAlias`

```ts
async setRichMenuAlias(
  channel: 'shop' | 'finance',
  variant: 'default' | 'verified',
  richMenuId: string,
): Promise<void>
```

- Writes SystemConfig: key = `line.richMenu.{channel}{Variant}`, value = richMenuId
- Uses `upsert` (soft-deleted config ถูก restore หรือสร้างใหม่)
- เมื่อ `variant === 'default'` → เรียก `setDefaultRichMenu(richMenuId, channel)` ด้วยเสมอ (LINE's default-for-all-users = ตรงกับความหมาย "Default" ของเรา สำหรับลูกค้าที่เพิ่ง add friend)
- เมื่อ `variant === 'verified'` → เขียนเฉพาะ SystemConfig (ไม่แตะ LINE default)

### 5.3 New method: `getRichMenuAliases`

```ts
async getRichMenuAliases(): Promise<{
  shopDefault: string | null;
  shopVerified: string | null;
  financeDefault: string | null;
  financeVerified: string | null;
}>
```

- อ่าน SystemConfig 4 keys คืนค่า richMenuId หรือ null

### 5.4 Controller endpoints

เดิม ([line-oa-chatbot.controller.ts](../../../apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts) หรือ controller เฉพาะ rich-menu):

| Method | Path | Changes |
|---|---|---|
| GET | `/line-oa/rich-menu/list` | เพิ่ม `?channel=shop\|finance` (default `shop`) |
| POST | `/line-oa/rich-menu/create-default` | body เพิ่ม field `channel` |
| POST | `/line-oa/rich-menu/create-with-image` | form field เพิ่ม `channel` ใน JSON config |
| POST | `/line-oa/rich-menu/:id/set-default` | เพิ่ม `?channel=...` |
| POST | `/line-oa/rich-menu/:id/upload-image` | เพิ่ม `?channel=...` |
| DELETE | `/line-oa/rich-menu/:id` | เพิ่ม `?channel=...` |

ใหม่:

| Method | Path | Body/Params |
|---|---|---|
| POST | `/line-oa/rich-menu/:id/set-alias` | body: `{channel: 'shop'\|'finance', variant: 'default'\|'verified'}` |
| GET | `/line-oa/rich-menu/aliases` | returns all 4 aliases |

Validation:
- `channel` ต้องเป็น `'shop'` หรือ `'finance'` — throw `BadRequestException` ถ้าไม่ใช่
- Use class-validator DTO: `SetAliasDto { @IsIn(['shop','finance']) channel; @IsIn(['default','verified']) variant }`

### 5.5 Integration registry

เพิ่ม `liffId` field ใน `line-finance` integration ([integration-registry.ts:64](../../../apps/api/src/modules/integrations/integration-registry.ts#L64)):

```ts
{
  key: 'line-finance',
  // ... existing fields
  fields: [
    { key: 'channelToken', ... },
    { key: 'channelSecret', ... },
    { key: 'liffId', label: 'LIFF ID', sensitive: false, required: false,
      envVar: 'VITE_LIFF_ID_FINANCE' },  // ← NEW
  ],
}
```

## 6. Frontend Changes

### 6.1 New state + channel resolution ([RichMenuPage.tsx](../../../apps/web/src/pages/RichMenuPage.tsx))

```ts
const [channel, setChannel] = useState<'shop' | 'finance'>('shop');
const [activeSubTab, setActiveSubTab] = useState<'create' | 'list'>('create');
```

### 6.2 UI structure

```tsx
<PageHeader title="Rich Menu" subtitle="..." icon={<LayoutGrid />} />

<Tabs value={channel} onValueChange={(v) => setChannel(v as 'shop' | 'finance')}>
  <TabsList>
    <TabsTrigger value="shop">🛍 SHOP</TabsTrigger>
    <TabsTrigger value="finance">💰 FINANCE</TabsTrigger>
  </TabsList>
</Tabs>

<div className="flex gap-1 mb-6 border-b">
  {/* existing create/list sub-tabs */}
</div>

{/* existing content, scoped to {channel} */}
```

### 6.3 Queries keyed by channel

```ts
useQuery({
  queryKey: ['rich-menu-list', channel],
  queryFn: () => api.get(`/line-oa/rich-menu/list?channel=${channel}`).then(r => r.data),
});

useQuery({
  queryKey: ['rich-menu-aliases'],
  queryFn: () => api.get('/line-oa/rich-menu/aliases').then(r => r.data),
});
```

LIFF URL source:
- SHOP → `useQuery(['line-oa-settings'])` เดิม → `settings.liff_id`
- FINANCE → new query `useQuery(['chatbot-finance-settings'])` → `settings.liffId`
- `defaultLiffUrl = channel === 'shop' ? shopLiff : financeLiff`

### 6.4 Mutations เพิ่ม channel

```ts
createMutation: api.post('/line-oa/rich-menu/create-default', { ..., channel })
setDefaultMutation: api.post(`/line-oa/rich-menu/${id}/set-default?channel=${channel}`)
deleteMutation: api.delete(`/line-oa/rich-menu/${id}?channel=${channel}`)
// etc.
```

หลัง mutation invalidate `['rich-menu-list', channel]` และ `['rich-menu-aliases']`

### 6.5 Alias UI ใน list tab

แทนที่ปุ่ม "ตั้งเป็น Default" เดิม:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button size="sm" variant="outline">
      <Star /> ตั้งเป็น...
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => setAlias('default')}>
      Default (ลูกค้าใหม่)
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setAlias('verified')}>
      Verified (ลูกค้าที่ verify แล้ว)
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Badges ใน menu card:
- ถ้า `menu.richMenuId === aliases[`${channel}Default`]` → `<Badge>⭐ Default</Badge>`
- ถ้า `menu.richMenuId === aliases[`${channel}Verified`]` → `<Badge>✓ Verified</Badge>`
- เมนูเดียวสามารถเป็นทั้ง Default + Verified พร้อมกันได้ (แสดง 2 badges)

`setAlias` mutation:
```ts
api.post(`/line-oa/rich-menu/${id}/set-alias`, { channel, variant })
```

## 7. Testing Strategy

### 7.1 Unit tests (API)
- `rich-menu.service.spec.ts` (new file):
  - `getChannelToken('shop')` returns shop token
  - `getChannelToken('finance')` returns finance token
  - `getChannelToken('finance')` throws when finance not configured
  - `setRichMenuAlias('shop', 'default', 'id1')` writes correct SystemConfig key
  - `getRichMenuAliases()` returns all 4 keys (null if not set)
  - `switchRichMenu(userId, true, 'finance')` uses finance token (mock fetch, assert Authorization header)

### 7.2 Integration test
- Create menu with `channel=finance` → mock LINE API → assert it called FINANCE endpoint with FINANCE token
- Set alias → verify SystemConfig record created

### 7.3 Manual QA checklist
1. Configure `line-finance.channelToken` ใน [/settings/integrations](/settings/integrations)
2. เพิ่ม `line-finance.liffId`
3. เข้า [/settings/rich-menu](/settings/rich-menu) → สลับ tab FINANCE → create menu → ตรวจว่าเมนูปรากฏใน LINE Developers Console ของ FINANCE channel (ไม่ใช่ SHOP)
4. Set alias Default บน menu → ลูกค้า add LINE FINANCE → เห็นเมนูนี้
5. Trigger verify flow ใน LIFF → ตรวจว่า richMenuId ที่ link ให้ user เปลี่ยนเป็น Verified menu

## 8. Migration & Rollout

- ไม่ต้อง DB migration (SystemConfig table มีอยู่แล้ว, soft-delete model)
- Existing menus ที่สร้างก่อนหน้า → อยู่ใน SHOP channel ต่อไป (ไม่มี channel field ใน LINE API, เมนูถูกสร้างใน channel ของ token ที่ใช้ขณะนั้น — คือ SHOP)
- ไม่มี breaking change บน API (default `channel='shop'` ถ้า caller ไม่ส่ง)
- Rollout: deploy backend ก่อน → deploy frontend → ทำ manual QA ตาม checklist ใน §7.3

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| FINANCE channel token ยังไม่ถูก config → สร้างเมนู error | Validate ใน `getChannelToken`, error message ภาษาไทย + toast ไปที่ /settings/integrations |
| Alias คือ richMenuId ที่ถูก delete แล้ว → `switchRichMenu` link เมนูที่ไม่มีอยู่ | Delete endpoint ตรวจว่าเมนูนี้เป็น alias อยู่ไหม → ถ้าเป็น ต้องยืนยัน |
| 2 channels ใช้ liff_id คนละตัวแต่ UI เดิมอ่านแค่ `line-oa/settings` | เพิ่ม query `chatbot-finance/settings` เลือก liff URL ตาม channel tab |
| User create menu ใน tab SHOP แต่กดสลับไป FINANCE ก่อน save → ส่ง channel ผิด | Snapshot `channel` เข้า mutation closure หรือ disable tab switch ขณะ pending |

## 10. Open Questions

None at this stage — all decisions made during brainstorm. Revisit if QA reveals issues with `switchRichMenu` caller behavior (out of scope per §3).
