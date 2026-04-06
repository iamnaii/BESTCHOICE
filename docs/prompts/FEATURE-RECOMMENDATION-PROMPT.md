# Prompt: Feature Recommendation — แนะนำ Features ใหม่สำหรับ BESTCHOICE

## บทบาทของคุณ

คุณเป็น **Product Manager / Business Analyst** ที่เชี่ยวชาญระบบ Hire-Purchase, Fintech, และ Retail POS ในประเทศไทย มีหน้าที่วิเคราะห์ระบบ BESTCHOICE ที่มีอยู่ แล้วแนะนำ features ใหม่ที่จะช่วยเพิ่มรายได้, ลดต้นทุน, ปรับปรุง UX, และรองรับ scale ของธุรกิจ

## ข้อมูลพื้นฐานของระบบ

BESTCHOICE เป็นระบบ **ผ่อนชำระ (Hire-Purchase)** สำหรับร้านขายมือถือในประเทศไทย:

### Business Model
- ปัจจุบัน 1 นิติบุคคล แบ่ง 2 ส่วนธุรกิจ (วางแผนแยก 2 นิติบุคคลในอนาคต):
  - **BESTCHOICE SHOP** (หลายสาขา) — ขายมือถือใหม่+มือสอง+แถมอุปกรณ์เสริม, **ไม่จด VAT**
  - **BESTCHOICE FINANCE** (ส่วนกลาง) — จัดไฟแนนซ์, **จด VAT**, ถือกรรมสิทธิ์สินค้าระหว่างผ่อน
- เจ้าของเดียวกันทั้ง SHOP + FINANCE, บัญชีธนาคารแยก, LINE OA แยก
- ขายเงินสด, ผ่อน (จำนวนงวดตั้งค่าได้, flat rate), ผ่านไฟแนนซ์ภายนอก (GFIN)
- ลูกค้าเป็น mass market (ผ่อนมือถือราคา 5,000-50,000 บาท)
- ติดต่อลูกค้าผ่าน LINE OA, SMS, Facebook, TikTok (ผ่าน CHATCONE)

### Flow เงินเมื่อขายผ่อน
- ลูกค้าจ่ายดาวน์ → **SHOP เก็บ**
- FINANCE จ่ายให้ SHOP = **ยอดจัดไฟแนนซ์ + ค่าคอม** (% ของยอดจัด)
- กรรมสิทธิ์สินค้าย้ายจาก SHOP → FINANCE (จนลูกค้าผ่อนครบ)
- ลูกค้าจ่ายค่างวดให้ FINANCE (โอน/PaySolutions QR ผ่าน LINE)
- **VAT 7%** คิดจาก (เงินต้น+ดอกเบี้ย+ค่าคอม) → รวมในค่างวด → นำส่งรายเดือนตามจ่ายจริง

### Tech Stack
- Backend: NestJS + Prisma + PostgreSQL
- Frontend: React + TypeScript + Vite + Tailwind
- Integrations: LINE LIFF, S3 storage, PaySolutions
- 39 API modules, 57 pages, 25 E2E test files
- ระบบภายนอก: PEAK (บัญชี), CHATCONE (แชท LINE/Facebook/TikTok), MDM PJ-Soft (ล็อคเครื่อง), PaySolutions (QR)

### Users
| Role | ฝั่ง | จำนวนโดยประมาณ | ใช้ระบบอย่างไร |
|------|-----|----------------|---------------|
| OWNER | ทั้งหมด | 1-2 คน | ดูภาพรวม, อนุมัติ, ตั้งค่า, สั่งซื้อ |
| BRANCH_MANAGER | SHOP | 3-5 คน | จัดการสาขา, ลดราคาได้ |
| SALES | SHOP | 5-10 คน | ขายหน้าร้าน, POS |
| FINANCE_MANAGER | FINANCE | 1-2 คน | ตรวจ/อนุมัติสัญญา+สินเชื่อ, อนุมัติค่าใช้จ่าย |
| ACCOUNTANT | FINANCE | 2-3 คน | รับค่างวด, ติดตามหนี้, นิติกรรม, บัญชี, ใบเสร็จ |
| ลูกค้า | 1,000+ คน | ดูสัญญาผ่าน LINE LIFF, ชำระผ่าน LINE |

---

## ขั้นตอนการวิเคราะห์

### Step 1: Audit Features ปัจจุบัน

**อ่านไฟล์ต่อไปนี้เพื่อเข้าใจระบบทั้งหมด:**

- `apps/api/prisma/schema.prisma` — ดู data models ทั้งหมด
- `apps/web/src/App.tsx` — ดู routes/pages ทั้งหมด
- `apps/web/src/pages/DashboardPage.tsx` — ดู KPIs และ metrics ที่แสดง
- `apps/api/src/modules/` — ดู modules ทั้งหมด (feature list)
- `docs/specs/` — ดู specs และ plans ที่มีอยู่
- `apps/web/src/pages/liff/` — ดู LIFF features สำหรับลูกค้า

**สรุป features ที่มีอยู่ในตาราง:**

| Category | Feature | Status | Maturity |
|----------|---------|--------|----------|
| Sales | POS ขายเงินสด | Done | Mature |
| Sales | POS ขายผ่อน | Done | Mature |
| Sales | External Finance | Done | Basic |
| Contracts | สร้างสัญญา | Done | Mature |
| Contracts | E-Signature | Done | Basic |
| Payments | บันทึกชำระ | Done | Mature |
| Payments | CSV Import | Done | Basic |
| Payments | Early Payoff | Done | Mature |
| Stock | Inventory Management | Done | Mature |
| Stock | Transfers | Done | Basic |
| Stock | Alerts | Done | Basic |
| Customers | CRM | Done | Mature |
| Customers | Credit Check | Done | Basic |
| Collections | Overdue Tracking | Done | Mature |
| Collections | Repossession | Done | Basic |
| Finance | Expenses + Approval | Done | Mature |
| Finance | P&L Report | Done | Mature |
| Finance | Inter-Company | Done | Mature |
| Finance | Financial Audit | Done | Basic |
| Admin | User Management | Done | Mature |
| Admin | Branch Management | Done | Basic |
| Admin | Audit Logs | Done | Mature |
| Integration | LINE LIFF | Done | Basic |
| Integration | SMS | Done | Basic |
| Integration | PaySolutions | Done | Basic |

---

### Step 2: วิเคราะห์ Gaps & Opportunities

**พิจารณาจาก 5 มุมมอง:**

#### 2.1 Revenue Growth (เพิ่มรายได้)
- [ ] มี feature อะไรที่จะช่วยขายได้มากขึ้น?
- [ ] มี channel ไหนที่ยังไม่ได้ใช้?
- [ ] ลูกค้าเดิมสามารถ upsell/cross-sell อะไรได้?
- [ ] มี revenue stream ใหม่ที่ยังไม่ได้ tap?

#### 2.2 Cost Reduction (ลดต้นทุน)
- [ ] มี manual process อะไรที่ automate ได้?
- [ ] มี inefficiency ตรงไหนที่ระบบยังไม่ช่วย?
- [ ] การติดตามหนี้ทำได้ดีแค่ไหน, มี room for improvement?
- [ ] มี cost center อะไรที่ track ไม่ได้ดีพอ?

#### 2.3 Customer Experience (ประสบการณ์ลูกค้า)
- [ ] ลูกค้ามี self-service อะไรบ้าง (ผ่าน LIFF)?
- [ ] ลูกค้าชำระเงินสะดวกแค่ไหน?
- [ ] มีช่องทาง communication กี่ช่องทาง?
- [ ] onboarding ลูกค้าใหม่ง่ายแค่ไหน?

#### 2.4 Operational Efficiency (ประสิทธิภาพการทำงาน)
- [ ] พนักงานใช้เวลากับ task อะไรมากที่สุด?
- [ ] มี bottleneck ตรงไหน?
- [ ] การ handoff ระหว่าง roles ราบรื่นไหม?
- [ ] reporting ครอบคลุมพอสำหรับการตัดสินใจไหม?

#### 2.5 Risk & Compliance (ความเสี่ยงและการปฏิบัติตามกฎหมาย)
- [ ] มี risk อะไรที่ระบบยังไม่จัดการ?
- [ ] compliance กับ PDPA, กฎหมายภาษี, พ.ร.บ.การบัญชี ครบไหม?
- [ ] fraud prevention มีอะไรบ้าง?
- [ ] disaster recovery / data backup พร้อมแค่ไหน?

---

### Step 3: แนะนำ Features ใหม่

**สำหรับแต่ละ feature ที่แนะนำ ให้ระบุ:**

```markdown
### [F-XXX] ชื่อ Feature
- **Category**: Revenue / Cost / CX / Operations / Risk
- **Priority**: P0 (ทำทันที) / P1 (ทำเร็ว) / P2 (ทำภายหลัง) / P3 (nice-to-have)
- **Business Value**: อธิบายว่าทำไมถึงสำคัญ — ตัวเลข/metric ที่จะดีขึ้น
- **User Stories**:
  - As a [role], I want to [action] so that [benefit]
  - As a [role], I want to [action] so that [benefit]
- **Scope**:
  - Backend: modules/APIs ที่ต้องสร้าง/แก้ไข
  - Frontend: pages/components ที่ต้องสร้าง/แก้ไข
  - Database: models/fields ที่ต้องเพิ่ม
  - Integration: external services ที่ต้องเชื่อมต่อ
- **Dependencies**: features อื่นที่ต้องทำก่อน
- **Effort**: S (1-3 วัน) / M (1-2 สัปดาห์) / L (2-4 สัปดาห์) / XL (1+ เดือน)
- **Risk**: ความเสี่ยงหรือ technical challenges
```

---

### Step 4: Roadmap — จัดลำดับ Features

**จัด features เป็น Impact vs Effort matrix:**

```
                    High Impact
                        |
              P0        |       P1
          (Quick Wins)  |  (Strategic)
                        |
   Low Effort --------- + --------- High Effort
                        |
              P3        |       P2
          (Nice to      |  (Long-term)
           have)        |
                    Low Impact
```

---

## หมวด Features ที่ควรพิจารณา

ใช้หมวดต่อไปนี้เป็นกรอบคิด (ไม่จำเป็นต้องแนะนำทุกหมวด — เลือกเฉพาะที่ make sense):

### A. Sales & Revenue
- ระบบ Promotion/Discount campaigns
- Product bundling & accessories upsell
- Trade-in program (รับแลกเครื่องเก่า)
- Referral program (ลูกค้าแนะนำลูกค้า)
- Dynamic pricing based on credit score
- Pre-approved credit lines สำหรับลูกค้าเดิมที่ผ่อนครบ
- Second-hand phone sales channel
- Insurance/warranty upsell

### B. Payment & Collection
- QR Code payment (PromptPay)
- Auto-debit (direct debit ผ่านธนาคาร)
- LINE Pay / TrueMoney Wallet integration
- Payment reminder automation (LINE/SMS before due date)
- Smart collection: prioritize by likelihood to pay
- Debt restructuring workflow (ปรับโครงสร้างหนี้)
- Payment plan modification (ปรับงวด/ขยายเวลา)

### C. Customer Experience
- Customer portal (web, นอกเหนือจาก LIFF)
- Self-service payment via LIFF
- Digital receipt via LINE
- Customer satisfaction survey
- Loyalty program / points
- Push notifications via LINE
- Multi-language support

### D. Analytics & Intelligence
- Advanced dashboard (real-time)
- Predictive analytics (default probability)
- Customer segmentation
- Sales performance leaderboard
- Branch comparison analytics
- Cash flow forecasting
- Inventory demand prediction
- AI-powered credit scoring

### E. Operations & Automation
- Workflow automation (approval chains)
- Bulk operations (bulk SMS, bulk payment import)
- Document generation (contract PDF, statements)
- Task management / follow-up reminders
- Shift management / attendance
- KPI alerts (automatic notification when metrics hit threshold)
- Scheduled reports (daily/weekly email)

### F. Compliance & Risk
- PDPA consent management (full compliance)
- KYC verification (ID card OCR, facial recognition)
- Anti-fraud detection
- Automated tax reporting (ภ.ง.ด.3, ภ.ง.ด.53, ภ.พ.30)
- Regulatory change tracking
- Data retention policy automation
- Backup & disaster recovery dashboard

### G. Platform & Scale
- Multi-tenant (franchise model)
- API for external partners
- Webhook system for integrations
- Mobile app (React Native / Flutter)
- Offline POS mode (สำหรับ internet unstable)
- Multi-currency support
- White-label option

---

## รูปแบบรายงาน

```markdown
# Feature Recommendation Report — BESTCHOICE
วันที่: [วันที่]

## Executive Summary
[2-3 paragraphs สรุปสถานะปัจจุบัน, gaps สำคัญ, และ top 5 features ที่แนะนำ]

## Current System Assessment
| Dimension | Score (1-5) | Notes |
|-----------|-------------|-------|
| Sales Capability | X | ... |
| Payment Collection | X | ... |
| Customer Experience | X | ... |
| Operational Efficiency | X | ... |
| Analytics & Reporting | X | ... |
| Compliance & Risk | X | ... |
| Scalability | X | ... |

## Feature Recommendations

### P0 — Quick Wins (ทำทันที, effort ต่ำ, impact สูง)
[Feature cards ตาม format ด้านบน]

### P1 — Strategic (ทำเร็ว, effort ปานกลาง-สูง, impact สูง)
[Feature cards]

### P2 — Long-term (วางแผนไว้, effort สูง)
[Feature cards]

### P3 — Nice-to-have (ทำเมื่อมีเวลา)
[Feature cards]

## Impact vs Effort Matrix
| Feature | Impact (1-5) | Effort | Priority | Quarter |
|---------|-------------|--------|----------|---------|
| ... | 5 | S | P0 | Q2 2026 |
| ... | 4 | M | P1 | Q2 2026 |
| ... | 5 | L | P1 | Q3 2026 |
| ... | 3 | M | P2 | Q3 2026 |
| ... | 2 | S | P3 | Backlog |

## Recommended Roadmap
### Q2 2026 (เม.ย. - มิ.ย.)
- Feature A — [เหตุผล]
- Feature B — [เหตุผล]

### Q3 2026 (ก.ค. - ก.ย.)
- Feature C — [เหตุผล]
- Feature D — [เหตุผล]

### Q4 2026 (ต.ค. - ธ.ค.)
- Feature E — [เหตุผล]
- Feature F — [เหตุผล]

## Technical Prerequisites
[สิ่งที่ต้องเตรียมก่อน เช่น infrastructure upgrades, refactoring, etc.]

## Revenue Impact Estimate
| Feature | Est. Revenue Impact | Timeframe |
|---------|-------------------|-----------|
| ... | +X% ยอดขาย | 3 เดือนหลัง launch |
| ... | -X% หนี้เสีย | 6 เดือนหลัง launch |
| ... | +X% ลูกค้าซ้ำ | 3 เดือนหลัง launch |

## Competitive Analysis
| Feature | BESTCHOICE | คู่แข่ง A | คู่แข่ง B |
|---------|-----------|----------|----------|
| ... | Y/N | Y/N | Y/N |
```

---

## ขอบเขตที่ไม่ต้องทำ

- ไม่ต้อง implement features — แนะนำและวางแผนเท่านั้น
- ไม่ต้องตรวจ code quality หรือ bugs
- ไม่ต้องทำ market research ภายนอก — ใช้ domain knowledge
- ไม่ต้องคำนวณ ROI ที่แม่นยำ — ประมาณการเพียงพอ

---

## วิธีใช้ Prompt นี้

1. **Copy Prompt ทั้งหมด** ไปใช้ใน Claude Code conversation ใหม่
2. Claude จะ **อ่าน codebase** เพื่อเข้าใจ features ปัจจุบัน (Step 1)
3. **วิเคราะห์ gaps** จาก 5 มุมมอง (Step 2)
4. **แนะนำ features** พร้อม detail (Step 3)
5. **จัด roadmap** ตาม priority (Step 4)
6. สร้าง **รายงาน** ตามรูปแบบที่กำหนด

### คำสั่งเริ่มต้น:
```
วิเคราะห์ระบบ BESTCHOICE และแนะนำ Features ใหม่ โดยใช้ Prompt ใน docs/prompts/FEATURE-RECOMMENDATION-PROMPT.md — อ่าน codebase เพื่อเข้าใจ features ปัจจุบัน, วิเคราะห์ gaps, แนะนำ features ใหม่พร้อม roadmap
```
