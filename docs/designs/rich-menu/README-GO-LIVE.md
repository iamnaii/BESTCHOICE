# Rich Menu Go-Live Kit — 1×3 Chromatic Shrine

ไฟล์ครบชุดสำหรับอัปโหลด rich menu ใหม่ 3 ช่อง (`ชวนเพื่อน` · `ชำระค่างวด` · `ติดต่อเรา`)
ขึ้น LINE OA ของ BESTCHOICE FINANCE

## ไฟล์ในชุด

| ไฟล์ | คืออะไร |
|---|---|
| `bestchoice-finance-rich-menu-3.png` | รูป rich menu ขนาด **2500×843** (half-height 1×3) |
| `rich-menu-config-3.json` | พิกัดปุ่ม + action ของ 3 ช่อง (LIFF ID เป็น placeholder) |
| `upload-3.sh` | script อัปโหลดครบวงจร — create → image → set default |
| `generate-3.py` | เครื่องกำเนิดรูป ถ้าต้องปรับข้อความ/สีค่อย run ใหม่ |

## ข้อมูลที่ต้องเตรียม 2 ตัว

1. **`LINE_FINANCE_CHANNEL_TOKEN`** — Channel Access Token ของ BESTCHOICE FINANCE OA
   - หาจาก: `/settings/integrations` → LINE Finance → Channel Access Token
   - หรือจาก LINE Developers Console → Provider → FINANCE channel → Messaging API
2. **`FINANCE_LIFF_ID`** — LIFF ID ของ FINANCE (รูปแบบ `2000000000-abcdefgh`)
   - หาจาก: `/settings/line-oa` (admin) — ช่อง LIFF ID

## วิธีอัปโหลด

### ทางที่ 1 — script ครบวงจร (แนะนำ)

```bash
export LINE_FINANCE_CHANNEL_TOKEN="..."
export FINANCE_LIFF_ID="2000000000-abcdefgh"

bash docs/designs/rich-menu/upload-3.sh
```

script จะทำ 3 ขั้นตอน: create rich menu → upload image → set as default for all followers

### ทางที่ 2 — ผ่าน admin UI `/rich-menu`

1. Login เป็น OWNER → ไปหน้า `/rich-menu`
2. Upload image: `docs/designs/rich-menu/bestchoice-finance-rich-menu-3.png`
3. Layout: **1×3**
4. ปุ่มทั้ง 3:
   - **ช่อง 1** — ชวนเพื่อน: `message` → `ขอลิงก์ชวนเพื่อน`
   - **ช่อง 2** — ชำระค่างวด: `uri` → `https://liff.line.me/<FINANCE_LIFF_ID>/liff/contract`
   - **ช่อง 3** — ติดต่อเรา: `message` → `สวัสดีค่ะ อยากสอบถามเกี่ยวกับสัญญาผ่อนชำระ`
5. Deploy + Set as default

## คำสั่งตรวจสอบ

ดู rich menu ทั้งหมดบน LINE:
```bash
curl -H "Authorization: Bearer $LINE_FINANCE_CHANNEL_TOKEN" \
  https://api.line.me/v2/bot/richmenu/list
```

ลบ default (revert ให้ไม่มีเมนู):
```bash
curl -X DELETE https://api.line.me/v2/bot/user/all/richmenu \
  -H "Authorization: Bearer $LINE_FINANCE_CHANNEL_TOKEN"
```

## ถ้าอยากแก้ข้อความ/สี

1. แก้ `generate-3.py` (CHAMBERS array)
2. Regenerate: `python3 docs/designs/rich-menu/generate-3.py`
3. อัปโหลดใหม่ด้วย `upload-3.sh`
