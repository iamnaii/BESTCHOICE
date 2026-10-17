# Dropdown แบบเก่าที่ยังเหลือ — 17 ตุลาคม 2026

ตรวจซอร์สใน checkout `BESTCHOICE-layout-audit` หลังแก้ช่องสาขาหน้านัดหมาย
ขอบเขต: dropdown เลือกค่าในฟอร์ม/ตัวกรอง รวมหน้าหลัก dialog และ wizard ทั้งหลังบ้านและเว็บลูกค้า
ไม่รวมเมนูคำสั่งแบบ DropdownMenu, dependency ใน node_modules, tests, comments และไฟล์ build

## ผลสำรวจ

| ประเภท | ตำแหน่งในซอร์ส | ไฟล์ |
| --- | ---: | ---: |
| Native select แบบเดิม — หลังบ้าน | 197 | นับรวมด้านล่าง |
| Native select แบบเดิม — เว็บลูกค้า | 9 | นับรวมด้านล่าง |
| **รวมแบบเดิม** | **206** | **122** |
| แบบทำเองที่ซ่อนลูกศร (`TodoFilters`) | 1 | 1 |
| ตัว `<select>` ภายใน NativeSelect กลาง — ไม่ใช่งานตกหล่น | 1 | 1 |

มีการเรียก NativeSelect กลาง 32 ตำแหน่งในซอร์สแล้ว แต่การเพิ่ม component กลางไม่ได้เปลี่ยน
`<select>` ที่เขียนตรงในหน้าอื่นโดยอัตโนมัติ นี่คือเหตุที่ยังเจอหน้าตาแบบเดิมในหลายหน้า
Radix Select/SelectTrigger, SearchableSelect และ FilterSelect กลางแยกออกจากบัญชีแบบเดิม

ใช้ TypeScript AST สแกน 1,320 source files จึงไม่รวม `<select>` ในคอมเมนต์หรือคำอธิบาย
จำนวนเป็น **ตำแหน่งประกาศในโค้ด ไม่ใช่จำนวนหน้า/จำนวนครั้งที่ render/จำนวน bugs**.
ตัวเดียวที่ใช้ใน `.map()` หรือ shared component อาจปรากฏหลายครั้งและหลายหน้า
ไม่มี `multiple` หรือ `size` listbox ใน native JSX ที่พบ

## ทางเข้าหน้าใช้งาน

- 194 ตำแหน่งโยงถึง route/page inventory ผ่าน import graph; เป็น candidate ไม่ใช่หลักฐานว่าทุก conditional state เปิดให้ทุกสิทธิ์
- อีก 2 ตำแหน่งใน VatReportPage/ETaxInvoicePage มี lazy import แต่ไม่พบ route ที่ตรงใน inventory ต้องทวนทางเข้าก่อนเปลี่ยน
- อีก 10 ตำแหน่งใน 4 ไฟล์ยังไม่เชื่อมจาก app entry: AssetForm 5, AssetTable 2, ui/RichTextEditor 2, storefront SortDropdown 1
- TodoFilters ซ่อนลูกศรด้วย appearance-none แต่ไม่มีลูกศรทดแทน (มีเพียง User icon ด้านซ้าย) เป็นอีก 1 จุดนอก component กลาง
- ค้น `<select>`/createElement('select')/styled.select ใน static/public JS/HTML และ card-reader เพิ่มแล้ว ไม่พบ UI site เพิ่ม;
  พบ 1 select ในรายงาน HTML ของ CLI `apps/api/src/cli/shop-ai-bench.cli.ts:239` แยกเป็นเครื่องมือภายใน ไม่ใช่หน้าแอป

## ตัวอย่างที่ยังต้องเปลี่ยน

- รายการขาย: ประเภทการขาย วิธีชำระ สถานะสัญญา สาขา และผู้ขาย — 5 ตำแหน่ง
- รายการสินค้า/โอนสต๊อก/ตรวจนับ/ตรวจเครื่อง และฟอร์ม PO ย่อย (ตัวกรองหน้า PO ที่เปลี่ยนแล้วไม่ได้ครอบคลุม wizard)
- เพิ่ม/แก้ไขลูกค้า บุคคลอ้างอิง ตรวจเครดิต แผนผ่อน และแก้ไขสัญญา
- แชท: นัดติดตามผล คลังไฟล์ รับเรื่องบริการ สถานะขาย และเชื่อมความคิดเห็น Facebook
- เงินรับจากไฟแนนซ์ ค่าใช้จ่าย ภาษี ปิดงวด และรายการทุน
- เชิญผู้ใช้ รายละเอียดพนักงาน ตั้งค่าราคา ข้อความตอบด่วน และการแจ้งเตือน
- เว็บลูกค้า: ตัวกรองสินค้า แบบประเมินขายเครื่อง และจำนวนงวดในตัวคำนวณ

[รายการรายตำแหน่ง CSV](inventory.csv) · [ข้อมูลครบ JSON](inventory.json) · [ผลเปิดหน้าตัวอย่าง](browser.json)

## ตัวอย่างที่เปิดยืนยันในเบราว์เซอร์

ตรวจ Chromium ที่ 1440px และ390px ด้วย OWNER/API จริงบนฐานทดสอบแยก:
รายการขาย, รายการสินค้า, สัญญา, เงินรับจากไฟแนนซ์, ราคาตั้งต้น,
เปิด dialog เชิญผู้ใช้ และเปิด dialog เพิ่มลูกค้า รวมพบ native appearance=auto
38 observations (มีซ้ำตามขนาดจอ ไม่ใช่จำนวนข้อบกพร่องใหม่).
ฟอนต์เป็น Noto Sans Thai Looped แล้ว แต่ยังใช้ลูกศร native เดิม

[รายการขาย desktop](sales-1440.png) · [รายการขาย mobile](sales-390.png) ·
[เชิญผู้ใช้](users-invite-390.png) · [เพิ่มลูกค้า](customer-create-390.png)

ภาพรวมงานแชทเปิดหน้าได้ แต่ flag รายงานปิดใน fixture จึงไม่ปรากฏตัวกรอง;
`/todos` ในการเปิดผ่านเครื่องมือรอบนี้ไม่คงเส้นทาง จึงยังไม่ใช้เป็นหลักฐานภาพ runtime.
เว็บลูกค้า 9 ตำแหน่งยืนยันจากซอร์ส; preview storefront เดิมไม่ทำงานในรอบนี้.
ไม่ได้อ้างว่ากดครบ dropdown ทั้ง206ตำแหน่ง หรือทดสอบทุก role/เครื่องจริงแล้ว

สคริปต์สำรวจ: [AST scanner](inventory-scan.cjs), [browser sample](browser-sample.cjs),
[source snapshot](source-snapshot.json). ก่อนรันสคริปต์ต้องอยู่ที่ root checkout;
browser sample อาศัยบัญชีทดสอบจากไฟล์ ignored ที่สร้างในรอบก่อน

## ลำดับแก้ที่แนะนำ

1. ฟอร์มที่ใช้ซ้ำ: ลูกค้า/เครดิต/สัญญา, dropdown สาขา, PO wizard และแชท
2. ตัวกรองรายการทั้งหมดและตั้งค่า โดยแยก compact toolbar/table control ออกจากฟอร์มปกติ
3. เว็บลูกค้าและหน้าที่เปิดตามสถานะ/สิทธิ์
4. ทวนโค้ดที่ไม่มีทางเข้าก่อนตัดสินใจย้ายหรือลบ

ใช้ NativeSelect กลางเมื่อยังต้องการ native selection; รักษา id/ref/name/value/onChange,
required/disabled และตำแหน่งใน grid/flex. ไม่ควร replace tag ทั้งหมดโดยไม่ตรวจ wrapper
เพราะ NativeSelect เพิ่ม div อีกชั้นและ default full width ซึ่งอาจเปลี่ยนขนาด filter/table cell
หลังเปลี่ยนให้ตรวจทั้ง focus, ลูกศร, long values, 320px/root20 และพฤติกรรมเลือกค่า

## บัญชีรายไฟล์

| ไฟล์ | ตำแหน่ง | บรรทัด | route ที่เชื่อมโยง |
| --- | ---: | --- | --- |
| [web-shop/src/components/InstallmentCalculatorCard.tsx](../../../apps/web-shop/src/components/InstallmentCalculatorCard.tsx#L350) | 1 | 350 | /products/:id |
| [web-shop/src/components/catalog/FilterSidebar.tsx](../../../apps/web-shop/src/components/catalog/FilterSidebar.tsx#L145) | 5 | 145, 163, 183, 202, 350 | /products |
| [web-shop/src/components/catalog/SortDropdown.tsx](../../../apps/web-shop/src/components/catalog/SortDropdown.tsx#L3) | 1 | 3 | ยังไม่ยืนยันทางเข้า |
| [web-shop/src/pages/sell/SellQuotePage.tsx](../../../apps/web-shop/src/pages/sell/SellQuotePage.tsx#L238) | 2 | 238, 253 | /sell/quote |
| [web/src/components/accounting/ReverseConfirmDialog.tsx](../../../apps/web/src/components/accounting/ReverseConfirmDialog.tsx#L163) | 1 | 163 | /assets/:id<br>/expenses<br>/expenses/:id<br>/expenses/verify/:id<br>/other-income/:id<br>/other-income/:id/edit<br>/other-income/new |
| [web/src/components/contacts/CreateContactModal.tsx](../../../apps/web/src/components/contacts/CreateContactModal.tsx#L259) | 1 | 259 | /after-sales<br>/after-sales/:id<br>/after-sales/new<br>/assets/:id/edit<br>/assets/new<br>/contacts<br>/expenses<br>/expenses/new<br>/other-income/:id/edit<br>/other-income/new<br>/purchase-orders<br>/trade-in |
| [web/src/components/contract/CreditCheckPanel.tsx](../../../apps/web/src/components/contract/CreditCheckPanel.tsx#L301) | 1 | 301 | /contracts/:id |
| [web/src/components/contract/CustomerEditModal.tsx](../../../apps/web/src/components/contract/CustomerEditModal.tsx#L205) | 4 | 205, 252, 370, 389 | /contracts/:id |
| [web/src/components/credit-check/CreditAffordabilityForm.tsx](../../../apps/web/src/components/credit-check/CreditAffordabilityForm.tsx#L106) | 1 | 106 | /contracts/:id<br>/credit-checks<br>/customers/:id |
| [web/src/components/credit-check/CreditCheckCreateModal.tsx](../../../apps/web/src/components/credit-check/CreditCheckCreateModal.tsx#L353) | 1 | 353 | /customers/:id |
| [web/src/components/credit-check/CreditCheckOverrideDialog.tsx](../../../apps/web/src/components/credit-check/CreditCheckOverrideDialog.tsx#L181) | 3 | 181, 219, 238 | /customers/:id |
| [web/src/components/customer/CustomerCreateDialog.tsx](../../../apps/web/src/components/customer/CustomerCreateDialog.tsx#L626) | 5 | 626, 767, 940, 1025, 1044 | /appointments<br>/bookings<br>/customers<br>/customers/:id<br>/inbox/:roomId? |
| [web/src/components/device-returns/DeviceReturnIntakeDialog.tsx](../../../apps/web/src/components/device-returns/DeviceReturnIntakeDialog.tsx#L439) | 2 | 439, 597 | /contracts/:id<br>/repossessions |
| [web/src/components/expense-form-v4/AdjustmentSection.tsx](../../../apps/web/src/components/expense-form-v4/AdjustmentSection.tsx#L170) | 2 | 170, 192 | /expenses<br>/expenses/new |
| [web/src/components/expense-form-v4/ItemLinesSection.tsx](../../../apps/web/src/components/expense-form-v4/ItemLinesSection.tsx#L68) | 3 | 68, 205, 240 | /expenses<br>/expenses/new |
| [web/src/components/expense-form-v4/PayrollLinesSection.tsx](../../../apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx#L324) | 3 | 324, 347, 639 | /expenses<br>/expenses/new |
| [web/src/components/expense-form-v4/PettyCashLinesSection.tsx](../../../apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx#L131) | 1 | 131 | /expenses<br>/expenses/new |
| [web/src/components/expense-form-v4/SettlementLinesSection.tsx](../../../apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx#L175) | 1 | 175 | /expenses<br>/expenses/new |
| [web/src/components/expense-form-v4/VendorSection.tsx](../../../apps/web/src/components/expense-form-v4/VendorSection.tsx#L34) | 2 | 34, 76 | /expenses<br>/expenses/new |
| [web/src/components/payment/SlipReviewTab.tsx](../../../apps/web/src/components/payment/SlipReviewTab.tsx#L636) | 1 | 636 | /payments |
| [web/src/components/product/DeviceOriginFilter.tsx](../../../apps/web/src/components/product/DeviceOriginFilter.tsx#L10) | 1 | 10 | /contracts/create<br>/pos<br>/stock/products |
| [web/src/components/template-editor/editor/BlockEditModal.tsx](../../../apps/web/src/components/template-editor/editor/BlockEditModal.tsx#L90) | 1 | 90 | /contract-templates |
| [web/src/components/template-editor/layout/HeaderBar.tsx](../../../apps/web/src/components/template-editor/layout/HeaderBar.tsx#L103) | 1 | 103 | /contract-templates |
| [web/src/components/tender/TenderInput.tsx](../../../apps/web/src/components/tender/TenderInput.tsx#L123) | 1 | 123 | /bookings<br>/contracts/create<br>/pos |
| [web/src/components/trade-in/TradeInCreditPicker.tsx](../../../apps/web/src/components/trade-in/TradeInCreditPicker.tsx#L25) | 1 | 25 | /contracts/create<br>/pos |
| [web/src/components/ui/RichTextEditor.tsx](../../../apps/web/src/components/ui/RichTextEditor.tsx#L269) | 2 | 269, 282 | ยังไม่ยืนยันทางเข้า |
| [web/src/pages/AfterSalesNewPage.tsx](../../../apps/web/src/pages/AfterSalesNewPage.tsx#L677) | 2 | 677, 778 | /after-sales/new |
| [web/src/pages/AfterSalesPage.tsx](../../../apps/web/src/pages/AfterSalesPage.tsx#L167) | 1 | 167 | /after-sales |
| [web/src/pages/AssetManagementPage/components/AssetForm.tsx](../../../apps/web/src/pages/AssetManagementPage/components/AssetForm.tsx#L138) | 5 | 138, 152, 306, 323, 340 | ยังไม่ยืนยันทางเข้า |
| [web/src/pages/AssetManagementPage/components/AssetTable.tsx](../../../apps/web/src/pages/AssetManagementPage/components/AssetTable.tsx#L183) | 2 | 183, 195 | ยังไม่ยืนยันทางเข้า |
| [web/src/pages/AuditLogsPage.tsx](../../../apps/web/src/pages/AuditLogsPage.tsx#L311) | 1 | 311 | /audit-logs |
| [web/src/pages/ChatAnalyticsPage.tsx](../../../apps/web/src/pages/ChatAnalyticsPage.tsx#L240) | 3 | 240, 255, 273 | /chat-analytics |
| [web/src/pages/ChatbotFinanceKnowledgePage.tsx](../../../apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx#L279) | 2 | 279, 298 | /chatbot-finance/knowledge |
| [web/src/pages/CollectionsPage/components/CollectionsFilters.tsx](../../../apps/web/src/pages/CollectionsPage/components/CollectionsFilters.tsx#L48) | 1 | 48 | /collections |
| [web/src/pages/CollectionsPage/components/LegalCaseDialog.tsx](../../../apps/web/src/pages/CollectionsPage/components/LegalCaseDialog.tsx#L223) | 1 | 223 | /collections |
| [web/src/pages/CollectionsPage/components/SendLineAdHocDialog.tsx](../../../apps/web/src/pages/CollectionsPage/components/SendLineAdHocDialog.tsx#L123) | 1 | 123 | /collections |
| [web/src/pages/CollectionsPage/components/StuckContractsSection.tsx](../../../apps/web/src/pages/CollectionsPage/components/StuckContractsSection.tsx#L214) | 1 | 214 | /collections |
| [web/src/pages/CollectionsPage/tabs/AllTab.tsx](../../../apps/web/src/pages/CollectionsPage/tabs/AllTab.tsx#L276) | 2 | 276, 285 | /collections |
| [web/src/pages/CommissionsPage.tsx](../../../apps/web/src/pages/CommissionsPage.tsx#L454) | 2 | 454, 542 | /commissions |
| [web/src/pages/CompanySettingsPage.tsx](../../../apps/web/src/pages/CompanySettingsPage.tsx#L476) | 1 | 476 | /settings/company/entities |
| [web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx](../../../apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx#L123) | 4 | 123, 263, 314, 333 | /contracts/create |
| [web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx](../../../apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx#L195) | 2 | 195, 223 | /contracts/create |
| [web/src/pages/ContractDetailPage.tsx](../../../apps/web/src/pages/ContractDetailPage.tsx#L732) | 1 | 732 | /contracts/:id |
| [web/src/pages/ContractsPage.tsx](../../../apps/web/src/pages/ContractsPage.tsx#L318) | 4 | 318, 416, 428, 447 | /contracts |
| [web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx](../../../apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx#L164) | 3 | 164, 325, 344 | /customers/:id |
| [web/src/pages/DocumentDashboardPage.tsx](../../../apps/web/src/pages/DocumentDashboardPage.tsx#L106) | 1 | 106 | /document-dashboard |
| [web/src/pages/DunningSettingsPage.tsx](../../../apps/web/src/pages/DunningSettingsPage.tsx#L665) | 2 | 665, 686 | /settings/comms/dunning |
| [web/src/pages/ETaxConfigPage.tsx](../../../apps/web/src/pages/ETaxConfigPage.tsx#L158) | 1 | 158 | /settings/accounting/e-tax |
| [web/src/pages/ETaxInvoicePage.tsx](../../../apps/web/src/pages/ETaxInvoicePage.tsx#L268) | 1 | 268 | ยังไม่ยืนยันทางเข้า |
| [web/src/pages/ExpenseDailySummaryPage.tsx](../../../apps/web/src/pages/ExpenseDailySummaryPage.tsx#L175) | 1 | 175 | /expenses/daily-summary |
| [web/src/pages/ExpenseFavoritesPage.tsx](../../../apps/web/src/pages/ExpenseFavoritesPage.tsx#L114) | 1 | 114 | /expenses/favorites |
| [web/src/pages/ExpensesPage.tsx](../../../apps/web/src/pages/ExpensesPage.tsx#L599) | 3 | 599, 640, 647 | /expenses |
| [web/src/pages/FinanceReceivablePage.tsx](../../../apps/web/src/pages/FinanceReceivablePage.tsx#L176) | 4 | 176, 453, 460, 467 | /finance-receivable |
| [web/src/pages/FinanceReceivablePage/FinanceContactLogDialog.tsx](../../../apps/web/src/pages/FinanceReceivablePage/FinanceContactLogDialog.tsx#L77) | 1 | 77 | /finance-receivable |
| [web/src/pages/ImportedSalesPage.tsx](../../../apps/web/src/pages/ImportedSalesPage.tsx#L62) | 1 | 62 | /imported-sales |
| [web/src/pages/InspectionPage.tsx](../../../apps/web/src/pages/InspectionPage.tsx#L126) | 1 | 126 | /inspections |
| [web/src/pages/MonthlyClosePage.tsx](../../../apps/web/src/pages/MonthlyClosePage.tsx#L379) | 1 | 379 | /monthly-close |
| [web/src/pages/NotificationsPage/components/NotificationLogTable.tsx](../../../apps/web/src/pages/NotificationsPage/components/NotificationLogTable.tsx#L113) | 2 | 113, 123 | /notifications |
| [web/src/pages/NotificationsPage/components/TemplateForm.tsx](../../../apps/web/src/pages/NotificationsPage/components/TemplateForm.tsx#L509) | 3 | 509, 525, 536 | /notifications |
| [web/src/pages/NotificationsPage/components/TemplateManager.tsx](../../../apps/web/src/pages/NotificationsPage/components/TemplateManager.tsx#L92) | 1 | 92 | /notifications |
| [web/src/pages/NotificationsPage/index.tsx](../../../apps/web/src/pages/NotificationsPage/index.tsx#L324) | 1 | 324 | /notifications |
| [web/src/pages/PDPAPage.tsx](../../../apps/web/src/pages/PDPAPage.tsx#L324) | 2 | 324, 414 | /pdpa |
| [web/src/pages/POSPage/components/SaleDetailsForm.tsx](../../../apps/web/src/pages/POSPage/components/SaleDetailsForm.tsx#L210) | 1 | 210 | /pos |
| [web/src/pages/PaymentsPage/components/PaymentFilters.tsx](../../../apps/web/src/pages/PaymentsPage/components/PaymentFilters.tsx#L46) | 2 | 46, 59 | /payments |
| [web/src/pages/PaymentsPage/components/PaymentModals.tsx](../../../apps/web/src/pages/PaymentsPage/components/PaymentModals.tsx#L261) | 2 | 261, 366 | /payments |
| [web/src/pages/PaymentsPage/components/ReceiptsTab.tsx](../../../apps/web/src/pages/PaymentsPage/components/ReceiptsTab.tsx#L366) | 1 | 366 | /payments |
| [web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx](../../../apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx#L1056) | 1 | 1056 | /payments |
| [web/src/pages/PeakSyncPage.tsx](../../../apps/web/src/pages/PeakSyncPage.tsx#L138) | 1 | 138 | /settings/accounting/peak-sync |
| [web/src/pages/PricingTemplatesPage.tsx](../../../apps/web/src/pages/PricingTemplatesPage.tsx#L303) | 4 | 303, 306, 402, 443 | /settings/products/pricing |
| [web/src/pages/ProductDetailPage/components/EditProductModal.tsx](../../../apps/web/src/pages/ProductDetailPage/components/EditProductModal.tsx#L101) | 3 | 101, 113, 257 | /products/:id |
| [web/src/pages/ProductDetailPage/components/OnlineListingPanel.tsx](../../../apps/web/src/pages/ProductDetailPage/components/OnlineListingPanel.tsx#L344) | 1 | 344 | /products/:id |
| [web/src/pages/ProductDetailPage/index.tsx](../../../apps/web/src/pages/ProductDetailPage/index.tsx#L604) | 1 | 604 | /products/:id |
| [web/src/pages/ProfitLossPage.tsx](../../../apps/web/src/pages/ProfitLossPage.tsx#L166) | 1 | 166 | /profit-loss |
| [web/src/pages/PromotionsPage.tsx](../../../apps/web/src/pages/PromotionsPage.tsx#L338) | 1 | 338 | /promotions |
| [web/src/pages/PurchaseOrdersPage/components/AccessoryGroupScreen.tsx](../../../apps/web/src/pages/PurchaseOrdersPage/components/AccessoryGroupScreen.tsx#L92) | 1 | 92 | /purchase-orders |
| [web/src/pages/PurchaseOrdersPage/components/UnitInspectScreen.tsx](../../../apps/web/src/pages/PurchaseOrdersPage/components/UnitInspectScreen.tsx#L338) | 1 | 338 | /purchase-orders |
| [web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx](../../../apps/web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx#L90) | 2 | 90, 111 | /purchase-orders |
| [web/src/pages/PurchaseOrdersPage/components/wizard/items/AccessoryItemRow.tsx](../../../apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/AccessoryItemRow.tsx#L113) | 2 | 113, 126 | /purchase-orders |
| [web/src/pages/PurchaseOrdersPage/components/wizard/items/DeviceItemRow.tsx](../../../apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/DeviceItemRow.tsx#L37) | 1 | 37 | /purchase-orders |
| [web/src/pages/PurchaseOrdersPage/components/wizard/items/RowChrome.tsx](../../../apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/RowChrome.tsx#L52) | 1 | 52 | /purchase-orders |
| [web/src/pages/QcCenterPage/index.tsx](../../../apps/web/src/pages/QcCenterPage/index.tsx#L158) | 2 | 158, 167 | /purchase-orders/qc |
| [web/src/pages/RepossessionsPage.tsx](../../../apps/web/src/pages/RepossessionsPage.tsx#L755) | 2 | 755, 1128 | /repossessions |
| [web/src/pages/SalesHistoryPage.tsx](../../../apps/web/src/pages/SalesHistoryPage.tsx#L660) | 5 | 660, 670, 680, 730, 741 | /sales |
| [web/src/pages/ShopDailyCashPage.tsx](../../../apps/web/src/pages/ShopDailyCashPage.tsx#L174) | 1 | 174 | /shop/daily-cash |
| [web/src/pages/SmsTemplatesPage/components/SmsTemplateForm.tsx](../../../apps/web/src/pages/SmsTemplatesPage/components/SmsTemplateForm.tsx#L93) | 1 | 93 | /settings/comms/sms |
| [web/src/pages/StockAdjustmentsPage/index.tsx](../../../apps/web/src/pages/StockAdjustmentsPage/index.tsx#L137) | 1 | 137 | /stock/adjustments |
| [web/src/pages/StockCountPage.tsx](../../../apps/web/src/pages/StockCountPage.tsx#L177) | 1 | 177 | /stock/count |
| [web/src/pages/StockPage/components/BulkTransferModal.tsx](../../../apps/web/src/pages/StockPage/components/BulkTransferModal.tsx#L59) | 1 | 59 | /stock/products |
| [web/src/pages/StockPage/components/StockListTab.tsx](../../../apps/web/src/pages/StockPage/components/StockListTab.tsx#L331) | 3 | 331, 353, 401 | /stock/products |
| [web/src/pages/StockTransfersPage.tsx](../../../apps/web/src/pages/StockTransfersPage.tsx#L377) | 3 | 377, 537, 654 | /stock/transfers |
| [web/src/pages/TodosPage/components/TodoForm.tsx](../../../apps/web/src/pages/TodosPage/components/TodoForm.tsx#L453) | 1 | 453 | /inbox/:roomId?<br>/todos |
| [web/src/pages/TradeInPage/components/AcceptModal.tsx](../../../apps/web/src/pages/TradeInPage/components/AcceptModal.tsx#L157) | 1 | 157 | /trade-in |
| [web/src/pages/TradeInPage/components/QuestionnaireTab.tsx](../../../apps/web/src/pages/TradeInPage/components/QuestionnaireTab.tsx#L239) | 1 | 239 | /trade-in |
| [web/src/pages/TradeInPage/components/ReferenceQuestionnaire.tsx](../../../apps/web/src/pages/TradeInPage/components/ReferenceQuestionnaire.tsx#L38) | 1 | 38 | /trade-in |
| [web/src/pages/TradeInPage/components/ValuationsTab.tsx](../../../apps/web/src/pages/TradeInPage/components/ValuationsTab.tsx#L195) | 1 | 195 | /trade-in |
| [web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.tsx#L189) | 2 | 189, 215 | /inbox/:roomId? |
| [web/src/pages/UnifiedInboxPage/components/ChatLibraryPicker.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/ChatLibraryPicker.tsx#L280) | 1 | 280 | /inbox/:roomId? |
| [web/src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.tsx#L214) | 2 | 214, 254 | /inbox/:roomId? |
| [web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.tsx#L113) | 2 | 113, 158 | /inbox/:roomId? |
| [web/src/pages/UnifiedInboxPage/components/FacebookCommentLink.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentLink.tsx#L102) | 1 | 102 | /inbox/:roomId? |
| [web/src/pages/UnifiedInboxPage/components/FacebookCommentPageSettings.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPageSettings.tsx#L166) | 1 | 166 | /chat-analytics<br>/inbox/:roomId? |
| [web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx#L108) | 1 | 108 | /inbox/:roomId? |
| [web/src/pages/UnifiedInboxPage/components/SalesDispositionControl.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/SalesDispositionControl.tsx#L93) | 1 | 93 | /inbox/:roomId? |
| [web/src/pages/UsersPage/UserDetailPage.tsx](../../../apps/web/src/pages/UsersPage/UserDetailPage.tsx#L221) | 3 | 221, 227, 268 | /users/:id<br>/users/new |
| [web/src/pages/UsersPage/components/InviteModal.tsx](../../../apps/web/src/pages/UsersPage/components/InviteModal.tsx#L121) | 2 | 121, 135 | /users |
| [web/src/pages/VatReportPage.tsx](../../../apps/web/src/pages/VatReportPage.tsx#L133) | 1 | 133 | ยังไม่ยืนยันทางเข้า |
| [web/src/pages/WhtReportPage.tsx](../../../apps/web/src/pages/WhtReportPage.tsx#L314) | 1 | 314 | /finance/wht-report |
| [web/src/pages/YearEndClosingPage.tsx](../../../apps/web/src/pages/YearEndClosingPage.tsx#L204) | 1 | 204 | /finance/year-end-closing |
| [web/src/pages/accounting/PeriodClosePage.tsx](../../../apps/web/src/pages/accounting/PeriodClosePage.tsx#L188) | 1 | 188 | /settings/accounting#periods |
| [web/src/pages/accounting/TaxDisallowedSummaryPage.tsx](../../../apps/web/src/pages/accounting/TaxDisallowedSummaryPage.tsx#L71) | 1 | 71 | /accounting/tax-disallowed-summary |
| [web/src/pages/after-sales/ExchangeActionDialogs.tsx](../../../apps/web/src/pages/after-sales/ExchangeActionDialogs.tsx#L360) | 1 | 360 | /after-sales<br>/after-sales/:id |
| [web/src/pages/after-sales/PricedExchangeFields.tsx](../../../apps/web/src/pages/after-sales/PricedExchangeFields.tsx#L142) | 1 | 142 | /after-sales/new |
| [web/src/pages/after-sales/RepairActionDialogs.tsx](../../../apps/web/src/pages/after-sales/RepairActionDialogs.tsx#L198) | 1 | 198 | /after-sales/:id |
| [web/src/pages/canned-response-admin/QuickReplyEditor.tsx](../../../apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx#L56) | 2 | 56, 81 | /canned-responses |
| [web/src/pages/canned-response-admin/bubble-editors/CardBubbleEditor.tsx](../../../apps/web/src/pages/canned-response-admin/bubble-editors/CardBubbleEditor.tsx#L73) | 1 | 73 | /canned-responses |
| [web/src/pages/equity/DividendRegisterPage.tsx](../../../apps/web/src/pages/equity/DividendRegisterPage.tsx#L68) | 2 | 68, 80 | /finance/dividend-register |
| [web/src/pages/equity/EquityEntryPage.tsx](../../../apps/web/src/pages/equity/EquityEntryPage.tsx#L254) | 3 | 254, 288, 385 | /finance/equity/:id/edit<br>/finance/equity/new |
| [web/src/pages/equity/EquityListPage.tsx](../../../apps/web/src/pages/equity/EquityListPage.tsx#L77) | 2 | 77, 197 | /finance/equity |
| [web/src/pages/interco/CreateBatchDialog.tsx](../../../apps/web/src/pages/interco/CreateBatchDialog.tsx#L221) | 2 | 221, 235 | /accounting/intercompany |
| [web/src/pages/other-income/OtherIncomeEntryPage.tsx](../../../apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx#L803) | 1 | 803 | /other-income/:id/edit<br>/other-income/new |
| [web/src/pages/other-income/components/ItemsTable.tsx](../../../apps/web/src/pages/other-income/components/ItemsTable.tsx#L137) | 2 | 137, 158 | /other-income/:id/edit<br>/other-income/new |
| [web/src/pages/settings/SettingsLayout.tsx](../../../apps/web/src/pages/settings/SettingsLayout.tsx#L112) | 1 | 112 | /settings/:categoryId |

## สถานะรอบนี้

เป็นการสำรวจและเก็บหลักฐาน ยังไม่ได้เปลี่ยน dropdown ที่เหลือ 206 ตำแหน่ง
ไม่ได้แก้ application source, ไม่ commit/push/deploy และไม่บันทึกข้อมูลธุรกิจ
preview ที่คงไว้: [หน้านัดหมายที่แก้ในรอบก่อน](http://localhost:5206/appointments?zone=shop)
ใช้ข้อมูลจำลอง; source fingerprint ยังตรงกับ local:check ที่ผ่านในรอบก่อน
