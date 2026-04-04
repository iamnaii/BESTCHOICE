# KPI Dashboard Proposal — BESTCHOICE Sales

**เวอร์ชัน**: 1.0
**อัปเดต**: 2026-04-04
**เจ้าของ**: CSO — BESTCHOICE
**ผู้ใช้หลัก**: CSO, CEO, BRANCH_MANAGER

---

## ภาพรวม

Dashboard นี้ออกแบบมาเพื่อวัดผลหลังจาก deploy sales scripts ไปยัง LINE OA และหน้าร้าน
เป้าหมายคือเห็น bottleneck ใน funnel และ optimize อย่างต่อเนื่อง

---

## Conversion Funnel หลัก

```
สอบถาม (Inquiry)
       ↓
   สมัคร (Apply)
       ↓
  อนุมัติ (Approved)
       ↓
รับเครื่อง (Closed)
```

**เป้าหมาย Conversion ต่อขั้น:**

| ขั้น | อัตราเป้าหมาย | ความหมาย |
|-----|-------------|---------|
| Inquiry → Apply | ≥ 30% | 10 คนสอบถาม → 3 คนสมัคร |
| Apply → Approved | ≥ 70% | 3 คนสมัคร → 2 คนอนุมัติ |
| Approved → Closed | ≥ 90% | 2 คนอนุมัติ → 2 คนรับเครื่อง |
| **Overall (Inquiry → Closed)** | **≥ 10%** | **ทุก 10 ราย ปิดได้ 1 สัญญา** |

---

## KPI หลัก (Primary KPIs)

### 1. Sales Volume

| Metric | เป้าหมาย | รอบ | แหล่งข้อมูล |
|--------|----------|-----|-----------|
| New Contracts | ≥ 50 สัญญา | รายเดือน | ระบบ BESTCHOICE |
| Revenue (GMV) | ≥ 1,000,000 บาท | รายเดือน | ระบบ BESTCHOICE |
| Average Deal Value | ≥ 20,000 บาท | ต่อสัญญา | ระบบ BESTCHOICE |

### 2. Lead Performance

| Metric | เป้าหมาย | รอบ | แหล่งข้อมูล |
|--------|----------|-----|-----------|
| New Leads (LINE OA) | ≥ 200 ราย | รายเดือน | LINE OA analytics |
| New Leads (Walk-in) | ≥ 80 ราย | รายเดือน | บันทึกหน้าร้าน |
| Conversion Rate (Online) | ≥ 10% | รายเดือน | คำนวณจาก Leads/Contracts |
| Conversion Rate (Walk-in) | ≥ 30% | รายเดือน | คำนวณจาก Walk-in/Contracts |

### 3. Response & Service

| Metric | เป้าหมาย | รอบ | แหล่งข้อมูล |
|--------|----------|-----|-----------|
| Response Time (LINE OA) | ≤ 5 นาที | Real-time | LINE OA analytics |
| Response Rate | ≥ 80% | รายวัน | LINE OA analytics |
| Customer Satisfaction (CSAT) | ≥ 4.5 / 5 | รายสัปดาห์ | LINE OA review |

---

## KPI รอง (Secondary KPIs)

### 4. Upsell Performance

| Metric | เป้าหมาย | รอบ |
|--------|----------|-----|
| Upsell Rate | ≥ 40% | รายเดือน |
| Upsell Revenue | ≥ 50,000 บาท | รายเดือน |
| Top Upsell Items | ติดตามรายการ | รายเดือน |

### 5. Product Mix

| Metric | เป้าหมาย | รอบ |
|--------|----------|-----|
| iPhone มือ1 (% ของสัญญา) | ติดตาม | รายเดือน |
| iPhone มือ2 (% ของสัญญา) | ติดตาม | รายเดือน |
| iPad (% ของสัญญา) | ติดตาม | รายเดือน |

### 6. Rejection Analysis

| Metric | รอบ | ใช้เพื่อ |
|--------|-----|---------|
| Rejection Rate | รายสัปดาห์ | ปรับ lead quality |
| Top Rejection Reasons | รายเดือน | ปรับเงื่อนไขหรือ target |
| Leads ที่ไม่สมัคร + เหตุผล | รายสัปดาห์ | ส่ง CEO วิเคราะห์ |

---

## Dashboard Layout (แนะนำ)

### หน้าหลัก — Overview (Daily)

```
┌──────────────────────────────────────────────────────┐
│ BESTCHOICE Sales Dashboard — [วันที่]                  │
├──────────────┬──────────────┬──────────────┬──────────┤
│ New Leads    │ Contracts    │ Revenue      │ CSAT     │
│ Today: XX    │ Today: XX    │ Today: XX฿   │ X.X/5    │
│ MTD: XXX     │ MTD: XX      │ MTD: X,XXX฿  │          │
├──────────────┴──────────────┴──────────────┴──────────┤
│ CONVERSION FUNNEL (MTD)                               │
│ Inquiry: XXX → Apply: XX (XX%) → Approved: XX (XX%)  │
│ → Closed: XX (XX%) | Overall: X.X%                   │
├───────────────────────────┬──────────────────────────┤
│ Response Time (Avg Today) │ Pending Leads (> 24h)    │
│ X.X นาที                  │ XX ราย                   │
└───────────────────────────┴──────────────────────────┘
```

### หน้า 2 — Sales Detail (Weekly/Monthly)

```
┌──────────────────────────────────────────────────────┐
│ TOP PRODUCTS THIS MONTH                              │
│ 1. iPhone 15 — XX สัญญา (XX%)                        │
│ 2. iPhone 16 — XX สัญญา (XX%)                        │
│ 3. iPhone มือ2 — XX สัญญา (XX%)                      │
├──────────────────────────────────────────────────────┤
│ UPSELL PERFORMANCE                                   │
│ Upsell Rate: XX% (เป้า ≥ 40%)                        │
│ Upsell Revenue: XX,XXX บาท                           │
├──────────────────────────────────────────────────────┤
│ REJECTION ANALYSIS                                   │
│ รายได้ไม่พอ: XX%  |  เอกสารไม่ครบ: XX%               │
│ ไม่ประสงค์ต่อ: XX% |  อื่นๆ: XX%                     │
└──────────────────────────────────────────────────────┘
```

---

## แหล่งข้อมูล & การเก็บ Data

| ข้อมูล | เก็บจากไหน | ความถี่ |
|--------|-----------|--------|
| Leads / Inquiries | LINE OA + บันทึกหน้าร้าน | Real-time |
| Applications | ระบบ BESTCHOICE (ฟอร์มสมัคร) | Real-time |
| Approvals | ระบบ BESTCHOICE (Credit module) | Real-time |
| Contracts | ระบบ BESTCHOICE (Contract module) | Real-time |
| Response time | LINE OA analytics | รายวัน |
| CSAT score | LINE OA review / หลังรับเครื่อง | รายสัปดาห์ |
| Upsell data | ระบบ BESTCHOICE (POS / stock) | Real-time |
| Rejection reasons | Form feedback หน้าร้าน | รายสัปดาห์ |

---

## Implementation Options

### Option A: ใช้ระบบ BESTCHOICE ที่มีอยู่ (แนะนำ — Short-term)

ระบบมี dashboard อยู่แล้วที่ `/` (Dashboard route)

**สิ่งที่ต้องเพิ่ม:**
- Widget แสดง Conversion Funnel (Inquiry → Closed)
- Widget Response Time จาก LINE OA
- การบันทึก Lead source (LINE OA vs Walk-in)
- Form เก็บ rejection reason สำหรับ leads ที่ไม่ปิด

**ผู้รับผิดชอบ**: CTO / Developer

---

### Option B: Google Looker Studio (Free — Medium-term)

เชื่อม Google Sheets (export จากระบบ) → Looker Studio Dashboard

**ข้อดี:**
- ฟรี
- Visualize ได้สวย (chart, funnel, bar graph)
- Share link ได้ง่าย

**ข้อเสีย:**
- Data ต้อง export / sync manually หรือผ่าน API
- ไม่ real-time ถ้าไม่มี automation

---

### Option C: LINE OA Analytics (Built-in — ใช้ได้เลย)

LINE OA มี analytics built-in สำหรับ:
- Friend count / growth
- Message delivery & open rate
- Rich menu click rate

**เข้าถึง**: LINE Official Account Manager → **Insight**

---

## Reporting Cadence

| รายงาน | ความถี่ | ผู้รับ | Format |
|--------|--------|--------|--------|
| Daily Sales Summary | ทุกวัน 19:00 น. | CSO | LINE message |
| Weekly KPI Report | ทุกจันทร์ | CSO + CEO | Google Sheets / Dashboard |
| Monthly Sales Review | ต้นเดือน | CEO + OWNER | Presentation / Report |
| Rejection Analysis | ทุกสัปดาห์ | CEO | Summary + raw data |

---

## Action Items หลัง Go-Live

| สัปดาห์ | สิ่งที่ต้องทำ |
|---------|-------------|
| Week 1 | เริ่มเก็บ baseline data — Leads, Conversions, Response time |
| Week 2 | Review แรก — ดู funnel drop-off point แรก |
| Week 3 | ปรับ script ถ้า Inquiry → Apply ต่ำกว่า 30% |
| Week 4 | Monthly review ครั้งแรก — เสนอ CEO |
| Month 2 | ปรับ KPI targets ตาม baseline จริง |

---

## คำนิยาม (Glossary)

| คำ | ความหมาย |
|----|---------|
| **Inquiry / Lead** | คนที่ทักมาสอบถามหรือเดินเข้าร้าน |
| **Apply** | ลูกค้าที่ยื่นเอกสารสมัครแล้ว |
| **Approved** | ลูกค้าที่ผ่านการอนุมัติสินเชื่อ |
| **Closed / Contract** | ลูกค้าที่เซ็นสัญญาและรับเครื่องแล้ว |
| **Conversion Rate** | Closed ÷ Inquiry × 100% |
| **CSAT** | Customer Satisfaction Score (1–5) |
| **MTD** | Month-to-Date (ยอดสะสมตั้งแต่ต้นเดือน) |
| **GMV** | Gross Merchandise Value (มูลค่าสินค้าทั้งหมด) |

---

*อัปเดต targets ทุกไตรมาส หรือเมื่อมีการเปลี่ยนแปลง strategy*
*ส่ง feedback และ raw data ให้ CSO ทุกสัปดาห์เพื่อปรับปรุง scripts*
