import { formatNumber } from '@/lib/format';

/**
 * Thai user-facing microcopy. Centralizing makes tone consistent and
 * eases future i18n. Keys follow <page>.<element> naming.
 */

/**
 * Single source of truth for the shop's public contact channels.
 * NAP (name/address/phone) ต้องตรงกับ JSON-LD ใน index.html + Google Business Profile
 * เสมอ — ความไม่ตรงกันทำให้ AI/search ไม่เชื่อว่าเป็นธุรกิจเดียวกัน (owner ยืนยันชุดนี้ 2026-08-30)
 */
export const shopInfo = {
  lineHandle: '@bestchoice',
  lineUrl: 'https://line.me/R/ti/p/@bestchoice',
  phoneDisplay: '095-567-8887',
  phoneHref: 'tel:+66955678887',
  address: 'เลขที่ 456/21 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000',
  hours: 'เปิดทุกวัน 10:00 - 19:00 น.',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=BESTCHOICE+phone+shop+%E0%B8%A5%E0%B8%9E%E0%B8%9A%E0%B8%B8%E0%B8%A3%E0%B8%B5&query_place_id=ChIJvw20uboBHjERsefpWFx4SPs' as
      | string
      | null,
  /** รีวิวจริงบน Google Maps (place_id ของร้าน) */
  googleReviewsUrl: 'https://search.google.com/local/reviews?placeid=ChIJvw20uboBHjERsefpWFx4SPs',
  facebookPageUrl: 'https://www.facebook.com/bestchoicelopburi',
  facebookReviewsUrl:
    'https://www.facebook.com/bestchoicelopburi/reviews/?id=100064751914437&sk=reviews',
  /** TODO(owner): ใส่ URL รูปหน้าร้านจริงแล้วรูปจะโผล่เอง */
  storePhotoUrl: null as string | null,
  /** TODO(owner): รูปลูกค้ารับเครื่องที่ร้าน 3 รูป (ได้รับอนุญาตจากลูกค้าแล้ว) — แสดงใต้หัวข้อของหน้า SEO สามหน้า */
  customerPhotoUrls: [] as readonly string[],
  /**
   * คะแนนและจำนวนรีวิวบน Google Maps — ตัวเลขชุดเดียวของทั้งเว็บ (หน้าแรก · เกี่ยวกับเรา).
   * ตัวเลขจาก Google Maps วันที่ 27 พ.ย. 2569: 5.0 ดาว · 1,177 รีวิว — เขียนแบบปัดลง ("1,100+") ให้ยังจริงเมื่อรีวิวเพิ่ม
   */
  googleRating: '5.0',
  googleReviewCount: '1,100+',
} as const;

/**
 * ข้อความรีวิวจริงจากลูกค้า (หน้าแรก ส่วน "รีวิวจากลูกค้าจริง") — เจ้าของร้านเป็นคนใส่เอง 3–5 รายการ.
 * ห้ามแต่งรีวิวขึ้นมาเอง · ว่าง = ไม่แสดงกล่องรีวิวเลย (ไม่มีข้อความตัวอย่างหลุดขึ้นเว็บ)
 * ตัวอย่างรูปแบบ: { name: 'คุณเอ (ลพบุรี)', text: 'ข้อความจากรีวิว Google', source: 'Google' }
 */
/** ประโยคแรกของย่อหน้าแนะนำร้านบนหน้าแรก (copy.home.shopSummary) */
const SHOP_SUMMARY_LEAD =
  'BESTCHOICE ร้านขาย iPhone มือ 1 และมือสองในลพบุรี ผ่อนได้ด้วยบัตรประชาชนใบเดียว';

export const customerReviews: readonly { name: string; text: string; source: 'Google' | 'Facebook' }[] = [];

/** LINE OA deep-link พร้อมข้อความ prefill — ใช้ handle จาก shopInfo เสมอ */
export function lineOaMessageUrl(text: string): string {
  const handle = shopInfo.lineHandle.replace(/^@/, '');
  return `https://line.me/R/oaMessage/%40${handle}/?${encodeURIComponent(text)}`;
}

/**
 * ลิงก์ "แชร์สินค้า" — ชี้ไป share endpoint ของ API ที่เสิร์ฟ Open Graph
 * (SPA เป็น client-render ล้วน LINE/Facebook จึงไม่เห็น meta ที่ usePageMeta ใส่)
 * endpoint จะเด้งคนจริงต่อไปที่ /products/:id ทันที
 */
export function productShareUrl(productId: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://www.bestchoicephone.com';
  return `${origin}/api/shop/share/${encodeURIComponent(productId)}`;
}

/**
 * ลิงก์ Messenger พร้อม ref ต่อเครื่อง — webhook ฝั่ง API อ่าน `p:<productId>`
 * แล้วโพสต์โน้ตในห้องแชทให้ทีมงานรู้ว่าลูกค้ามาจากเครื่องไหน
 *
 * `pageHandle` มาจาก GET /api/shop/public-config/shop (username ที่เจ้าของกรอก
 * ในหน้า Settings หรือถอยไปใช้ pageId) — **ห้าม hardcode ในไฟล์นี้** เพราะจะทำให้
 * เจ้าของแก้เองไม่ได้และปุ่มถูกซ่อนถาวร. คืน null เมื่อยังไม่ได้ตั้งค่า Facebook เลย
 */
export function messengerRefUrl(
  productId: string,
  pageHandle: string | null | undefined,
): string | null {
  if (!pageHandle) return null;
  return `https://m.me/${encodeURIComponent(pageHandle)}?ref=${encodeURIComponent(`p:${productId}`)}`;
}

/** ข้อความ prefill ตอนทักไลน์จากหน้าสินค้า — จุดแก้เดียวของทั้ง 2 ปุ่ม */
export function lineProductPrefill(
  displayName: string,
  imeiLast4: string | undefined,
  shareUrl: string,
): string {
  const tail = imeiLast4 ? ` (${imeiLast4})` : '';
  return `สนใจ ${displayName}${tail} ${shareUrl}`;
}

export const copy = {
  common: {
    loading: 'กำลังโหลด…',
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
    // \n = จุดตัดบรรทัดที่เจ้าของเคาะ (2026-11-27): "บัตรประชาชน" ต้องไม่ถูกแยกกลางคำ · คำเดิมทุกคำ
    // บรรทัดสุดท้ายเป็นบรรทัดเน้นสี ต่อท้ายด้วยยอดดาวน์ตามสต๊อก ("ดาวน์เริ่ม X บาท" — useDownFloor) ใน HomeHero
    heroTitle: 'ผ่อน iPhone\nใช้บัตรประชาชนใบเดียว\nไม่เช็กบูโร',
    /** ต่อท้ายบรรทัดสุดท้ายแทนยอดดาวน์เมื่อยังไม่รู้ยอด (กำลังโหลด / API ล่ม) — ห้ามมีตัวเลขดาวน์ */
    heroTitleNoDownSuffix: 'ไม่ต้องมีผู้ค้ำ',
    // "มือสองรับประกันร้าน 60 วัน" ไม่อยู่ตรงนี้แล้ว — ซ้ำกับป้ายใต้ปุ่ม (เจ้าของ 2026-11-27)
    heroDescription: 'ร้านมือถือลพบุรี ของแท้ 100% ผ่อนได้ทุกอาชีพ รับเครื่องวันนี้',
    /**
     * ย่อหน้าตอบตรง ๆ ใต้ส่วนหัว: ร้านคืออะไร อยู่ไหน เปิดกี่โมง ติดต่อทางไหน — ให้ Google/AI
     * ตอบคำถามเรื่องร้านได้ (ผลตรวจ SEO ข้อ 12 · เจ้าของเลือกแบบเต็ม 27 พ.ย. 2569)
     * ข้อเท็จจริงมาจาก shopInfo ทั้งหมด ⇒ แก้ที่อยู่/เวลา/ช่องทางที่เดียว ย่อหน้านี้ตามเอง
     */
    shopSummaryLead: SHOP_SUMMARY_LEAD,
    shopSummary:
      `${SHOP_SUMMARY_LEAD} หน้าร้านอยู่ ${shopInfo.address} ${shopInfo.hours} ` +
      `ทักไลน์ ${shopInfo.lineHandle} หรือโทร ${shopInfo.phoneDisplay}`,
    featuredTitle: 'รุ่นยอดนิยม',
    whyUsTitle: 'ทำไมเลือก BESTCHOICE',
    servicesTitle: 'บริการของเรา',
    servicesDescription: 'ครบทุกเรื่องมือถือ ซื้อ ผ่อน แลก หรือขายคืน จบที่ร้านเดียว',
    serviceBuyTitle: 'ซื้อ/ผ่อน iPhone',
    serviceBuyDescription: 'เครื่องผ่านตรวจ 30 จุด ผ่อนได้บัตรประชาชนใบเดียว สูงสุด 15 งวด',
    serviceBuyCta: 'ดูสินค้า',
    serviceSellTitle: 'ขาย/เทิร์น iPhone',
    serviceSellDescription:
      'รู้ราคาทันทีออนไลน์ เลือกได้ทั้งขายรับเงินสด หรือเทิร์นแลกเครื่องใหม่ได้ราคาเพิ่ม',
    serviceSellCta: 'เช็คราคา',
    visitTitle: 'มาหาเราที่ร้าน',
    visitDescription: 'ร้านอยู่ลพบุรี ลองเครื่องจริงก่อนตัดสินใจ ทีมงานช่วยดูให้ทุกขั้น',
    visitNavigateCta: 'นำทางด้วย Google Maps',
    visitLineCta: 'นัดหมายทางไลน์',
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
    emptyFreeDownTitle: 'ยังไม่มีเครื่องฟรีดาวน์ตามตัวกรองนี้',
    emptyFreeDownDescription: 'ลองเอาเครื่องหมายถูกที่ช่อง "ฟรีดาวน์" ออก เพื่อดูเครื่องทั้งหมด',
    // ตัวกรองเงินดาวน์เป็นบาท (สเปค 2026-11-25 หัวข้อ 5–6)
    downLabel: 'เงินดาวน์',
    downUnit: 'บาท',
    foundWithDown: (count: number, down: number) =>
      `พบ ${count} เครื่องที่ดาวน์ได้ด้วยเงิน ฿${formatNumber(down)}`,
    foundFreeDown: (count: number) => `พบ ${count} เครื่องฟรีดาวน์`,
    /** บรรทัดท้ายรายการสถานะ ② — `from` = เงินดาวน์น้อยสุดที่ทำให้เครื่องถัดไปขึ้น */
    overBudget: (count: number, down: number, from: number | null) =>
      `อีก ${count} เครื่องต้องดาวน์มากกว่า ฿${formatNumber(down)}` +
      (from != null ? ` (เริ่มที่ ฿${formatNumber(from)})` : ''),
    showAll: 'ดูทั้งหมด',
    emptyDownTitle: (down: number) => `เงินดาวน์ ฿${formatNumber(down)} ยังไม่พอ`,
    emptyDownDescription: (from: number) => `ดาวน์ต่ำสุดเริ่มที่ ฿${formatNumber(from)}`,
    seeFreeDown: 'ดูเครื่องฟรีดาวน์',
    clearDown: 'ล้างเงินดาวน์',
    clearAll: 'ล้างตัวกรองทั้งหมด',
    downHint:
      'ใส่เงินดาวน์ที่มี ระบบจะแสดงทุกเครื่องที่ดาวน์ได้ · ไม่ใส่ = ดาวน์ขั้นต่ำของแต่ละเครื่อง',
  },

  product: {
    // reserveCta ("จองเครื่องนี้ 15 นาที") ถูกลบ 2026-08-31 — ร้านไม่มีบริการจอง
    // ห้ามเพิ่มกลับโดยไม่มีระบบจองจริงรองรับ (คีย์ค้าง = โฆษณาบริการที่ไม่มี)
    // B5 T12b: honest sold-out copy — same wording as ProductCard's
    // 'out' tone (see shop-catalog.service.ts smartStockCount(0)) so the
    // message is identical whether a customer sees it on a listing card
    // or lands directly on a sold-out model's permalink.
    soldOutNotice: 'หมดสต็อก — ทักแชทเช็ครอบเข้าใหม่',
    soldOutLineCta: 'ทักแชทเช็ครอบเข้าใหม่',
    specTitle: 'รายละเอียดสินค้า',
    conditionAFull: 'เกรด A — สภาพดีมาก เหมือนใหม่',
    conditionBFull: 'เกรด B — สภาพใช้งาน มีรอยเล็กน้อย',
    conditionCFull: 'เกรด C — สภาพมีรอย หรือตำหนิ',
    askLineCta: 'สอบถามเครื่องนี้ทางไลน์',
    shareCta: 'แชร์เครื่องนี้',
    shareCopied: 'คัดลอกลิงก์แล้ว',
    shareFailed: 'คัดลอกลิงก์ไม่สำเร็จ',
    askMessengerCta: 'ทักเรื่องเครื่องนี้ทาง Messenger',
    branchLabel: 'เครื่องอยู่ที่',
    accessoriesLabel: 'อุปกรณ์ที่ได้',
    cosmeticLabel: 'ตำหนิที่แจ้งไว้',
    qcTitle: 'ผลตรวจสภาพเครื่อง',
    qcPassed: 'ผ่าน',
    qcFailed: 'ไม่ผ่าน',
  },

  orders: {
    pageTitle: 'คำสั่งซื้อของฉัน',
    emptyTitle: 'ยังไม่มีคำสั่งซื้อ',
    emptyDescription: 'ลองดูสินค้าและสั่งซื้อดูครับ',
  },

  orderDetail: {
    breadcrumbList: 'คำสั่งซื้อของฉัน',
    productTitle: 'สินค้า',
    shippingAddressTitle: 'ที่อยู่จัดส่ง',
    paymentInfoTitle: 'ข้อมูลการชำระเงิน',
    paymentChannelLabel: 'ช่องทางชำระ',
    paidAtLabel: 'ชำระเมื่อ',
    trackingTitle: 'หมายเลขพัสดุ',
    cancelCta: 'ยกเลิก',
    refundCta: 'ขอคืนเงิน',
    confirmCancel: 'ยืนยันการยกเลิกคำสั่งซื้อ?',
    confirmRefund: 'ยืนยันขอคืนเงินสำหรับคำสั่งซื้อนี้?',
  },

  sell: {
    pageTitle: 'ขาย/เทิร์น iPhone',
    description:
      'ขายหรือเทิร์น iPhone ในลพบุรี เช็กราคาประเมินออนไลน์ แล้วนำเครื่องมาตรวจที่ร้าน',
    quoteCta: 'เช็คราคา ขาย/เทิร์น',
    sellerName: 'ชื่อ-นามสกุล',
    sellerPhone: 'เบอร์โทร (10 หลัก)',
    submitSuccessCash: 'ยืนยันการขายแล้ว ทีมงานจะติดต่อนัดวันเข้าร้าน',
    submitSuccessExchange: 'ยืนยันเทิร์นแล้ว ทีมงานจะติดต่อนัดวัน มาเลือกเครื่องใหม่ที่ร้านได้เลย',
    submitError: 'ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่',
    quoteError: 'ประเมินราคาไม่สำเร็จ',
    priceCondition:
      'ราคายืนยันจริงตอนตรวจเครื่องที่ร้าน คุณปฏิเสธได้ ไม่มีค่าใช้จ่าย',
    modelUnavailable: 'รุ่นนี้ยังไม่เปิดรับซื้อออนไลน์ ทักไลน์สอบถามราคาได้เลย',
    statusTitle: 'สถานะรายการ',
    statusNotFound: 'ไม่พบข้อมูลรายการ',
    acceptPrice: 'ยอมรับราคา',
    rejectPrice: 'ปฏิเสธ',
    followUp: 'ทีมงานจะติดต่อนัดวันเข้าร้านทาง LINE/โทรศัพท์',
    quotedTitle: 'ราคาขายสดโดยประมาณ',
    cashOption: 'ขายรับเงินสด',
    exchangeOption: 'เทิร์นแลกเครื่องใหม่',
    exchangeCreditNote: 'เครดิตเทิร์นใช้เป็นส่วนลดซื้อเครื่องในร้าน ไม่จ่ายเป็นเงินสด',
  },

  // หน้าแรก /sell (เจ้าของเลือกแบบ ข 2026-11-27 "เข้าใจง่าย และไม่ยาว") — ข้อความเฉพาะหน้านี้ หนึ่งบรรทัดหนึ่งเรื่อง
  // ประโยคราคายืนยัน / เครดิตเทิร์น / ที่อยู่ / เวลาเปิด ใช้คีย์เดิมของ sell และ contact (หน้าอื่นใช้ร่วม ไม่ทำสำเนา)
  sellLanding: {
    eyebrow: 'เบสท์ช้อยส์ · ลพบุรี',
    title: 'ขายหรือเทิร์น iPhone',
    lead: 'รู้ราคาประเมินก่อนมาร้าน',
    cta: 'เริ่มเช็กราคา',
    notes: ['ไม่ต้องสมัครสมาชิก', 'ไม่ต้องถ่ายรูปเครื่อง'],
    stepsTitle: '3 ขั้นตอน',
    step1Title: 'เลือกรุ่น แล้วตอบสภาพเครื่อง',
    step2Title: 'นำเครื่องมาที่ร้าน',
    step3Title: 'เลือกขายสด หรือเทิร์น',
    cashNote: 'ขายสด รับเงินที่ร้านหลังตรวจเครื่อง',
  },

  howItWorks: {
    pageTitle: 'วิธีซื้อและผ่อน',
    intro: 'ซื้อเครื่องกับ BESTCHOICE ง่ายๆ 3 ขั้นตอน ใช้บัตรประชาชนใบเดียว ไม่เช็กบูโร',
    stepsTitle: '3 ขั้นตอนง่ายๆ',
    step1Title: 'ทักแชท เลือกรุ่นที่ชอบ',
    step1Description:
      'ดูเครื่องจากหน้ารายการสินค้า แล้วทักไลน์บอกงบและอาชีพ ทีมงานช่วยแนะนำรุ่นที่ผ่อนไหว',
    step2Title: 'เตรียมบัตรประชาชนตัวจริง',
    step2Description:
      'ใช้บัตรประชาชนใบเดียว ทักแชทแล้วเจ้าหน้าที่จะประเมินและแจ้งเรทที่ได้ให้',
    step3Title: 'มาที่ร้าน ดาวน์แล้วรับเครื่องเลย',
    step3Description: 'เซ็นสัญญา ชำระเงินดาวน์ รับเครื่องกลับบ้านได้ทันที ใช้เวลาไม่เกิน 30 นาที',
    faqTitle: 'คำถามที่พบบ่อย',
    faq1Q: 'ไม่มีบัตรเครดิตผ่อนได้ไหม',
    faq1A: 'ผ่อนได้ครับ ใช้บัตรประชาชนใบเดียว ไม่เช็กบูโร ไม่ต้องใช้บัตรเครดิต และไม่ต้องมีผู้ค้ำ',
    faq2Q: 'ผ่อนได้กี่งวด',
    faq2A: 'เลือกได้สูงสุด 15 งวด จำนวนงวดที่เลือกได้ของแต่ละเครื่องดูได้ที่หน้าเครื่องนั้น ส่วนเรทที่ได้ ทักแชทแล้วเจ้าหน้าที่จะประเมินให้',
    faq3Q: 'ต้องดาวน์เท่าไร',
    faq3A: 'บางเครื่องไม่ต้องวางดาวน์ (ฟรีดาวน์) เครื่องอื่นดาวน์ตามที่หน้าเครื่องแสดง ยิ่งดาวน์เยอะ ค่างวดยิ่งถูก',
    faq4Q: 'ถ้าผ่อนไม่ไหวทำอย่างไร',
    faq4A: 'ติดต่อทีมงานผ่าน LINE ทันที เรามีทางช่วยเช่น ยืดงวด ลดยอด หรือคืนเครื่อง',
    faq5Q: 'ซื้อเงินสดถูกกว่าไหม',
    faq5A: 'ราคาเครื่องเท่ากันทั้งเงินสดและผ่อน แต่ผ่อนจะมีค่าดอกเบี้ยบวกเพิ่ม',
  },

  shipping: {
    pageTitle: 'การจัดส่ง',
    intro1:
      'BESTCHOICE จัดส่งเครื่องทั่วประเทศไทยสำหรับการซื้อเงินสด และเปิดให้รับเครื่องที่สาขาลพบุรีสำหรับลูกค้าในพื้นที่',
    intro2: 'สำหรับลูกค้าผ่อน ต้องมารับเครื่องที่สาขาลพบุรีเท่านั้น เพื่อยืนยันเอกสารและเซ็นสัญญา',
    methodsTitle: 'ช่องทางจัดส่ง',
    branchPickupName: 'รับเครื่องที่สาขาลพบุรี',
    branchPickupFee: 'ฟรี',
    branchPickupEta: 'พร้อมรับทันที',
    branchPickupDescription: 'รับเครื่องที่ร้าน ตรวจเครื่องได้ละเอียดก่อนรับกลับบ้าน',
    kerryName: 'Kerry Express',
    kerryFee: '฿60',
    kerryEta: '1-2 วันทำการ',
    kerryDescription: 'ส่งทั่วประเทศ มีระบบเช็คสถานะพัสดุออนไลน์',
    flashName: 'Flash Express',
    flashFee: '฿50',
    flashEta: '1-2 วันทำการ',
    flashDescription: 'ส่งไวในราคาประหยัด เช็คสถานะผ่านแอปหรือเว็บได้',
    jtName: 'J&T Express',
    jtFee: '฿50',
    jtEta: '1-2 วันทำการ',
    jtDescription: 'ส่งทั่วประเทศ รับประกันพัสดุ มีระบบติดตาม',
    thailandPostName: 'ไปรษณีย์ไทย (EMS)',
    thailandPostFee: '฿70',
    thailandPostEta: '2-3 วันทำการ',
    thailandPostDescription: 'ส่งถึงทุกพื้นที่ แม้พื้นที่ห่างไกล',
    branchTitle: 'ที่ตั้งสาขาลพบุรี',
    branchAddress: shopInfo.address,
    branchHours: shopInfo.hours,
  },

  returns: {
    pageTitle: 'การเปลี่ยนเครื่องและการรับประกัน',
    intro:
      'BESTCHOICE ใส่ใจคุณภาพและความพอใจของลูกค้า หากพบปัญหาสามารถติดต่อทีมงานได้ทันทีผ่าน LINE',
    warrantyTitle: 'มือสองรับประกันร้าน 60 วัน',
    warrantyBody:
      'เครื่องมือสองรับประกันจากร้าน 60 วัน ครอบคลุมการใช้งานปกติ หากเครื่องมีปัญหาจากอุปกรณ์ภายใน ทางร้านจะซ่อมหรือเปลี่ยนเครื่องให้ฟรี · เครื่องใหม่ใช้ประกันศูนย์ของผู้ผลิต',
    refundTitle: 'เปลี่ยนเครื่องภายใน 7 วัน',
    refundBody:
      'เครื่องมีตำหนิหรือใช้งานผิดปกติภายใน 7 วันหลังรับเครื่อง นำเครื่องพร้อมอุปกรณ์ครบชุดมาที่ร้าน ทีมงานตรวจแล้วเปลี่ยนเครื่องรุ่นเดียวกันให้ · เปลี่ยนได้เฉพาะเครื่องที่มีตำหนิ ไม่รับเปลี่ยนกรณีเปลี่ยนใจ',
    contactTitle: 'วิธีติดต่อ',
    contactBody: 'แจ้งเปลี่ยนเครื่อง/เคลมประกันผ่าน LINE หรือโทรเข้าสาขา ทีมงานพร้อมช่วยเหลือทุกวัน',
    lineCta: `ทักไลน์ ${shopInfo.lineHandle}`,
    phoneCta: `โทร ${shopInfo.phoneDisplay}`,
  },

  about: {
    pageTitle: 'เกี่ยวกับเรา',
    storyTitle: 'เรื่องราวของเรา',
    storyP1:
      'BESTCHOICE Phone Shop เริ่มต้นที่ลพบุรีในปี 2020 ด้วยความตั้งใจของเจ้าของร้านที่อยากให้คนในพื้นที่เข้าถึงมือถือคุณภาพได้ง่าย โดยไม่ต้องเดินทางไกลหรือใช้บัตรเครดิต',
    storyP2:
      'วันนี้เราดูแลลูกค้ามาแล้วกว่า 1,000 ราย ด้วยหลักการง่ายๆ ของแท้ โปร่งใส และดูแลใกล้ชิด เราเลือกเครื่องทุกเครื่องด้วยตัวเอง ตรวจ 30 จุด ก่อนส่งต่อให้ลูกค้า',
    timelineTitle: 'เส้นทางของเรา',
    milestone1Year: '2020',
    milestone1Title: 'ก่อตั้งร้าน',
    milestone1Description: 'เปิดสาขาแรกที่ลพบุรี เน้นขาย iPhone ทั้งมือ 1 และมือสองคุณภาพ',
    milestone2Year: '2022',
    milestone2Title: 'เริ่มบริการผ่อน',
    milestone2Description: 'เปิดผ่อนบัตรประชาชนใบเดียว ช่วยลูกค้าเข้าถึงได้ง่ายขึ้น',
    milestone3Year: '2024',
    milestone3Title: 'ลูกค้าครบ 1,000 ราย',
    milestone3Description: 'รีวิว 4.9 ดาวจากลูกค้าจริงกว่า 500 รีวิว',
    milestone4Year: '2026',
    milestone4Title: 'เปิดระบบออนไลน์',
    milestone4Description: 'เว็บไซต์ใหม่ ดูเครื่องพร้อมส่งและเช็คค่างวดได้ตลอด 24 ชม.',
    valuesTitle: 'คุณค่าของเรา',
    value1Title: 'ของแท้ 100%',
    value1Description: 'ทุกเครื่องตรวจสอบจริง แกะกล่อง ซีเรียลตรงกับตัวเครื่อง',
    value2Title: 'มือสองประกันร้าน 60 วัน',
    value2Description: 'เครื่องใหม่ใช้ประกันศูนย์ หลังซื้อไปแล้วมีปัญหา ติดต่อเราได้ทันที',
    value3Title: 'บริการในพื้นที่',
    value3Description: 'สาขาลพบุรีพร้อมรับเรื่องลูกค้าในพื้นที่ใกล้เคียง ไม่ต้องเดินทางไกล',
  },

  contact: {
    pageTitle: 'ติดต่อเรา',
    intro: 'ทีมงาน BESTCHOICE ยินดีให้คำปรึกษา ตอบข้อสงสัยเรื่องเครื่อง การผ่อน และบริการต่างๆ',
    lineTitle: 'LINE Official',
    lineHandle: shopInfo.lineHandle,
    lineCta: 'เปิดแชท',
    lineDescription: 'ตอบไวในเวลาทำการ ส่งรูป/คลิปให้ดูเครื่องได้',
    phoneTitle: 'โทรศัพท์',
    phoneNumber: shopInfo.phoneDisplay,
    phoneCta: 'โทร',
    phoneDescription: 'รับสายทุกวัน 10:00 - 19:00 น.',
    addressTitle: 'ที่อยู่และเวลาทำการ',
    address: shopInfo.address,
    hours: shopInfo.hours,
  },

  login: {
    pageTitle: 'เข้าสู่ระบบ',
    intro: 'ใช้บัญชี LINE ที่ผูกกับร้านเพื่อดูออเดอร์และทำรายการต่อ',
    lineCta: 'เข้าสู่ระบบด้วย LINE',
    disabledTitle: 'การเข้าสู่ระบบยังไม่เปิดใช้งาน',
    disabledDescription:
      'ระบบล็อกอินออนไลน์กำลังเตรียมเปิดให้บริการ ระหว่างนี้ทักไลน์ร้านได้เลย ทีมงานช่วยเช็คออเดอร์และสัญญาให้ได้ทุกเรื่อง',
    notLinkedTitle: 'ยังไม่พบบัญชีลูกค้าที่ผูกกับ LINE นี้',
    notLinkedDescription:
      'บัญชี LINE นี้ยังไม่ถูกผูกกับข้อมูลลูกค้าของร้าน ทักไลน์แจ้งทีมงานเพื่อผูกบัญชี แล้วลองเข้าสู่ระบบใหม่อีกครั้ง',
    errorTitle: 'เข้าสู่ระบบไม่สำเร็จ',
    errorDescription: 'เกิดข้อผิดพลาดระหว่างเข้าสู่ระบบ ลองใหม่อีกครั้ง หรือทักไลน์แจ้งทีมงาน',
    loggingIn: 'กำลังเข้าสู่ระบบ…',
    backToLogin: 'กลับไปหน้าเข้าสู่ระบบ',
  },

  notFound: {
    pageTitle: 'ไม่พบหน้านี้',
    description: 'ลิงก์อาจพิมพ์ผิดหรือหน้าถูกย้ายไปแล้ว ลองกลับไปหน้าแรกหรือดูสินค้าทั้งหมด',
    homeCta: 'กลับหน้าแรก',
    productsCta: 'ดูสินค้าทั้งหมด',
  },
} as const;
