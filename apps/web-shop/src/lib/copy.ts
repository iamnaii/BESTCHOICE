/**
 * Thai user-facing microcopy. Centralizing makes tone consistent and
 * eases future i18n. Keys follow <page>.<element> naming.
 */

export const copy = {
  common: {
    loading: 'กำลังโหลด...',
    error: 'เกิดข้อผิดพลาด',
    retry: 'ลองใหม่',
    cancel: 'ยกเลิก',
    save: 'บันทึก',
    confirm: 'ยืนยัน',
    close: 'ปิด',
    next: 'ถัดไป',
    back: 'กลับ',
    viewAll: 'ดูทั้งหมด',
    contactLine: 'ทักไลน์',
  },

  home: {
    heroTitle: 'iPhone มือสองคุณภาพ\nผ่อนได้บัตร ปชช. ใบเดียว',
    heroDescription:
      'ร้านมือถือลพบุรี ของแท้ 100% รับประกันร้าน 30 วัน ตรวจสอบ 30 จุดก่อนส่งมอบ',
    featuredTitle: 'รุ่นยอดนิยม',
    whyUsTitle: 'ทำไมเลือก BESTCHOICE',
    testimonialsTitle: 'ลูกค้าพูดถึงเรา',
  },

  catalog: {
    pageTitle: 'สินค้าทั้งหมด',
    filterBrand: 'ยี่ห้อ',
    filterCondition: 'สภาพ',
    filterPrice: 'ราคา',
    sortPopular: 'ยอดนิยม',
    sortPriceAsc: 'ราคาต่ำ → สูง',
    sortPriceDesc: 'ราคาสูง → ต่ำ',
    emptyTitle: 'ไม่พบสินค้าตามตัวกรอง',
    emptyDescription: 'ลองเปลี่ยนยี่ห้อหรือช่วงราคา',
  },

  product: {
    reserveCta: 'จองเครื่องนี้ 15 นาที',
    specTitle: 'รายละเอียดสินค้า',
    conditionAFull: 'เกรด A — สภาพดีมาก เหมือนใหม่',
    conditionBFull: 'เกรด B — สภาพใช้งาน มีรอยเล็กน้อย',
    conditionCFull: 'เกรด C — สภาพมีรอย หรือตำหนิ',
  },

  cart: {
    pageTitle: 'ตะกร้าของคุณ',
    emptyTitle: 'ตะกร้าว่าง',
    emptyDescription: 'ลองเลือกสินค้าจากหน้ารุ่นยอดนิยม',
    emptyCta: 'ดูสินค้าทั้งหมด',
    proceedCta: 'ไปชำระเงิน',
    reservationExpireSoon: 'การจองจะหมดอายุในไม่ช้า',
    reservationExpired: 'การจองหมดอายุแล้ว — กรุณาจองใหม่',
  },

  checkout: {
    stepAddress: 'ที่อยู่',
    stepShipping: 'จัดส่ง',
    stepPayment: 'ชำระเงิน',
    placeOrderCta: 'ยืนยันสั่งซื้อ',
  },

  apply: {
    pageTitle: 'สมัครผ่อน',
    fullName: 'ชื่อ-นามสกุล',
    phone: 'เบอร์โทร',
    nationalId: 'เลขบัตรประชาชน',
    downPayment: 'จำนวนเงินดาวน์',
    totalMonths: 'จำนวนงวด (เดือน)',
    notes: 'หมายเหตุ (ถ้ามี)',
    submitCta: 'ส่งใบสมัคร',
    pdpaNotice:
      'ข้อมูลของคุณถูกเก็บภายใต้นโยบาย PDPA — ใช้เพื่อประเมินสินเชื่อเท่านั้น',
    successTitle: 'ส่งใบสมัครแล้ว',
    successDescription:
      'ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง (เวลาทำการ 09:00–20:00)',
  },

  tradeIn: {
    pageTitle: 'เก่าแลกใหม่',
    description: 'ตีราคามือถือเก่าสูงสุด ฿15,000 พร้อมซื้อเครื่องใหม่ในร้าน',
    submitCta: 'เริ่มทำเรื่อง',
  },

  buyback: {
    pageTitle: 'รับซื้อมือถือ',
    description: 'รับซื้อมือถือมือสองของแท้ พร้อมจ่ายเงินสดหรือโอนทันที',
    quoteCta: 'ตีราคาเบื้องต้น',
  },

  savingPlan: {
    pageTitle: 'ออมดาวน์',
    description: 'เก็บเงินดาวน์ทีละน้อย เริ่ม ฿500/เดือน',
    createCta: 'สร้างแผน',
  },

  review: {
    verifiedBadge: 'ซื้อจริง',
    writeCta: 'เขียนรีวิว',
    emptyTitle: 'ยังไม่มีรีวิว',
    emptyDescription: 'เป็นคนแรกที่รีวิวสินค้านี้',
  },
} as const;
