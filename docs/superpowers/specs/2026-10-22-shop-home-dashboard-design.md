# หน้าหลักหน้าร้าน (Shop Home) — Design

วันที่: 2026-10-22 · สถานะ: เจ้าของเคาะ mockup แล้ว (design canvas `AeXB44haXjLfvXYm5kjUeR`, 3 บอร์ด: เจ้าของ / SALES / มือถือ)
ที่มา: ก้อน 1 ของแผนปิดช่องว่าง Tooltify (ข้อ A13 เตือนสินค้าใกล้หมด · A12 สินค้าค้างสต๊อกนาน · A14 กราฟยอดขาย/ต้นทุน/กำไรขั้นต้น 6 เดือน + หมวดขายดี)

## 1. เจตนา

เมื่อสวิตช์โซนบนเมนูอยู่ที่ **หน้าร้าน (shop)** หน้า `/` ต้องเป็น "หน้าหลักหน้าร้าน" ที่เปิดมาตอนเช้าแล้วเห็นทันทีว่า วันนี้ขายได้เท่าไร ลิ้นชักอยู่ในสถานะไหน มีงานค้างอะไรต้องไปทำ และร้านทำกำไรขั้นต้นเท่าไรในรอบ 6 เดือน โดยไม่ต้องไล่เปิด 6 หน้า
ทุกวันนี้หน้า `/` ของ OWNER/BM/FM/ACC คือ `ManagementDashboard` ซึ่งเป็นของฝั่งการเงินทั้งหน้า ส่วน SALES ได้ `StaffHome` (งานของฉันวันนี้ + ปุ่มลัด) ไม่มีใครเห็นภาพหน้าร้านรวม

## 2. เป้าหมาย / ไม่ทำ / ห้ามพัง

**เป้าหมาย**
- หน้าเดียว โหลดครั้งเดียว (endpoint เดียว) ตอบ 5 คำถาม: วันนี้ขายเท่าไร · ลิ้นชักปิดยอดหรือยัง · มีอะไรต้องดูวันนี้ · 6 เดือนที่ผ่านมากำไรขั้นต้นเป็นยังไง · อะไรขายดี / อะไรค้าง
- ทุกตัวเลขกดไปหน้ารายการที่กรองไว้แล้วได้
- SALES ใช้หน้าเดียวกันได้ โดย **server ไม่ส่งต้นทุน/กำไร** (กฎเจ้าของ 2026-08-04 §1.4 ใช้ `canSeeCost` แบบเดียวกับ PR #1723)

**ไม่ทำ (รอบนี้)**
- ไม่แตะ `ManagementDashboard` ฝั่งการเงิน และไม่ย้าย widget การเงินมา
- ไม่สร้างข้อมูลต้นทุนใหม่ ใช้ที่มีอยู่ (งบ SHOP รายเดือน / `costPrice` / snapshot ตอนขาย)
- ไม่ทำตั้งค่าเกณฑ์ใหม่ (จุดสั่งซื้อซ้ำ · 90 วัน) ใช้ค่าที่ระบบมี
- ไม่ทำ web push / PWA (เป็นก้อน 2)

**ห้ามพัง**
- SALES ต้องไม่ได้ค่า cost/margin ใน response แม้แต่ฟิลด์เดียว (เทสต์ระดับ controller)
- BM เห็นเฉพาะสาขาตัวเอง ตามกติกา branch ที่ endpoint อื่นใช้
- หน้าโหลดไม่ได้ (API ล้ม) ต้องขึ้น QueryBoundary แบบหน้าอื่น ไม่ใช่หน้าขาว
- แดชบอร์ดการเงินเดิมสำหรับโซน `fin` ต้องเหมือนเดิมทุกประการ

## 3. ใครเห็นอะไร

| โซนที่เลือก (`useLayout().workZone`) | OWNER / BM / FM / ACC | SALES |
|---|---|---|
| `shop` | ShopHome เต็ม | ShopHome แบบไม่มีต้นทุน + ตารางปุ่ม "เริ่มงาน" ใต้การ์ดวันนี้ + การ์ด "งานของฉันวันนี้" ท้ายหน้า (ทั้งสองย้ายมาจาก StaffHome ไม่หายไป) |
| `fin` | ManagementDashboard (เดิม) | ไม่มีโซนนี้ |

ใช้ `workZone` ไม่ใช่ `currentZone` เพื่อให้กดเฟืองตั้งค่าแล้วกลับมา `/` ยังได้หน้าเดิมที่ทำงานอยู่

## 4. โครงหน้า (ตาม mockup บนลงล่าง)

1. **หัวหน้า** ชื่อ "หน้าหลักหน้าร้าน" · ข้อความรอง = ชื่อสาขา · วันที่ไทย · "อัปเดต HH:MM" · ปุ่ม: ค้นหาลูกค้า/IMEI (เปิด CommandPalette) · รับของเข้า (`/purchase-orders`) · ขายสินค้า (`/pos`, primary)
2. **การ์ดวันนี้ 4 ใบ** (แถวเดียว ย่อเป็น 2 คอลัมน์บนมือถือ)
   - ยอดขายวันนี้: ยอดสุทธิ (บาท) · "N บิล · ขายสด a · ผ่อน b · ไฟแนนซ์นอก c" → `/sales`
   - เงินสดในลิ้นชัก: ยอดปัจจุบัน · สถานะ "ยังไม่ปิดยอดวันนี้ · ปิดยอดเมื่อวาน HH:MM" (สีเตือน) หรือ "ปิดยอดแล้ว HH:MM" → `/shop/daily-cash`
   - ใบจองหมดอายุวันนี้: จำนวนใบ · "มัดจำรวม X ฿ · จ่ายมัดจำแล้ว N ใบ · ควรตามลูกค้า" → `/bookings` (Booking มีแค่ `expireDate` ไม่มีวันนัดรับ จึงห้ามใช้คำว่า "นัดรับ")
   - หลังการขายรอลูกค้ารับ: จำนวนเคส · "เกินกำหนดนัด N เคส" (สีแดงถ้า > 0) → `/after-sales`
3. **สิ่งที่ต้องดูวันนี้** รายการแถวกดได้ แต่ละแถว = ชิปตัวเลข + คำกำกับความเร่งด่วน (ด่วน / รอ / แจ้ง) + ชื่อเรื่อง + รายละเอียดสั้น + ลูกศร แสดงเฉพาะแถวที่ count > 0 ถ้าไม่มีเลยขึ้น "ไม่มีงานค้าง วันนี้ว่าง"
   | เรื่อง | ความเร่งด่วน | รายละเอียด | ลิงก์ |
   |---|---|---|---|
   | สินค้าใกล้หมด | ด่วน | ชื่อ SKU สูงสุด 4 รายการ | `/stock/alerts` |
   | ค้างสต๊อกเกิน 90 วัน | ด่วน | "ทุนจม X ฿" (ซ่อนถ้า cost = null) | `/stock/products?sortBy=stockInDate&sortDirection=asc` (หน้ารายการยังไม่มีตัวกรองอายุ ใช้เรียงเก่าสุดก่อนแทน) |
   | รอ QC / รอถ่ายรูป | รอ | "รอ QC a · รอถ่ายรูป b" | `/purchase-orders/qc` |
   | โอนระหว่างสาขาค้างรับ | รอ | จำนวน | `/stock/transfers` |
   | เครื่องยึดคืนรอตีราคา | รอ | จำนวน | `/stock/products?view=all&status=REPOSSESSED` |
   | ใบสั่งซื้อรออนุมัติ | แจ้ง | เลข PO ล่าสุด | `/purchase-orders` (ไม่ส่งแถวนี้ให้ SALES เพราะ `/purchase-orders/summary` ไม่เปิดให้ SALES; ส่วนสินค้าใกล้หมดเปิดให้ทุกบทบาทโดยตั้งใจ) |
   ท้ายการ์ด: "รายการนี้มาจากเงื่อนไขที่ตั้งไว้ (จุดสั่งซื้อซ้ำ · 90 วัน · สถานะเครื่อง)"
4. **กราฟ 6 เดือน** หัว "ยอดขาย · ต้นทุน · กำไรขั้นต้น 6 เดือน" (SALES: "ยอดขาย 6 เดือน") · แถวตัวเลข: กำไรขั้นต้นเดือนนี้ + % margin · "เทียบเดือนก่อนทั้งเดือน" ±% · ต้นทุนขาย (SALES: ยอดขายเดือนนี้ + เทียบเดือนก่อน) · เดือนนำหน้าที่ยังไม่มีบัญชีร้าน (ยอดขายและต้นทุน 0) ไม่แสดงเป็นแท่ง 0 ให้ตัดทิ้ง กราฟจึงมี 1–6 แท่ง · แท่งคู่ต่อเดือน ยอดขาย (เขียว) / ต้นทุน (ลายเส้น) + ป้ายกำไรขั้นต้นเหนือแท่ง · เดือนปัจจุบันเน้น · หมายเหตุ "กำไรขั้นต้น = ยอดขายหน้าร้าน − ต้นทุนเครื่องที่ขาย ไม่รวมค่าใช้จ่ายดำเนินงาน" · บนมือถือกราฟเลื่อนซ้ายขวา
5. **ขายดี 30 วัน** แท็บ "ตามรุ่น | ตามหมวด" 5 อันดับ แถบสัดส่วน + จำนวนชิ้น · ท้ายการ์ด "นับจากรายการขายที่ไม่ถูกยกเลิก" · กดชื่อรุ่น → `/stock/products?search=<รุ่น>`
6. **ค้างสต๊อกนานสุด** 5 อันดับ: ลำดับ (แดงถ้า > 90 วัน, เหลืองถ้า 31–90) · ชื่อ · "ทุน X" (เฉพาะเมื่อมี cost) · จำนวนวัน · ลิงก์ "ดูทั้งหมด N เครื่อง" → `/stock/products?sortBy=stockInDate&sortDirection=asc` · ท้ายการ์ด: จำนวนตามช่วงอายุ 0–30 / 31–60 / 61–90 / 90+
   ลิงก์ที่บทบาทนั้นเปิดไม่ได้ (เช่น `/stock/alerts` สำหรับ FM/ACC/SALES) ให้แสดงเป็นแถวธรรมดาไม่ใช่ลิงก์
7. (SALES เท่านั้น) **งานของฉันวันนี้** การ์ดเดิมจาก StaffHome (todo 5 รายการ + ลิงก์ `/todos?view=today&assigneeId=me`)

สถานะโหลด: skeleton ของแดชบอร์ด (`DashboardSkeleton`) · การ์ดแต่ละใบไม่มีข้อมูล → "ยังไม่มีข้อมูล" ไม่ใช่ 0 ปลอม

## 5. ข้อมูล: endpoint เดียว

`GET /shop-home?branchId=` · roles OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES · อยู่นอก `/dashboard/*` เพราะ prefix นั้นปฏิเสธ SALES ทั้งก้อน

```ts
type ShopHomeResponse = {
  generatedAt: string;                       // ISO
  branch: { id: string | null; name: string } // null = ทุกสาขา
  today: {
    sales: { count: number; netAmount: number; cash: number; installment: number; externalFinance: number }; // นับบิลตาม saleType (daily-summary ไม่แยกวิธีรับเงิน)
    cashDrawer: { balance: number; closedToday: boolean; lastClosedAt: string | null };
    bookingsExpiringToday: { count: number; depositTotal: number; reservedUnits: number };
    afterSales: { waitingPickup: number; overdue: number };
  };
  watch: Array<{
    key: 'LOW_STOCK' | 'AGING_90' | 'QC_PHOTO' | 'TRANSFER_PENDING' | 'REPOSSESSED' | 'PO_APPROVAL';
    count: number;
    severity: 'urgent' | 'wait' | 'info';
    detail: string | null;                   // ข้อความสั้นที่ server ประกอบแล้ว (ชื่อ SKU, เลข PO)
    costValue: number | null;                // เฉพาะ AGING_90; null เมื่อไม่มีสิทธิ์ดูต้นทุน
  }>;                                        // เฉพาะรายการที่ count > 0 เรียงตาม severity
  monthly: Array<{ month: string; sales: number; cost: number | null; grossProfit: number | null }>; // 1–6 เดือน เก่า→ใหม่, month = 'YYYY-MM', ตัดเดือนนำหน้าที่ว่างออก
  thisMonth: { sales: number; salesMomPct: number | null; cost: number | null; grossProfit: number | null; grossMarginPct: number | null; grossProfitMomPct: number | null };
  topSellers30d: { byModel: Array<{ name: string; count: number }>; byCategory: Array<{ name: string; count: number }> }; // สูงสุด 5
  slowMovers: Array<{ name: string; days: number; costPrice?: number }>; // สูงสุด 5 เฉพาะ ≥ 30 วัน
  stockAging: Array<{ label: string; count: number }>; // 4 ช่วง
};
```

**ที่มาของแต่ละก้อน** (ใช้ service ที่มีอยู่ ไม่เขียน query ซ้ำ ถ้าของเดิมให้ไม่ครบค่อยเพิ่ม method ใน service เจ้าของข้อมูล)
- `today.sales` ← sales daily-summary ของวันนี้ (เวลาไทย)
- `today.cashDrawer` ← สรุปเงินสดหน้าร้านรายวัน (สถานะปิดยอดของวันนี้ + ยอดคงเหลือ)
- `today.bookingsExpiringToday` ← นับใบจองเปิดอยู่ที่ `expireDate` = วันนี้ (summary เดิมไม่มีตัวนับนี้)
- `today.afterSales` ← นับเคสสถานะ "รอลูกค้ารับ" และที่เลยวันนัด
- `watch` ← stock dashboard `actionRequired` (qcPending, photoPending, pendingTransfers, repossessed, agingOver90) + ตาราง `StockAlert` ที่ ACTIVE (cron ดูแล ไม่ใช่การนับสดแบบ N+1) + PO สถานะ DRAFT
- `monthly`/`thisMonth` ← งบ SHOP รายเดือนจาก journal: ยอดขาย = เฉพาะบัญชี S41 (S42 รายได้อื่นไม่นับ) − ต้นทุนขาย S50; `cost`/`grossProfit` เป็น null สำหรับ SALES
- `topSellers30d` ← รายการขาย 30 วันที่ไม่ถูกยกเลิก จัดกลุ่มตาม `brand model` และตาม `category`
- `slowMovers`, `stockAging` ← stock dashboard (ตัด `costPrice` ด้วย `omitCostPrice` เมื่อไม่มีสิทธิ์)

**การตัดต้นทุน**: service ประกอบ response เต็มเสมอ แล้ว controller เรียก `redactShopHome(response)` เมื่อ `!canSeeCost(user.role)` (เพิ่มใน `cost-visibility.util.ts` ข้าง `redactStockDashboard`) — เหตุผล: มีจุดเดียวที่ตัดสิน และเทสต์ได้โดยไม่ต้องต่อ DB

**สาขา**: บทบาทข้ามสาขา (OWNER/FM/ACC ตาม `getBranchScope`) ไม่ส่ง `branchId` = ทุกสาขา; บทบาทประจำสาขา (BM, SALES) ถูกบังคับเป็นสาขาตัวเองเสมอ ไม่ว่าจะส่งอะไรมา; ถ้าไม่มีสาขาผูก → 403

**เวลา**: วันนี้ = วันที่ไทย (`bangkokDateString()`); เดือนในกราฟ = ปฏิทินไทย label "ต.ค." จากฝั่งเว็บ

## 6. ฝั่งเว็บ

- `pages/DashboardPage/index.tsx`: อ่าน `workZone` จาก `useLayout()`; `shop` → `ShopHome` (ทุกบทบาท); อื่น ๆ คงเดิม (SALES → StaffHome, อื่น → ManagementDashboard)
- หน้าใหม่ `pages/ShopHomePage/` (index + components ต่อการ์ด + hook `useShopHome(branchId)` react-query key `['shop-home', branchId]`, `staleTime = cacheTtlDashboard * 1000` เหมือน ManagementDashboard)
- ใช้โทเคน/คอมโพเนนต์เดิม: `PageHeader`, `Card`, `AnimatedCounter`, `Button`, `QueryBoundary`, recharts `BarChart` แบบเดียวกับ `StockDashboardTab`
- ชิปความเร่งด่วนมีคำกำกับเสมอ (ไม่สื่อด้วยสีอย่างเดียว) · แท่งต้นทุนใช้ลายเส้น (`<pattern>` ของ recharts) · ปุ่ม/แท็บสูง ≥ 36px เดสก์ท็อป / ≥ 44px มือถือ · ทุกตัวเลขเงินใช้ `tabular-nums`
- การ์ด "งานของฉันวันนี้" สำหรับ SALES ดึง component เดิมจาก StaffHome (แยกเป็น `MyTodayTasksCard` ให้ทั้งสองหน้าใช้ร่วม ไม่ก็อปโค้ด)

## 7. เทสต์ที่ต้องมี

- API: unit test ของ `redactShopHome` (SALES ได้ null/ไม่มี cost ครบทุกจุด; OWNER ได้ก้อนเดิม) · unit test ของ service ประกอบ `watch` (แถว count 0 หาย, เรียง severity) และ `monthly` (6 เดือน เก่า→ใหม่, คำนวณ grossProfit/margin/MoM) ด้วย mock ของ service ย่อย · controller test ว่า `@Roles` มี SALES และส่ง `branchId` ต่อ
- Web: `DashboardPage` เลือกหน้าตาม `workZone` × role (4 กรณี) · `ShopHomePage` render ด้วย response เต็ม (เห็น ฿ ต้นทุน) และ response ที่ถูกตัด (ไม่มี ฿ ต้นทุน, หัวกราฟเปลี่ยน, ไม่พัง) · รายการ watch ว่าง → ข้อความ "ไม่มีงานค้าง"
- ก่อน PR: jest ที่แตะ, vitest ที่แตะ, tsc api+web, eslint ไฟล์ที่แก้, bump `apps/web/package.json`

## 8. สิ่งที่ปล่อยให้ผู้ทำตัดสิน

- ชื่อไฟล์/คอมโพเนนต์ย่อยในหน้า · วิธี group รุ่น (`brand model` ตัด storage หรือไม่ ให้ตรงกับ `topSellers` ของ stock dashboard) · skeleton เฉพาะหน้า
- ถ้า service เดิมของลิ้นชักหรือหลังการขายไม่มี method นับให้ตรง ให้เพิ่ม method เล็กใน service นั้น พร้อมเทสต์ ไม่ query ตรงจาก shop-home service

## 9. ความเสี่ยงที่รู้อยู่แล้ว

- งบ SHOP รายเดือนเรียก `journalLine.groupBy` 6 ครั้ง (ครั้งละ query เดียว) ไม่ต้องมี cache ฝั่ง server; staleTime 60 วินาทีฝั่งเว็บพอ
- ประวัติขายที่นำเข้าจาก Tooltify อยู่ตาราง `ImportedSale` ไม่ได้ลงสมุดรายวัน กราฟจึงเริ่มจากเดือนที่บัญชีร้านเดินจริง
- `stockInDate` ว่างในของเก่า → อายุสต๊อกนับจาก `createdAt` (พฤติกรรมเดิมของ stock dashboard ยอมรับ)
- ต้นทุนก่อน/หลัง 2026-09-29 รวม VAT ไม่เท่ากัน (ข้อจำกัดข้อมูลเดิม แสดงหมายเหตุใต้กราฟแล้ว)
