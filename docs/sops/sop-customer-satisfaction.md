# SOP: Customer Satisfaction Measurement
**เวอร์ชัน:** 1.0
**เจ้าของ:** COO
**อัปเดตล่าสุด:** 2026-04-01
**เป้าหมาย:** Customer Satisfaction Score ≥ 4.8/5.0

---

## 1. ช่องทางเก็บ Feedback

### 1.1 หลังอนุมัติสินเชื่อ (Post-Approval Survey)
- **เวลา:** 30 นาที หลังสัญญา status = ACTIVE
- **ช่องทาง:** LINE OA (auto-message จาก chatbot น้องเบส)
- **คำถาม:**
  - ความรวดเร็วในการอนุมัติ (1-5)
  - ความสุภาพของเจ้าหน้าที่ (1-5)
  - ความชัดเจนของข้อมูล (1-5)
  - โดยรวมพอใจแค่ไหน (1-5)
  - ความคิดเห็นเพิ่มเติม (text)

### 1.2 หลังชำระค่างวด (Post-Payment Survey)
- **เวลา:** 1 ชั่วโมง หลัง payment status = PAID
- **ช่องทาง:** LINE OA
- **คำถาม:**
  - ความสะดวกในการชำระ (1-5)
  - ช่องทางชำระเงินเพียงพอหรือไม่ (1-5)
  - มีปัญหาอะไรไหม (Yes/No → ถ้า Yes ขอรายละเอียด)

### 1.3 หลังแก้ไข Complaint (Post-Resolution Survey)
- **เวลา:** 2 ชั่วโมง หลังปิด complaint
- **ช่องทาง:** LINE OA
- **คำถาม:**
  - ปัญหาได้รับการแก้ไขครบถ้วนหรือไม่ (1-5)
  - ความรวดเร็วในการแก้ไข (1-5)
  - โดยรวมพอใจหรือไม่ (1-5)

---

## 2. Scoring Methodology

### 2.1 คำนวณ Score
```
CSAT Score = (จำนวนผู้ให้คะแนน 4-5) / (จำนวนทั้งหมดที่ตอบ) × 100
Average Score = ผลรวมคะแนนทั้งหมด / จำนวนผู้ตอบ
```

### 2.2 Benchmark

| Score | ระดับ | Action |
|-------|-------|--------|
| ≥ 4.8 | Excellent ✅ | รักษาระดับ |
| 4.5 – 4.7 | Good | ติดตาม + ปรับปรุงเล็กน้อย |
| 4.0 – 4.4 | Fair | Review process + action plan |
| < 4.0 | Poor 🚨 | Immediate action + COO review |

---

## 3. Weekly Review Cadence

### ทุกวันจันทร์ 09:00 น. — Weekly Ops Review

**Agenda:**
1. CSAT Score สัปดาห์ที่ผ่านมา (เทียบกับ 4.8 target)
2. Top 3 complaints ที่พบบ่อย
3. SLA performance (LINE response / approval time)
4. Action items จากสัปดาห์ก่อน — status update
5. Action items สัปดาห์นี้

**ผู้เข้าร่วม:** COO, BRANCH_MANAGER, Customer Service

---

## 4. Action Items เมื่อ Score ต่ำกว่าเกณฑ์

### Score 4.5–4.7 (ต่ำกว่า target)
1. ระบุ survey ที่ให้คะแนนต่ำ
2. หา pattern (ประเภทคำถาม / ช่วงเวลา / สาขา)
3. สร้าง action item ใน weekly review
4. ติดตามใน 2 สัปดาห์

### Score 4.0–4.4 (น่าเป็นห่วง)
1. ทุกข้อที่ score < 4.0 → Root Cause Analysis ทันที
2. สร้าง improvement plan พร้อม timeline
3. Report ให้ CEO/Board รับทราบ
4. ติดตามรายวันเป็นเวลา 2 สัปดาห์

### Score < 4.0 (วิกฤต)
1. Emergency meeting ภายใน 24 ชั่วโมง
2. Freeze process เปลี่ยนแปลงที่ไม่จำเป็น
3. CEO/Board review required
4. External audit อาจจำเป็น

---

## 5. Metrics Dashboard (ข้อมูลที่ต้องการจาก CTO)

### Automated Metrics ที่ต้องการ
- [ ] Post-approval survey send rate vs response rate
- [ ] Average CSAT score (7-day rolling average)
- [ ] LINE response time P50/P90/P99
- [ ] Approval time P50/P90/P99
- [ ] Complaint volume by level (daily/weekly)
- [ ] First Contact Resolution Rate

### Data Sources
- Surveys: LINE OA → ระบบหลัก
- Response time: LINE OA API
- Approval time: `contracts` table (`createdAt` → `status=ACTIVE`)
- Complaints: complaint log (ต้องสร้าง module ใหม่)

---

## 6. หมายเหตุ

- Response rate target ≥ 30% (ถ้าต่ำกว่า → ปรับ survey timing/format)
- ห้ามใช้ชื่อลูกค้าในรายงาน (anonymize ก่อน)
- เก็บข้อมูลย้อนหลัง 12 เดือนสำหรับ trend analysis
