# Sidebar Redesign — 6-Sub-Project Roadmap

**สถานะ:** Brainstorm complete (2026-05-17). SP1 spec ready for review.
**Owner approval:** P6 paradigm + per-role rule (b) + 6-SP decomposition order (a)
**Source artifacts:** เมนูระบบ_BESTCHOICE_ฉบับปรับปรุง CSV + previous SHOP/FINANCE brainstorm 2026-05-15

---

## 1. เป้าหมาย

จัดโครงสร้าง sidebar ใหม่ตาม CSV ที่ owner เสนอ — แยก **3 zones** ชัดเจน (SHOP / FINANCE / ตั้งค่ากลาง) + เติมหน้าที่ยังขาด (~11 หน้า) เพื่อให้ระบบครอบคลุม flow บัญชี/ภาษีตามมาตรฐาน TFRS for NPAEs + รองรับวันแยก 2 นิติบุคคลในอนาคต

## 2. Design Decisions (ตัดสินแล้ว ห้ามถอย)

| Decision | Value | เหตุผล |
|---|---|---|
| Sidebar paradigm | **P6 — Hybrid 2 Pills + Gear** | "หน้าร้าน"/"ไฟแนนซ์" เด่น, ตั้งค่ากลางลึกเข้าใต้เฟือง (ใช้นานๆ ครั้ง) |
| Pill labels | **"หน้าร้าน"** (shop) / **"ไฟแนนซ์"** (fin) | ใช้ไทยทั้งหมด (lock 2026-05-17) |
| Per-role pills visibility | **Rule (b) — pills เฉพาะ multi-zone roles** | SALES/ACCOUNTANT single-zone → ไม่ต้องสลับ ลด clutter |
| Scope | **Full (menu + build ทุกหน้าที่ขาด)** | 6 SP roadmap ครบ ไม่ให้คลิกเจอ 404 หลัง SP6 |
| Sub-project execution | **Sequential SP1→SP6** | ลำดับ logical, SP1 unblock การมองเห็นช่องว่าง |
| Emoji policy | **lucide-react icons เท่านั้นในโค้ดจริง** | ตาม `.claude/rules/frontend.md` — emoji ใช้ใน mockup brainstorm เท่านั้น |
| Default zone per role | OWNER→SHOP, BM→SHOP, FM→FIN, SALES→SHOP, ACC→FIN | mental model ของแต่ละ role |
| Zone persistence | `localStorage[bc.sidebar.lastZone]` + URL `?zone=shop\|fin` | survive refresh + deep link |

## 3. Per-role Rendering Matrix

| Role | Pills | Default zone | Gear (Settings) | SHOP items shown | FIN items shown |
|---|---|---|---|---|---|
| OWNER | ✓ 2 pills | SHOP | ✓ | All | All |
| BRANCH_MANAGER | ✓ 2 pills | SHOP | — | All | ติดตามหนี้ (write — log calls) + Reports |
| FINANCE_MANAGER | ✓ 2 pills | FIN | — | Payments + สัญญา + MDM + Sticker | All |
| SALES | — single-zone | SHOP | — | POS, ลูกค้า, สัญญา, payments, trade-in, commission | — |
| ACCOUNTANT | — single-zone | FIN | — | — | All |

## 4. Sub-Project Roadmap

แต่ละ SP มี spec + plan + implementation cycle แยก — **ห้ามรวม PR ข้าม SP**

| SP | Title | Scope summary | Est. PRs | Est. weeks | Tracking issue |
|---|---|---|---|---|---|
| **SP1** | Sidebar P6 + Zone Mapping | New `menu.ts` config (zones + per-role rule b), placeholder pages, zone persistence, BottomNav zone-aware | 3-5 | 1-2 | ✅ **MERGED 2026-05-18** — PR #995 |
| **SP2** | Accounting Reports Gap | Cash Flow Statement, Equity Statement (งบการเปลี่ยนแปลงส่วนของผู้ถือหุ้น), General Ledger detail page (สมุดแยกประเภท by account), รายงาน Inter-co ครบ | 4-6 | 1-2 | TBD |
| **SP3** | Tax Module Restructure | Refactor `/tax-reports` → split into `/finance/vat` (ภ.พ.30), `/finance/wht` (ภ.ง.ด. 1/3/53 แยกฟอร์ม), `/finance/e-tax` (e-Tax Invoice dedicated, integrate PEAK Sync) | 4-5 | 2-3 | TBD |
| **SP4** | Document Config | Settings UI ตั้งค่ารูปแบบ + เลขที่เอกสาร per type (รายรับ/รายจ่าย/สัญญา/quote) + migration ทำให้ existing seq configurable | 2-3 | 1 | TBD |
| **SP5** | SHOP Additions | ใบเสนอราคา (Quote — new module), Drafts hub (รวม DRAFT-status docs ทุกประเภท), Insurance/Returns refactor (lifecycle รับเข้า→ส่งศูนย์→คืนลูกค้า), CRM Pipeline stages | 5-7 | 2-3 | TBD |
| **SP6** | Bank Accounts Dedicated | แยก Bank Accounts จาก Settings → dedicated page + bank reconciliation feature | 2-3 | 1 | TBD |

**Total:** ~20-29 PRs / 8-13 weeks

## 5. Dependencies

```
SP1 ─┬─→ SP2 (independent after menu wired)
     ├─→ SP3 (independent after menu wired)
     ├─→ SP4 (independent after menu wired)
     ├─→ SP5 (independent after menu wired)
     └─→ SP6 (independent after menu wired)
```

SP2-SP6 สามารถ parallel ได้หลัง SP1 merge แต่ default = sequential เพื่อลดความเสี่ยงลืม (เรียนรู้จาก D1 mega-session)

## 6. มาตรการกันลืม (Anti-loss measures)

อิงประสบการณ์จาก D1 mega-session (66 PRs) — memory บันทึก:

| มาตรการ | รายละเอียด |
|---|---|
| **Roadmap doc กลาง** | ไฟล์นี้เอง — update สถานะแต่ละ SP เมื่อเปลี่ยน + commit |
| **Tracking issue ใน GitHub** | 1 issue ต่อ SP, label `sidebar-redesign`, link PRs ที่เกี่ยวข้อง |
| **Placeholder pages บอก SP** | หน้า "เร็วๆ นี้" ทุกหน้าต้องระบุชัด "อยู่ใน SP2/SP3/.../SP6 — ETA: ..." + link tracking issue |
| **Anti-pattern #3 absolute** | 1 PR/item — ห้าม collapse F2/F5 (D1 lesson) |
| **Per-SP spec self-review + user gate** | ทุก SP ต้องมี spec + user review ก่อนเขียน plan |
| **TaskStop ถ้าเริ่ม drift** | ถ้า subagent เริ่มรวม items นอก scope ของ SP นั้น → stop + re-dispatch additive (D1 lesson) |
| **Opus model สำหรับ subagent ทุกตัว** | per `feedback_use_opus_for_all_subagents.md` — ไม่ downgrade |
| **Review 3-4 rounds per task** | per `feedback_review_thoroughness.md` — spec + 2-3 quality passes |

## 7. Placeholder Page Specification

ทุกหน้าที่ยังไม่มีจะ link ไป component `<ComingSoonPage>` กลาง รับ props:

```ts
type ComingSoonProps = {
  feature: string;         // e.g., "ใบเสนอราคา"
  trackingSP: 'SP2' | 'SP3' | 'SP4' | 'SP5' | 'SP6';
  trackingIssueUrl?: string;
  eta?: string;            // e.g., "ภายในไตรมาส 3/2026"
  description?: string;    // optional explainer
};
```

หน้าจอแสดง: feature name, SP ที่จะทำ, ETA, link ไป tracking issue, ปุ่มย้อนกลับ — ไม่มี 404 ทุกหน้าใน sidebar คลิกได้

## 8. Out of Scope (deferred)

- VAT-on-interest (CR-001 — Phase A.4 deferral) — ต้องปรึกษา CPA แยกต่างหาก
- GFIN integration — รอ business flow
- PII column-level encryption — Phase B
- Multi-entity full split (แยก 2 นิติบุคคลจริง) — Phase C
- PEAK code mapping export reconciliation — Phase A.5

## 9. Source Artifacts

- เมนูระบบ_BESTCHOICE_ฉบับปรับปรุง CSV (owner-provided 2026-05-17)
- Previous brainstorm mockups: `.superpowers/brainstorm/15276-1778841790/content/`
- Current brainstorm mockups: `.superpowers/brainstorm/79635-1779034726/content/`
- Memory entries: `project_sidebar_shop_finance_brainstorm_2026_05_15.md`, `project_d1_settings_implement_session_2026_05_17.md`
