import type { Company } from './company-access';

/** Capability metadata only: route policies must also resolve and check source resources.
 * Public/customer/integration principals are deliberately outside this staff contract.
 * Read/export never imply sensitive access, and approvals never imply execution rights.
 */
const PERMISSION_GROUPS = {
  sales: 'การขายและลูกค้า',
  stock: 'สินค้าและจัดซื้อ',
  finance: 'การเงินและสินเชื่อ',
  collections: 'ติดตามหนี้',
  accounting: 'บัญชีและภาษี',
  communication: 'การสื่อสาร',
  people: 'บุคลากร',
  reports: 'รายงานและข้อมูล',
  system: 'ตั้งค่าและระบบ',
  sensitive: 'ข้อมูลสำคัญ',
  access: 'สิทธิ์และประวัติ',
} as const;

// [Thai label, editor group, authority]. No wildcard or audit-content mutation capability.
const PERMISSION_DEFINITIONS = {
  'dashboard.read': ['ดูภาพรวม', 'sales', 'GRANT'],
  'customers.read': ['ดูลูกค้า', 'sales', 'GRANT'],
  'customers.create': ['สร้างลูกค้า', 'sales', 'GRANT'],
  'customers.update': ['แก้ไขลูกค้า', 'sales', 'GRANT'],
  'customers.delete': ['ลบหรือปิดใช้งานลูกค้า', 'sales', 'GRANT'],
  'customers.export': ['ส่งออกลูกค้า', 'sales', 'GRANT'],
  'customer-tags.read': ['ดูแท็กลูกค้า', 'sales', 'GRANT'],
  'customer-tags.create': ['สร้างแท็กลูกค้า', 'sales', 'GRANT'],
  'customer-tags.update': ['แก้ไขแท็กลูกค้า', 'sales', 'GRANT'],
  'customer-tags.delete': ['ลบหรือปิดใช้งานแท็กลูกค้า', 'sales', 'GRANT'],
  'customer-journey.moderate': ['จัดการบันทึกเส้นทางของพนักงาน', 'sales', 'GRANT'],
  'customer-journey.read': ['ดูเส้นทางลูกค้า', 'sales', 'GRANT'],
  'contacts.read': ['ดูผู้ติดต่อ', 'sales', 'GRANT'],
  'contacts.create': ['สร้างผู้ติดต่อ', 'sales', 'GRANT'],
  'contacts.update': ['แก้ไขผู้ติดต่อ', 'sales', 'GRANT'],
  'contacts.delete': ['ลบหรือปิดใช้งานผู้ติดต่อ', 'sales', 'GRANT'],
  'contacts.export': ['ส่งออกผู้ติดต่อ', 'sales', 'GRANT'],
  'sales.read': ['ดูการขาย', 'sales', 'GRANT'],
  'sales.create': ['สร้างการขาย', 'sales', 'GRANT'],
  'sales.update': ['แก้ไขการขาย', 'sales', 'GRANT'],
  'sales.export': ['ส่งออกการขาย', 'sales', 'GRANT'],
  'bookings.read': ['ดูใบจอง', 'sales', 'GRANT'],
  'bookings.create': ['สร้างใบจอง', 'sales', 'GRANT'],
  'bookings.update': ['แก้ไขใบจอง', 'sales', 'GRANT'],
  'bookings.delete': ['ลบหรือปิดใช้งานใบจอง', 'sales', 'GRANT'],
  'contracts.read': ['ดูสัญญา', 'sales', 'GRANT'],
  'contracts.override-active-contract': ['ข้ามข้อจำกัดสัญญาที่กำลังผ่อน', 'sales', 'GRANT'],
  'products.sell-previously-damaged': ['ขายสินค้าที่เคยเสียหาย', 'stock', 'GRANT'],
  'contracts.create': ['สร้างสัญญา', 'sales', 'GRANT'],
  'contracts.update': ['แก้ไขสัญญา', 'sales', 'GRANT'],
  'contracts.activate': ['เปิดใช้งานสัญญา', 'sales', 'GRANT'],
  'contracts.approve': ['อนุมัติสัญญา', 'sales', 'GRANT'],
  'contracts.export': ['ส่งออกสัญญา', 'sales', 'GRANT'],
  'contract-documents.read': ['ดูเอกสารสัญญา', 'sales', 'GRANT'],
  'contract-documents.create': ['สร้างเอกสารสัญญา', 'sales', 'GRANT'],
  'contract-documents.update': ['แก้ไขเอกสารสัญญา', 'sales', 'GRANT'],
  'contract-documents.export': ['ส่งออกเอกสารสัญญา', 'sales', 'GRANT'],
  'contract-templates.read': ['ดูแบบสัญญา', 'sales', 'GRANT'],
  'contract-templates.create': ['สร้างแบบสัญญา', 'sales', 'GRANT'],
  'contract-templates.update': ['แก้ไขแบบสัญญา', 'sales', 'GRANT'],
  'contract-templates.delete': ['ลบหรือปิดใช้งานแบบสัญญา', 'sales', 'GRANT'],
  'contract-exchanges.read': ['ดูเปลี่ยนเครื่องตามสัญญา', 'sales', 'GRANT'],
  'contract-exchanges.create': ['สร้างเปลี่ยนเครื่องตามสัญญา', 'sales', 'GRANT'],
  'contract-exchanges.update': ['แก้ไขเปลี่ยนเครื่องตามสัญญา', 'sales', 'GRANT'],
  'contract-exchanges.approve': ['อนุมัติเปลี่ยนเครื่องตามสัญญา', 'sales', 'GRANT'],
  'defect-exchanges.read': ['ดูเปลี่ยนเครื่องบกพร่อง', 'sales', 'GRANT'],
  'defect-exchanges.create': ['สร้างเปลี่ยนเครื่องบกพร่อง', 'sales', 'GRANT'],
  'defect-exchanges.update': ['แก้ไขเปลี่ยนเครื่องบกพร่อง', 'sales', 'GRANT'],
  'defect-exchanges.approve': ['อนุมัติเปลี่ยนเครื่องบกพร่อง', 'sales', 'GRANT'],
  'after-sales.read': ['ดูงานหลังการขาย', 'sales', 'GRANT'],
  'after-sales.create': ['สร้างงานหลังการขาย', 'sales', 'GRANT'],
  'after-sales.update': ['แก้ไขงานหลังการขาย', 'sales', 'GRANT'],
  'after-sales.export': ['ส่งออกงานหลังการขาย', 'sales', 'GRANT'],
  'repair-tickets.read': ['ดูงานซ่อม', 'sales', 'GRANT'],
  'repair-tickets.create': ['สร้างงานซ่อม', 'sales', 'GRANT'],
  'repair-tickets.update': ['แก้ไขงานซ่อม', 'sales', 'GRANT'],
  'repair-tickets.approve': ['อนุมัติงานซ่อม', 'sales', 'GRANT'],
  'promotions.apply': ['ใช้โปรโมชันมาตรฐาน', 'sales', 'GRANT'],
  'promotions.read': ['ดูโปรโมชัน', 'sales', 'GRANT'],
  'loyalty.account.read': ['ดูยอดแต้มที่ใช้ได้ทั้งบัญชี', 'sales', 'GRANT'],
  'loyalty.account.redeem': ['ใช้แต้มจากบัญชีสะสม', 'sales', 'GRANT'],
  'loyalty.read': ['ดูสมาชิกและแต้ม', 'sales', 'GRANT'],
  'loyalty.create': ['สร้างสมาชิกและแต้ม', 'sales', 'GRANT'],
  'loyalty.update': ['แก้ไขสมาชิกและแต้ม', 'sales', 'GRANT'],
  'shop-orders.read': ['ดูคำสั่งซื้อออนไลน์', 'sales', 'GRANT'],
  'shop-orders.create': ['สร้างคำสั่งซื้อออนไลน์', 'sales', 'GRANT'],
  'shop-orders.update': ['แก้ไขคำสั่งซื้อออนไลน์', 'sales', 'GRANT'],
  'shop-orders.export': ['ส่งออกคำสั่งซื้อออนไลน์', 'sales', 'GRANT'],
  'shop-cs.read': ['ดูบริการลูกค้าออนไลน์', 'sales', 'GRANT'],
  'shop-cs.update': ['แก้ไขบริการลูกค้าออนไลน์', 'sales', 'GRANT'],
  'shop-reviews.read': ['ดูรีวิวสินค้า', 'sales', 'GRANT'],
  'shop-reviews.update': ['แก้ไขรีวิวสินค้า', 'sales', 'GRANT'],
  'shop-tenders.count': ['นับเงินปิดยอดหน้าร้าน', 'sales', 'GRANT'],
  'shop-tenders.confirm': ['ยืนยันหรือตีกลับยอดเงินหน้าร้าน', 'sales', 'GRANT'],
  'shop-tenders.deposit': ['บันทึกนำฝากเงินหน้าร้าน', 'sales', 'GRANT'],
  'shop-tenders.deposit-owner-hold': ['นำฝากเงินที่เจ้าของเก็บรักษา', 'sales', 'GRANT'],
  'shop-tenders.read': ['ดูช่องทางจ่ายหน้าร้าน', 'sales', 'GRANT'],
  'shop-tenders.create': ['สร้างช่องทางจ่ายหน้าร้าน', 'sales', 'GRANT'],
  'shop-tenders.update': ['แก้ไขช่องทางจ่ายหน้าร้าน', 'sales', 'GRANT'],
  'imported-sales.read': ['ดูยอดขายนำเข้า', 'sales', 'GRANT'],
  'imported-sales.import': ['นำเข้ายอดขายนำเข้า', 'sales', 'GRANT'],
  'imported-sales.export': ['ส่งออกยอดขายนำเข้า', 'sales', 'GRANT'],
  'products.read': ['ดูสินค้า', 'stock', 'GRANT'],
  'products.create': ['สร้างสินค้า', 'stock', 'GRANT'],
  'products.cost.update': ['แก้ไขต้นทุนสินค้า', 'stock', 'GRANT'],
  'products.update': ['แก้ไขสินค้า', 'stock', 'GRANT'],
  'products.delete': ['ลบหรือปิดใช้งานสินค้า', 'stock', 'GRANT'],
  'products.export': ['ส่งออกสินค้า', 'stock', 'GRANT'],
  'inventory.read': ['ดูสต็อก', 'stock', 'GRANT'],
  'inventory.export': ['ส่งออกสต็อก', 'stock', 'GRANT'],
  'stock-receiving.read': ['ดูรับสินค้า', 'stock', 'GRANT'],
  'stock-receiving.create': ['สร้างรับสินค้า', 'stock', 'GRANT'],
  'stock-receiving.update': ['แก้ไขรับสินค้า', 'stock', 'GRANT'],
  'stock-count.read': ['ดูตรวจนับสินค้า', 'stock', 'GRANT'],
  'stock-count.create': ['สร้างตรวจนับสินค้า', 'stock', 'GRANT'],
  'stock-count.update': ['แก้ไขตรวจนับสินค้า', 'stock', 'GRANT'],
  'stock-count.approve': ['อนุมัติตรวจนับสินค้า', 'stock', 'GRANT'],
  'stock-transfers.read': ['ดูโอนสินค้า', 'stock', 'GRANT'],
  'stock-transfers.create': ['สร้างโอนสินค้า', 'stock', 'GRANT'],
  'stock-transfers.update': ['แก้ไขโอนสินค้า', 'stock', 'GRANT'],
  'stock-transfers.approve': ['อนุมัติโอนสินค้า', 'stock', 'GRANT'],
  'stock-transfers.receive': ['รับโอนสินค้า', 'stock', 'GRANT'],
  'stock-adjustments.read': ['ดูปรับสต็อก', 'stock', 'GRANT'],
  'stock-adjustments.create': ['สร้างปรับสต็อก', 'stock', 'GRANT'],
  'inventory-forecast.read': ['ดูพยากรณ์สต็อก', 'stock', 'GRANT'],
  'reorder-points.read': ['ดูจุดสั่งซื้อ', 'stock', 'GRANT'],
  'reorder-points.update': ['แก้ไขจุดสั่งซื้อ', 'stock', 'GRANT'],
  'suppliers.read': ['ดูผู้ขาย', 'stock', 'GRANT'],
  'suppliers.create': ['สร้างผู้ขาย', 'stock', 'GRANT'],
  'suppliers.update': ['แก้ไขผู้ขาย', 'stock', 'GRANT'],
  'suppliers.delete': ['ลบหรือปิดใช้งานผู้ขาย', 'stock', 'GRANT'],
  'suppliers.export': ['ส่งออกผู้ขาย', 'stock', 'GRANT'],
  'purchase-orders.read': ['ดูใบสั่งซื้อ', 'stock', 'GRANT'],
  'purchase-orders.create': ['สร้างใบสั่งซื้อ', 'stock', 'GRANT'],
  'purchase-orders.update': ['แก้ไขใบสั่งซื้อ', 'stock', 'GRANT'],
  'purchase-orders.approve': ['อนุมัติใบสั่งซื้อ', 'stock', 'GRANT'],
  'supplier-payments.read': ['ดูการจ่ายเงินผู้จัดจำหน่าย', 'stock', 'GRANT'],
  'supplier-payments.create': ['บันทึกการจ่ายเงินผู้จัดจำหน่าย', 'stock', 'GRANT'],
  'supplier-payments.void': ['ยกเลิกการจ่ายเงินผู้จัดจำหน่าย', 'stock', 'OWNER'],
  'purchase-orders.export': ['ส่งออกใบสั่งซื้อ', 'stock', 'GRANT'],
  'trade-in.read': ['ดูรับซื้อเครื่อง', 'stock', 'GRANT'],
  'trade-in.create': ['สร้างรับซื้อเครื่อง', 'stock', 'GRANT'],
  'trade-in.update': ['แก้ไขรับซื้อเครื่อง', 'stock', 'GRANT'],
  'trade-in.approve': ['อนุมัติรับซื้อเครื่อง', 'stock', 'GRANT'],
  'trade-in.export': ['ส่งออกรับซื้อเครื่อง', 'stock', 'GRANT'],
  'inspections.read': ['ดูตรวจสภาพสินค้า', 'stock', 'GRANT'],
  'inspections.create': ['สร้างตรวจสภาพสินค้า', 'stock', 'GRANT'],
  'inspections.update': ['แก้ไขตรวจสภาพสินค้า', 'stock', 'GRANT'],
  'product-photos.read': ['ดูรูปสินค้า', 'stock', 'GRANT'],
  'product-photos.create': ['สร้างรูปสินค้า', 'stock', 'GRANT'],
  'product-photos.update': ['แก้ไขรูปสินค้า', 'stock', 'GRANT'],
  'product-photos.delete': ['ลบหรือปิดใช้งานรูปสินค้า', 'stock', 'GRANT'],
  'pricing.read': ['ดูราคาขาย', 'stock', 'GRANT'],
  'pricing.update': ['แก้ไขราคาขาย', 'stock', 'GRANT'],
  'stickers.read': ['ดูสติกเกอร์สินค้า', 'stock', 'GRANT'],
  'stickers.create': ['สร้างข้อมูลสติกเกอร์จากสินค้า', 'stock', 'GRANT'],
  'sticker-templates.create': ['สร้างแม่แบบสติกเกอร์ร่วมทุกส่วนงาน', 'stock', 'GRANT'],
  'sticker-templates.update': ['แก้ไขแม่แบบสติกเกอร์ร่วมทุกส่วนงาน', 'stock', 'GRANT'],
  'sticker-templates.delete': ['ปิดแม่แบบสติกเกอร์ร่วมทุกส่วนงาน', 'stock', 'GRANT'],
  'pricing-templates.update': ['จัดการราคาตั้งต้นร่วมทุกส่วนงาน', 'stock', 'GRANT'],
  'stickers.export': ['ส่งออกสติกเกอร์สินค้า', 'stock', 'GRANT'],
  'credit-checks.read': ['ดูตรวจเครดิต', 'finance', 'GRANT'],
  'credit-checks.create': ['สร้างตรวจเครดิต', 'finance', 'GRANT'],
  'credit-checks.update': ['แก้ไขตรวจเครดิต', 'finance', 'GRANT'],
  'credit-checks.approve': ['อนุมัติตรวจเครดิต', 'finance', 'GRANT'],
  'external-finance.read': ['ดูไฟแนนซ์ภายนอก', 'finance', 'GRANT'],
  'external-finance.create': ['สร้างไฟแนนซ์ภายนอก', 'finance', 'GRANT'],
  'external-finance.update': ['แก้ไขไฟแนนซ์ภายนอก', 'finance', 'GRANT'],
  'external-finance.approve': ['อนุมัติไฟแนนซ์ภายนอก', 'finance', 'GRANT'],
  'external-finance.export': ['ส่งออกไฟแนนซ์ภายนอก', 'finance', 'GRANT'],
  'finance-applications.read': ['ดูใบสมัครไฟแนนซ์', 'finance', 'GRANT'],
  'finance-applications.create': ['สร้างใบสมัครไฟแนนซ์', 'finance', 'GRANT'],
  'finance-applications.update': ['แก้ไขใบสมัครไฟแนนซ์', 'finance', 'GRANT'],
  'finance-applications.approve': ['อนุมัติใบสมัครไฟแนนซ์', 'finance', 'GRANT'],
  'finance-applications.share': ['แชร์ใบสมัครไฟแนนซ์', 'finance', 'GRANT'],
  'finance-contacts.read': ['ดูผู้ติดต่อไฟแนนซ์', 'finance', 'GRANT'],
  'finance-contacts.create': ['สร้างผู้ติดต่อไฟแนนซ์', 'finance', 'GRANT'],
  'finance-contacts.update': ['แก้ไขผู้ติดต่อไฟแนนซ์', 'finance', 'GRANT'],
  'finance-contacts.delete': ['ลบหรือปิดใช้งานผู้ติดต่อไฟแนนซ์', 'finance', 'GRANT'],
  'finance-receivables.read': ['ดูลูกหนี้การเงิน', 'finance', 'GRANT'],
  'finance-receivables.update': ['แก้ไขลูกหนี้การเงิน', 'finance', 'GRANT'],
  'finance-receivables.export': ['ส่งออกลูกหนี้การเงิน', 'finance', 'GRANT'],
  'payments.read': ['ดูรับชำระ', 'finance', 'GRANT'],
  'payments.create': ['สร้างรับชำระ', 'finance', 'GRANT'],
  'payments.update': ['แก้ไขรับชำระ', 'finance', 'GRANT'],
  'payments.approve': ['อนุมัติรับชำระ', 'finance', 'GRANT'],
  'payments.import': ['นำเข้ารับชำระ', 'finance', 'GRANT'],
  'payments.export': ['ส่งออกรับชำระ', 'finance', 'GRANT'],
  'receipts.read': ['ดูใบเสร็จ', 'finance', 'GRANT'],
  'receipts.create': ['สร้างใบเสร็จ', 'finance', 'GRANT'],
  'receipts.export': ['ส่งออกใบเสร็จ', 'finance', 'GRANT'],
  'refunds.read': ['ดูคืนเงิน', 'finance', 'GRANT'],
  'refunds.request': ['ขอคืนเงิน', 'finance', 'GRANT'],
  'refunds.execute': ['ดำเนินการตามอนุมัติคืนเงิน', 'finance', 'GRANT'],
  'bank-accounts.read': ['ดูบัญชีธนาคารและเงินสด', 'finance', 'GRANT'],
  'bank-accounts.create': ['สร้างบัญชีธนาคารและเงินสด', 'finance', 'GRANT'],
  'bank-accounts.update': ['แก้ไขบัญชีธนาคารและเงินสด', 'finance', 'GRANT'],
  'bank-accounts.delete': ['ลบหรือปิดใช้งานบัญชีธนาคารและเงินสด', 'finance', 'GRANT'],
  'intercompany.read': ['ดูรายการระหว่างบริษัท', 'finance', 'GRANT'],
  'intercompany.create': ['สร้างรายการระหว่างบริษัท', 'finance', 'GRANT'],
  'intercompany.update': ['แก้ไขรายการระหว่างบริษัท', 'finance', 'GRANT'],
  'intercompany.approve': ['อนุมัติรายการระหว่างบริษัท', 'finance', 'GRANT'],
  'intercompany.export': ['ส่งออกรายการระหว่างบริษัท', 'finance', 'GRANT'],
  'interco-settlements.read': ['ดูชำระระหว่างบริษัท', 'finance', 'GRANT'],
  'interco-settlements.create': ['สร้างชำระระหว่างบริษัท', 'finance', 'GRANT'],
  'interco-settlements.approve': ['อนุมัติชำระระหว่างบริษัท', 'finance', 'GRANT'],
  'commissions.read': ['ดูค่าคอมมิชชัน', 'finance', 'GRANT'],
  'commissions.create': ['สร้างค่าคอมมิชชัน', 'finance', 'GRANT'],
  'commissions.update': ['แก้ไขค่าคอมมิชชัน', 'finance', 'GRANT'],
  'commissions.approve': ['อนุมัติค่าคอมมิชชัน', 'finance', 'GRANT'],
  'commissions.export': ['ส่งออกค่าคอมมิชชัน', 'finance', 'GRANT'],
  'collections.read': ['ดูเคสติดตามหนี้', 'collections', 'GRANT'],
  'collections.create': ['สร้างเคสติดตามหนี้', 'collections', 'GRANT'],
  'collections.update': ['แก้ไขเคสติดตามหนี้', 'collections', 'GRANT'],
  'collections.export': ['ส่งออกเคสติดตามหนี้', 'collections', 'GRANT'],
  'collection-contacts.read': ['ดูบันทึกติดตามหนี้', 'collections', 'GRANT'],
  'collection-contacts.create': ['สร้างบันทึกติดตามหนี้', 'collections', 'GRANT'],
  'collection-contacts.update': ['แก้ไขบันทึกติดตามหนี้', 'collections', 'GRANT'],
  'payment-promises.read': ['ดูนัดชำระ', 'collections', 'GRANT'],
  'payment-promises.create': ['สร้างนัดชำระ', 'collections', 'GRANT'],
  'payment-promises.update': ['แก้ไขนัดชำระ', 'collections', 'GRANT'],
  'letters.read': ['ดูเอกสารติดตาม', 'collections', 'GRANT'],
  'letters.create': ['สร้างเอกสารติดตาม', 'collections', 'GRANT'],
  'letters.approve': ['อนุมัติเอกสารติดตาม', 'collections', 'GRANT'],
  'letters.export': ['ส่งออกเอกสารติดตาม', 'collections', 'GRANT'],
  'letters.send': ['ส่งเอกสารติดตาม', 'collections', 'GRANT'],
  'repossessions.read': ['ดูยึดคืนเครื่อง', 'collections', 'GRANT'],
  'repossessions.create': ['สร้างยึดคืนเครื่อง', 'collections', 'GRANT'],
  'repossessions.update': ['แก้ไขยึดคืนเครื่อง', 'collections', 'GRANT'],
  'repossessions.approve': ['อนุมัติยึดคืนเครื่อง', 'collections', 'GRANT'],
  'repossessions.export': ['ส่งออกยึดคืนเครื่อง', 'collections', 'GRANT'],
  'device-returns.read': ['ดูใบรับเครื่องคืน', 'collections', 'GRANT'],
  'device-returns.create': ['สร้างใบรับเครื่องคืน', 'collections', 'GRANT'],
  'device-returns.update': ['แก้ไขใบรับเครื่องคืน', 'collections', 'GRANT'],
  'device-returns.approve': ['อนุมัติใบรับเครื่องคืน', 'collections', 'GRANT'],
  'legal-cases.read': ['ดูคดี', 'collections', 'GRANT'],
  'legal-cases.create': ['สร้างคดี', 'collections', 'GRANT'],
  'legal-cases.update': ['แก้ไขคดี', 'collections', 'GRANT'],
  'legal-cases.export': ['ส่งออกคดี', 'collections', 'GRANT'],
  'mdm.read': ['ดูจัดการอุปกรณ์', 'collections', 'GRANT'],
  'mdm.command': ['สั่งงานจัดการอุปกรณ์', 'collections', 'GRANT'],
  'mdm.approve': ['อนุมัติจัดการอุปกรณ์', 'collections', 'GRANT'],
  'accounting.read': ['ดูเอกสารบัญชี', 'accounting', 'GRANT'],
  'accounting.create': ['สร้างเอกสารบัญชี', 'accounting', 'GRANT'],
  'accounting.update': ['แก้ไขเอกสารบัญชี', 'accounting', 'GRANT'],
  'accounting.export': ['ส่งออกเอกสารบัญชี', 'accounting', 'GRANT'],
  'accounting.close': ['ปิดงวดเอกสารบัญชี', 'accounting', 'GRANT'],
  'journal.read': ['ดูสมุดรายวัน', 'accounting', 'GRANT'],
  'journal.create': ['สร้างสมุดรายวัน', 'accounting', 'GRANT'],
  'journal.update': ['แก้ไขสมุดรายวัน', 'accounting', 'GRANT'],
  'journal.delete': ['ลบหรือปิดใช้งานสมุดรายวัน', 'accounting', 'GRANT'],
  'journal.approve': ['อนุมัติสมุดรายวัน', 'accounting', 'GRANT'],
  'journal.post': ['ลงบัญชีสมุดรายวัน', 'accounting', 'GRANT'],
  'journal.reverse': ['กลับรายการสมุดรายวัน', 'accounting', 'GRANT'],
  'journal.export': ['ส่งออกสมุดรายวัน', 'accounting', 'GRANT'],
  'reconciliation.read': ['ดูกระทบยอด', 'accounting', 'GRANT'],
  'reconciliation.create': ['สร้างกระทบยอด', 'accounting', 'GRANT'],
  'reconciliation.update': ['แก้ไขกระทบยอด', 'accounting', 'GRANT'],
  'reconciliation.approve': ['อนุมัติกระทบยอด', 'accounting', 'GRANT'],
  'reconciliation.export': ['ส่งออกกระทบยอด', 'accounting', 'GRANT'],
  'tax.read': ['ดูภาษี', 'accounting', 'GRANT'],
  'tax.create': ['สร้างภาษี', 'accounting', 'GRANT'],
  'tax.update': ['แก้ไขภาษี', 'accounting', 'GRANT'],
  'tax.approve': ['อนุมัติภาษี', 'accounting', 'GRANT'],
  'tax.export': ['ส่งออกภาษี', 'accounting', 'GRANT'],
  'e-tax.read': ['ดูเอกสารภาษีอิเล็กทรอนิกส์', 'accounting', 'GRANT'],
  'e-tax.create': ['สร้างเอกสารภาษีอิเล็กทรอนิกส์', 'accounting', 'GRANT'],
  'e-tax.export': ['ส่งออกเอกสารภาษีอิเล็กทรอนิกส์', 'accounting', 'GRANT'],
  'e-tax.send': ['ส่งเอกสารภาษีอิเล็กทรอนิกส์', 'accounting', 'GRANT'],
  'chart-of-accounts.read': ['ดูผังบัญชี', 'accounting', 'GRANT'],
  'chart-of-accounts.create': ['สร้างผังบัญชี', 'accounting', 'GRANT'],
  'chart-of-accounts.update': ['แก้ไขผังบัญชี', 'accounting', 'GRANT'],
  'chart-of-accounts.delete': ['ลบหรือปิดใช้งานผังบัญชี', 'accounting', 'GRANT'],
  'expenses.read': ['ดูเอกสารรายจ่าย', 'accounting', 'GRANT'],
  'expenses.create': ['สร้างเอกสารรายจ่าย', 'accounting', 'GRANT'],
  'expenses.update': ['แก้ไขเอกสารรายจ่าย', 'accounting', 'GRANT'],
  'expenses.delete': ['ลบหรือปิดใช้งานเอกสารรายจ่าย', 'accounting', 'GRANT'],
  'expenses.approve': ['อนุมัติเอกสารรายจ่าย', 'accounting', 'GRANT'],
  'expenses.post': ['ลงบัญชีเอกสารรายจ่าย', 'accounting', 'GRANT'],
  'expenses.reverse': ['กลับรายการเอกสารรายจ่าย', 'accounting', 'GRANT'],
  'expenses.export': ['ส่งออกเอกสารรายจ่าย', 'accounting', 'GRANT'],
  'other-income.read': ['ดูรายรับอื่น', 'accounting', 'GRANT'],
  'other-income.create': ['สร้างรายรับอื่น', 'accounting', 'GRANT'],
  'other-income.update': ['แก้ไขรายรับอื่น', 'accounting', 'GRANT'],
  'other-income.delete': ['ลบหรือปิดใช้งานรายรับอื่น', 'accounting', 'GRANT'],
  'other-income.approve': ['อนุมัติรายรับอื่น', 'accounting', 'GRANT'],
  'other-income.post': ['ลงบัญชีรายรับอื่น', 'accounting', 'GRANT'],
  'other-income.reverse': ['กลับรายการรายรับอื่น', 'accounting', 'GRANT'],
  'other-income.export': ['ส่งออกรายรับอื่น', 'accounting', 'GRANT'],
  'assets.read': ['ดูสินทรัพย์', 'accounting', 'GRANT'],
  'assets.create': ['สร้างสินทรัพย์', 'accounting', 'GRANT'],
  'assets.update': ['แก้ไขสินทรัพย์', 'accounting', 'GRANT'],
  'assets.delete': ['ลบหรือปิดใช้งานสินทรัพย์', 'accounting', 'GRANT'],
  'assets.approve': ['อนุมัติสินทรัพย์', 'accounting', 'GRANT'],
  'assets.post': ['ลงบัญชีสินทรัพย์', 'accounting', 'GRANT'],
  'assets.reverse': ['กลับรายการสินทรัพย์', 'accounting', 'GRANT'],
  'assets.export': ['ส่งออกสินทรัพย์', 'accounting', 'GRANT'],
  'asset-transfers.read': ['ดูโอนสินทรัพย์', 'accounting', 'GRANT'],
  'asset-transfers.create': ['สร้างโอนสินทรัพย์', 'accounting', 'GRANT'],
  'asset-transfers.approve': ['อนุมัติโอนสินทรัพย์', 'accounting', 'GRANT'],
  'depreciation.read': ['ดูค่าเสื่อมราคา', 'accounting', 'GRANT'],
  'depreciation.create': ['สร้างค่าเสื่อมราคา', 'accounting', 'GRANT'],
  'depreciation.post': ['ลงบัญชีค่าเสื่อมราคา', 'accounting', 'GRANT'],
  'depreciation.reverse': ['กลับรายการค่าเสื่อมราคา', 'accounting', 'GRANT'],
  'depreciation.export': ['ส่งออกค่าเสื่อมราคา', 'accounting', 'GRANT'],
  'equity.read': ['ดูส่วนทุน', 'accounting', 'GRANT'],
  'equity.create': ['สร้างส่วนทุน', 'accounting', 'GRANT'],
  'equity.update': ['แก้ไขส่วนทุน', 'accounting', 'GRANT'],
  'equity.approve': ['อนุมัติส่วนทุน', 'accounting', 'GRANT'],
  'equity.export': ['ส่งออกส่วนทุน', 'accounting', 'GRANT'],
  'peak.read': ['ดูเชื่อมบัญชี PEAK', 'accounting', 'GRANT'],
  'peak.sync': ['ซิงก์เชื่อมบัญชี PEAK', 'accounting', 'GRANT'],
  'peak.export': ['ส่งออกเชื่อมบัญชี PEAK', 'accounting', 'GRANT'],
  'financial-audit.read': ['ดูตรวจสอบบัญชี', 'accounting', 'GRANT'],
  'financial-audit.export': ['ส่งออกตรวจสอบบัญชี', 'accounting', 'GRANT'],
  'chat.read': ['ดูแชท', 'communication', 'GRANT'],
  'chat.create': ['สร้างแชท', 'communication', 'GRANT'],
  'chat.update': ['แก้ไขแชท', 'communication', 'GRANT'],
  'chat.send': ['ส่งแชท', 'communication', 'GRANT'],
  'chat.export': ['ส่งออกแชท', 'communication', 'GRANT'],
  'chat-assignment.update': ['แก้ไขมอบหมายแชท', 'communication', 'GRANT'],
  'chat-library.read': ['ดูคลังข้อความ', 'communication', 'GRANT'],
  'chat-library.create': ['สร้างคลังข้อความ', 'communication', 'GRANT'],
  'chat-library.update': ['แก้ไขคลังข้อความ', 'communication', 'GRANT'],
  'chat-library.delete': ['ลบหรือปิดใช้งานคลังข้อความ', 'communication', 'GRANT'],
  'chat-ai.read': ['ดูผู้ช่วยแชท', 'communication', 'GRANT'],
  'chat-ai.create': ['สร้างผู้ช่วยแชท', 'communication', 'GRANT'],
  'chat-analytics.read': ['ดูสถิติแชท', 'communication', 'GRANT'],
  'chat-analytics.export': ['ส่งออกสถิติแชท', 'communication', 'GRANT'],
  'facebook-comments.read': ['ดูความคิดเห็นเฟซบุ๊ก', 'communication', 'GRANT'],
  'facebook-comments.update': ['แก้ไขความคิดเห็นเฟซบุ๊ก', 'communication', 'GRANT'],
  'facebook-comments.send': ['ส่งความคิดเห็นเฟซบุ๊ก', 'communication', 'GRANT'],
  'line-campaigns.read': ['ดูแคมเปญไลน์', 'communication', 'GRANT'],
  'line-campaigns.create': ['สร้างแคมเปญไลน์', 'communication', 'GRANT'],
  'line-campaigns.update': ['แก้ไขแคมเปญไลน์', 'communication', 'GRANT'],
  'line-campaigns.approve': ['อนุมัติแคมเปญไลน์', 'communication', 'GRANT'],
  'line-campaigns.send': ['ส่งแคมเปญไลน์', 'communication', 'GRANT'],
  'notifications.read': ['ดูแจ้งเตือน', 'communication', 'GRANT'],
  'notifications.update': ['แก้ไขแจ้งเตือน', 'communication', 'GRANT'],
  'notifications.send': ['ส่งแจ้งเตือน', 'communication', 'GRANT'],
  'calls.read': ['ดูการโทร', 'communication', 'GRANT'],
  'calls.create': ['สร้างการโทร', 'communication', 'GRANT'],
  'calls.export': ['ส่งออกการโทร', 'communication', 'GRANT'],
  'csat.read': ['ดูความพึงพอใจ', 'communication', 'GRANT'],
  'csat.export': ['ส่งออกความพึงพอใจ', 'communication', 'GRANT'],
  'employees.read': ['ดูพนักงาน', 'people', 'GRANT'],
  'todos.read': ['ดูรายการงาน', 'people', 'GRANT'],
  'todos.create': ['สร้างรายการงาน', 'people', 'GRANT'],
  'todos.update': ['แก้ไขรายการงาน', 'people', 'GRANT'],
  'todos.delete': ['ลบหรือปิดใช้งานรายการงาน', 'people', 'GRANT'],
  'reports.read': ['ดูรายงาน', 'reports', 'GRANT'],
  'reports.export': ['ส่งออกรายงาน', 'reports', 'GRANT'],
  'analytics.read': ['ดูวิเคราะห์ข้อมูล', 'reports', 'GRANT'],
  'analytics.export': ['ส่งออกวิเคราะห์ข้อมูล', 'reports', 'GRANT'],
  'search.read': ['ดูค้นหาข้อมูล', 'reports', 'GRANT'],
  'documents.read': ['ดูเอกสารและไฟล์', 'reports', 'GRANT'],
  'documents.create': ['สร้างเอกสารและไฟล์', 'reports', 'GRANT'],
  'documents.update': ['แก้ไขเอกสารและไฟล์', 'reports', 'GRANT'],
  'documents.export': ['ส่งออกเอกสารและไฟล์', 'reports', 'GRANT'],
  'documents.share': ['แชร์เอกสารและไฟล์', 'reports', 'GRANT'],
  'ocr.create': ['สร้างอ่านเอกสารอัตโนมัติ', 'reports', 'GRANT'],
  'data-audit.read': ['ดูตรวจสอบข้อมูล', 'reports', 'GRANT'],
  'data-audit.export': ['ส่งออกตรวจสอบข้อมูล', 'reports', 'GRANT'],
  'pdpa.read': ['ดูข้อมูลส่วนบุคคล', 'reports', 'GRANT'],
  'pdpa.export': ['ส่งออกข้อมูลส่วนบุคคล', 'reports', 'GRANT'],
  'branches.read': ['ดูสาขา', 'system', 'GRANT'],
  'company.read': ['ดูบริษัท', 'system', 'GRANT'],
  'settings.read': ['ดูตั้งค่าทั่วไป', 'system', 'GRANT'],
  'settings.update': ['แก้ไขตั้งค่าทั่วไป', 'system', 'GRANT'],
  'system-status.read': ['ดูสถานะระบบ', 'system', 'GRANT'],
  'ai-usage.read': ['ดูการใช้เอไอ', 'system', 'GRANT'],
  'ai-usage.export': ['ส่งออกการใช้เอไอ', 'system', 'GRANT'],
  'migration.read': ['ดูย้ายข้อมูล', 'system', 'GRANT'],
  'activity.export': ['ส่งออกสรุปประวัติกิจกรรม', 'access', 'GRANT'],
  'discounts.request': ['ขอส่วนลดนอกโปร', 'sales', 'GRANT'],
  'discounts.approve': ['อนุมัติส่วนลดภายในเพดาน', 'sales', 'GRANT'],
  'sales.cancel.request': ['ขอยกเลิกการขาย', 'sales', 'GRANT'],
  'sales.cancel.approve': ['อนุมัติยกเลิกการขาย', 'sales', 'OWNER'],
  'refunds.approve': ['อนุมัติคืนเงิน', 'finance', 'OWNER'],
  'interest-reductions.request': ['ขอลดดอกเบี้ย', 'finance', 'GRANT'],
  'interest-reductions.approve': ['อนุมัติลดดอกเบี้ย', 'finance', 'OWNER'],
  'penalty-waivers.request': ['ขอยกเว้นค่าปรับ', 'finance', 'GRANT'],
  'penalty-waivers.approve': ['อนุมัติยกเว้นค่าปรับ', 'finance', 'OWNER'],
  'sensitive.seller-bank.read': ['ดูเลขบัญชีรับเงินของผู้ขาย', 'sensitive', 'GRANT'],
  'sensitive.customer-identity.read': [
    'ดูเลขประจำตัวลูกค้าและผู้ปกครองเต็มเลข',
    'sensitive',
    'GRANT',
  ],
  'sensitive.cost.read': ['ดูราคาซื้อและต้นทุน', 'sensitive', 'GRANT'],
  'sensitive.profit.read': ['ดูรายงานกำไร', 'sensitive', 'GRANT'],
  'sensitive.salary.read': ['ดูข้อมูลเงินเดือน', 'sensitive', 'GRANT'],
  'activity.read': ['ดูสรุปประวัติกิจกรรมของพนักงานทุกคน', 'access', 'STAFF'],
  'users.manage': ['จัดการบัญชีผู้ใช้', 'access', 'OWNER'],
  'positions.manage': ['จัดการตำแหน่งและสิทธิ์', 'access', 'OWNER'],
  'assignments.manage': ['มอบหมายตำแหน่งและขอบเขต', 'access', 'OWNER'],
  'discounts.configure': ['ตั้งค่าเพดานส่วนลด', 'sales', 'OWNER'],
  'promotions.manage': ['จัดการโปรโมชัน', 'sales', 'OWNER'],
  'stock-adjustments.approve': ['อนุมัติปรับสต็อก', 'stock', 'OWNER'],
  'employees.manage': ['จัดการข้อมูลพนักงาน', 'people', 'OWNER'],
  'branches.manage': ['จัดการสาขา', 'system', 'OWNER'],
  'company.manage': ['จัดการบริษัท', 'system', 'OWNER'],
  'integrations.manage': ['จัดการการเชื่อมต่อและข้อมูลลับ', 'system', 'OWNER'],
  'security.manage': ['จัดการความปลอดภัยและเอสเอสโอ', 'system', 'OWNER'],
  'interest-configs.read': ['ดูตารางดอกเบี้ยส่วนกลาง', 'system', 'GRANT'],
  'settings.finance.manage': ['ตั้งค่านโยบายการเงิน', 'system', 'OWNER'],
  'settings.accounting.manage': ['ตั้งค่านโยบายบัญชี', 'system', 'OWNER'],
  'settings.communication.manage': ['ตั้งค่าการสื่อสาร', 'system', 'OWNER'],
  'settings.ai.manage': ['ตั้งค่าเอไอ', 'system', 'OWNER'],
  'settings.documents.manage': ['ตั้งค่าเอกสาร', 'system', 'OWNER'],
  'backup.manage': ['จัดการสำรองข้อมูล', 'system', 'OWNER'],
  'migration.execute': ['ดำเนินการย้ายข้อมูล', 'system', 'OWNER'],
  'test-mode.manage': ['จัดการโหมดทดสอบ', 'system', 'OWNER'],
  'pdpa.manage': ['จัดการคำขอข้อมูลส่วนบุคคล', 'system', 'OWNER'],
} as const;

export type PermissionKey = keyof typeof PERMISSION_DEFINITIONS;
export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type AssignablePermissionKey = {
  [Key in PermissionKey]: (typeof PERMISSION_DEFINITIONS)[Key][2] extends 'GRANT' ? Key : never;
}[PermissionKey];

export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly label: string;
  readonly group: PermissionGroup;
  readonly groupLabel: string;
  readonly ownerOnly: boolean;
  readonly allStaff: boolean;
  readonly sensitive: boolean;
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = Object.freeze(
  (Object.keys(PERMISSION_DEFINITIONS) as PermissionKey[]).map((key) => {
    const [label, group, authority] = PERMISSION_DEFINITIONS[key];
    return Object.freeze({
      key,
      label,
      group,
      groupLabel: PERMISSION_GROUPS[group],
      ownerOnly: authority === 'OWNER',
      allStaff: authority === 'STAFF',
      sensitive: group === 'sensitive',
    });
  }),
);

export function isPermissionKey(permission: unknown): permission is PermissionKey {
  return (
    typeof permission === 'string' &&
    Object.prototype.hasOwnProperty.call(PERMISSION_DEFINITIONS, permission)
  );
}

/** Use at the position write boundary: reserved owner and implicit staff rights cannot be assigned. */
export function isAssignablePermissionKey(
  permission: unknown,
): permission is AssignablePermissionKey {
  return isPermissionKey(permission) && PERMISSION_DEFINITIONS[permission][2] === 'GRANT';
}

export type AccessScope = 'BRANCHES' | 'ASSIGNED' | 'COMPANY';

export interface AccessGrant {
  readonly positionId: string;
  readonly permissions: readonly PermissionKey[];
  readonly company: Company;
  readonly scope: AccessScope;
  readonly branchIds: readonly string[];
}

/** Server builds this from the current persisted, active staff account and active positions.
 * isOwner is an account property, never inferred from a position code, legacy role supplied
 * by a client, or an editable grant. Disabled/deleted/customer accounts must not get snapshots.
 * managed=false explicitly opts out of position authorization; legacy handling lives outside
 * this evaluator. revision supports stale-edit checks, not a substitute for current loading.
 */
export interface AccessSnapshot {
  readonly userId: string;
  readonly isOwner: boolean;
  readonly managed: boolean;
  readonly revision: number;
  readonly grants: readonly AccessGrant[];
}

/** Resolve from persisted source relationships, not caller-supplied branch/ownership claims. */
export interface AccessResource {
  readonly company: Company;
  readonly branchId?: string | null;
  readonly assignedUserIds?: readonly string[];
}

function isCompany(company: unknown): company is Company {
  return company === 'SHOP' || company === 'FINANCE';
}

function hasStaffIdentity(snapshot: AccessSnapshot): boolean {
  return typeof snapshot?.userId === 'string' && snapshot.userId.trim().length > 0;
}

function matchesGrant(grant: AccessGrant, permission: PermissionKey, company: Company): boolean {
  return grant.company === company && grant.permissions.includes(permission);
}

/** Evaluate one complete tuple at a time; never union permissions before resolving scopes.
 * BRANCHES requires a nonempty matching branch. ASSIGNED requires the current user's record
 * assignment; its optional branch filter further restricts access. An empty ASSIGNED branch
 * list permits assigned central cases, never all records. COMPANY must be explicit.
 * activity.read allows safe summaries only; details require every source/sensitive permission.
 * Business invariants (caps, maker-checker, approved snapshots, etc.) remain additional checks.
 */
export function canAccess(
  snapshot: AccessSnapshot,
  permission: string,
  resource: AccessResource,
): boolean {
  if (!hasStaffIdentity(snapshot) || !isPermissionKey(permission) || !isCompany(resource?.company))
    return false;
  const authority = PERMISSION_DEFINITIONS[permission][2];
  if (snapshot.isOwner === true || authority === 'STAFF') return true;
  if (authority === 'OWNER' || snapshot.managed !== true) return false;
  return snapshot.grants.some((grant) => {
    if (!matchesGrant(grant, permission, resource.company)) return false;
    switch (grant.scope) {
      case 'COMPANY':
        return true;
      case 'BRANCHES':
        return !!resource.branchId && grant.branchIds.includes(resource.branchId);
      case 'ASSIGNED':
        return (
          !!resource.assignedUserIds?.includes(snapshot.userId) &&
          (grant.branchIds.length === 0 ||
            (!!resource.branchId && grant.branchIds.includes(resource.branchId)))
        );
      default:
        return false;
    }
  });
}

/** Branches whose entire data set is authorized for this permission. ASSIGNED grants are
 * deliberately omitted: a branch-only query cannot enforce case ownership. Callers needing
 * assigned rows must construct an ownership predicate from the original tuples, or evaluate
 * records with canAccess. Never interpret [] as no filter. ALL still means only this company.
 */
export function accessibleBranchIds(
  snapshot: AccessSnapshot,
  permission: string,
  company: Company,
): string[] | 'ALL' {
  if (!hasStaffIdentity(snapshot) || !isPermissionKey(permission) || !isCompany(company)) return [];
  const authority = PERMISSION_DEFINITIONS[permission][2];
  if (snapshot.isOwner === true || authority === 'STAFF') return 'ALL';
  if (authority === 'OWNER' || snapshot.managed !== true) return [];
  const branchIds = new Set<string>();
  for (const grant of snapshot.grants) {
    if (!matchesGrant(grant, permission, company)) continue;
    if (grant.scope === 'COMPANY') return 'ALL';
    if (grant.scope === 'BRANCHES') {
      for (const branchId of grant.branchIds) if (branchId.trim()) branchIds.add(branchId);
    }
  }
  return [...branchIds];
}

export interface DefaultAccessPosition {
  readonly code: string;
  readonly name: string;
  readonly assignable: boolean;
  readonly permissions: readonly AssignablePermissionKey[];
}

// Templates do not select company/scope/branches or automatically migrate real employees.
// The OWNER row is informational, cannot be assigned, and grants no owner authority.
// No discount caps are supplied: the owner must configure them in the approval workflow.
const DEFAULT_POSITION_DEFINITIONS = [
  { code: 'OWNER', name: 'เจ้าของ', assignable: false, permissions: [] },
  {
    code: 'BRANCH_MANAGER',
    name: 'ผู้จัดการสาขา',
    assignable: true,
    permissions: [
      'interest-configs.read',
      'shop-tenders.read',
      'shop-tenders.count',
      'shop-tenders.confirm',
      'shop-tenders.deposit',
      'customer-journey.moderate',
      'sensitive.customer-identity.read',
      'dashboard.read',
      'customers.read',
      'customers.create',
      'customers.update',
      'sales.read',
      'sales.create',
      'promotions.apply',
      'sales.export',
      'bookings.read',
      'bookings.create',
      'bookings.update',
      'contracts.read',
      'contracts.create',
      'contracts.update',
      'products.read',
      'inventory.read',
      'inventory.export',
      'stock-receiving.read',
      'stock-transfers.read',
      'stock-transfers.create',
      'stock-count.read',
      'stock-count.create',
      'stock-adjustments.read',
      'stock-adjustments.create',
      'employees.read',
      'chat.read',
      'chat.send',
      'chat-assignment.update',
      'after-sales.read',
      'after-sales.create',
      'after-sales.update',
      'repair-tickets.read',
      'repair-tickets.create',
      'repair-tickets.update',
      'discounts.request',
      'discounts.approve',
      'sales.cancel.request',
      'refunds.read',
      'refunds.request',
    ],
  },
  {
    code: 'SALES',
    name: 'พนักงานขาย',
    assignable: true,
    permissions: [
      'interest-configs.read',
      'shop-tenders.read',
      'shop-tenders.count',
      'dashboard.read',
      'customers.read',
      'customers.create',
      'customers.update',
      'customer-journey.read',
      'chat.read',
      'chat.send',
      'bookings.read',
      'bookings.create',
      'bookings.update',
      'sales.read',
      'sales.create',
      'contracts.read',
      'contracts.create',
      'contracts.update',
      'contract-documents.read',
      'contract-documents.create',
      'products.read',
      'inventory.read',
      'promotions.read',
      'promotions.apply',
      'discounts.request',
      'sales.cancel.request',
      'refunds.read',
      'refunds.request',
      'after-sales.read',
      'after-sales.create',
      'after-sales.update',
      'repair-tickets.read',
      'repair-tickets.create',
      'repair-tickets.update',
      'documents.read',
      'documents.create',
    ],
  },
  {
    code: 'STOCK',
    name: 'พนักงานสต็อก',
    assignable: true,
    permissions: [
      'interest-configs.read',
      'products.read',
      'inventory.read',
      'stock-receiving.read',
      'stock-receiving.create',
      'stock-receiving.update',
      'stock-count.read',
      'stock-count.create',
      'stock-count.update',
      'stock-transfers.read',
      'stock-transfers.create',
      'stock-transfers.receive',
      'stock-adjustments.read',
      'stock-adjustments.create',
      'inspections.read',
      'inspections.create',
      'inspections.update',
      'product-photos.read',
      'product-photos.create',
      'stickers.read',
      'stickers.create',
    ],
  },
  {
    code: 'PURCHASING',
    name: 'ฝ่ายจัดซื้อ',
    assignable: true,
    permissions: [
      'suppliers.read',
      'suppliers.create',
      'suppliers.update',
      'suppliers.delete',
      'purchase-orders.read',
      'purchase-orders.create',
      'purchase-orders.update',
      'purchase-orders.export',
      'stock-receiving.read',
      'stock-receiving.create',
      'stock-receiving.update',
      'products.read',
      'inventory.read',
      'products.cost.update',
      'sensitive.cost.read',
      'sensitive.seller-bank.read',
      'documents.read',
      'documents.create',
    ],
  },
  {
    code: 'FINANCE',
    name: 'พนักงานการเงิน',
    assignable: true,
    permissions: [
      'customers.read',
      'contracts.read',
      'finance-receivables.read',
      'payments.read',
      'payments.create',
      'receipts.read',
      'receipts.create',
      'receipts.export',
      'reconciliation.read',
      'refunds.read',
      'refunds.request',
      'refunds.execute',
      'interest-reductions.request',
      'penalty-waivers.request',
    ],
  },
  {
    code: 'FINANCE_MANAGER',
    name: 'ผู้จัดการการเงิน',
    assignable: true,
    permissions: [
      'interest-configs.read',
      'shop-tenders.read',
      'shop-tenders.confirm',
      'shop-tenders.deposit',
      'shop-tenders.deposit-owner-hold',
      'sensitive.customer-identity.read',
      'customers.read',
      'contracts.read',
      'contracts.update',
      'contracts.approve',
      'contracts.activate',
      'credit-checks.read',
      'credit-checks.create',
      'credit-checks.update',
      'credit-checks.approve',
      'finance-applications.read',
      'finance-applications.update',
      'finance-applications.approve',
      'finance-receivables.read',
      'payments.read',
      'payments.create',
      'payments.approve',
      'receipts.read',
      'receipts.create',
      'collections.read',
      'collection-contacts.read',
      'collection-contacts.create',
      'collection-contacts.update',
      'payment-promises.read',
      'payment-promises.create',
      'payment-promises.update',
      'refunds.read',
      'refunds.request',
      'refunds.execute',
      'interest-reductions.request',
      'penalty-waivers.request',
      'reports.read',
    ],
  },
  {
    code: 'COLLECTIONS',
    name: 'พนักงานติดตามหนี้',
    assignable: true,
    permissions: [
      'customers.read',
      'contracts.read',
      'finance-receivables.read',
      'collections.read',
      'collection-contacts.read',
      'collection-contacts.create',
      'collection-contacts.update',
      'payment-promises.read',
      'payment-promises.create',
      'payment-promises.update',
      'letters.read',
      'letters.create',
      'letters.export',
      'interest-reductions.request',
      'penalty-waivers.request',
    ],
  },
  {
    code: 'ACCOUNTANT',
    name: 'ฝ่ายบัญชี',
    assignable: true,
    permissions: [
      'interest-configs.read',
      'shop-tenders.read',
      'sensitive.customer-identity.read',
      'accounting.read',
      'accounting.create',
      'accounting.update',
      'accounting.export',
      'journal.read',
      'journal.create',
      'journal.update',
      'journal.export',
      'reconciliation.read',
      'reconciliation.create',
      'reconciliation.update',
      'reconciliation.export',
      'tax.read',
      'tax.create',
      'tax.update',
      'tax.export',
      'expenses.read',
      'expenses.create',
      'expenses.update',
      'other-income.read',
      'other-income.create',
      'other-income.update',
      'chart-of-accounts.read',
      'bank-accounts.read',
      'receipts.read',
      'documents.read',
      'documents.create',
      'documents.export',
      'reports.read',
      'reports.export',
      'sensitive.cost.read',
      'sensitive.seller-bank.read',
      'sensitive.profit.read',
    ],
  },
] as const satisfies readonly DefaultAccessPosition[];

export const DEFAULT_ACCESS_POSITIONS: readonly DefaultAccessPosition[] = Object.freeze(
  DEFAULT_POSITION_DEFINITIONS.map((position) =>
    Object.freeze({
      ...position,
      permissions: Object.freeze(position.permissions),
    }),
  ),
);
