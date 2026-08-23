/**
 * สเปค iPhone ทางการของ Apple (iPhone X → iPhone 17) สำหรับบอทขาย
 *
 * ใช้ 2 งาน:
 *  1. `findDeviceSpec(text)` — เดารุ่นจากข้อความลูกค้า ('ใช้ 11 อยู่', 'ไอโฟน XR', '15พลัส')
 *  2. `compareDevices(current, candidate)` — สร้างประโยคไทยสั้น ๆ ว่ารุ่นที่เสนอ
 *     ดีกว่า/เท่าเดิม/แย่กว่าเครื่องที่ลูกค้าใช้อยู่ตรงไหน (จาก diff จริงเท่านั้น, ไม่มีราคา)
 *
 * ⚠️ ห้ามใส่ราคาในไฟล์นี้ — ราคาต้องมาจาก PricingTemplate/Product ผ่าน grounding เท่านั้น
 * ⚠️ ห้ามแก้ `device-query-normalize.util.ts` จากไฟล์นี้ — alias matcher ที่นี่แยกอิสระ
 */

export type DeviceVariant =
  | 'base'
  | 'mini'
  | 'plus'
  | 'pro'
  | 'promax'
  | 'e'
  | 'air'
  | 'se'
  | 'x'
  | 'xr'
  | 'xs'
  | 'xsmax';

export interface DeviceSpec {
  /** ชื่อ canonical เช่น 'iPhone 15 Pro', 'iPhone XR', 'iPhone SE (2022)', 'iPhone 16e', 'iPhone Air' (ชื่อทางการ ปี 2025) */
  model: string;
  /** 10 สำหรับ X/XR/XS, 11..17 (SE 2020 = 11 เพราะชิป A13, SE 2022 = 13 เพราะ A15) */
  generation: number;
  variant: DeviceVariant;
  /** ปีเปิดตัว */
  year: number;
  /** 'A13 Bionic' ... */
  chip: string;
  /** ลำดับความแรง: A11=11 … A17 Pro=17, A18=18, A18 Pro=18.5, A19=19, A19 Pro=19.5 */
  chipTier: number;
  displayInch: number;
  displayType: 'LCD' | 'OLED';
  refreshHz: 60 | 120;
  /** กล้องหลัก (MP) */
  mainCameraMp: number;
  /** จำนวนกล้องหลัง */
  cameraCount: number;
  has5G: boolean;
  usbC: boolean;
  dynamicIsland: boolean;
  faceId: boolean;
  /** ชั่วโมงเล่นวิดีโอตามสเปค Apple อย่างเป็นทางการ */
  batteryVideoHours: number;
  /** ไทย สั้น เช่น 'ยังได้อัปเดต iOS อีกหลายปี' / 'ใกล้หมดรอบอัปเดต iOS' */
  iosSupportNote: string;
  /** จุดเด่นภาษาขาย 2-3 ข้อ สั้น ๆ ไม่มีตัวเลขราคา */
  highlights: string[];
}

/**
 * ระดับการรองรับ iOS — เรียงจากแย่ → ดี (index = ลำดับ) ใช้เทียบว่า candidate
 * ได้อัปเดตนานกว่า current หรือไม่. อิง iOS 26 (2025): รองรับ iPhone 11 ขึ้นไป + SE 2020
 */
const IOS_NOTES = [
  'หมดรอบอัปเดต iOS แล้ว', // X, XR, XS, XS Max
  'ใกล้หมดรอบอัปเดต iOS', // 11 series, SE 2020
  'อัปเดต iOS ได้อีก 1-2 ปี', // 12 series
  'อัปเดต iOS ได้อีกหลายปี', // 13, SE 2022, 14
  'อัปเดต iOS ได้ยาว ๆ อีกหลายปี', // 15, 16, 16e, 17
] as const;
const [IOS_ENDED, IOS_NEAR_END, IOS_1_2Y, IOS_MANY_Y, IOS_LONG] = IOS_NOTES;

const iosTier = (note: string): number => IOS_NOTES.indexOf(note as (typeof IOS_NOTES)[number]);

/** chip ที่แสดงในประโยค: ตัด ' Bionic' ออก ('A17 Pro' คงไว้) */
const chipShort = (chip: string): string => chip.replace(/\s*Bionic$/i, '');

type SpecInput = Omit<DeviceSpec, 'has5G' | 'usbC' | 'dynamicIsland' | 'faceId'> &
  Partial<Pick<DeviceSpec, 'has5G' | 'usbC' | 'dynamicIsland' | 'faceId'>>;

/** ค่า default: ไม่มี 5G, Lightning, ไม่มี Dynamic Island, มี Face ID — ระบุเฉพาะที่ต่าง */
const spec = (s: SpecInput): DeviceSpec => ({
  has5G: false,
  usbC: false,
  dynamicIsland: false,
  faceId: true,
  ...s,
});

export const DEVICE_SPECS: DeviceSpec[] = [
  // ── 2017 ──
  spec({
    model: 'iPhone X',
    generation: 10,
    variant: 'x',
    year: 2017,
    chip: 'A11 Bionic',
    chipTier: 11,
    displayInch: 5.8,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    batteryVideoHours: 13,
    iosSupportNote: IOS_ENDED,
    highlights: ['รุ่นแรกที่มี Face ID', 'จอ OLED ไร้ปุ่มโฮม', 'ตัวเครื่องกระจกหน้า-หลัง'],
  }),
  // ── 2018 ──
  spec({
    model: 'iPhone XR',
    generation: 10,
    variant: 'xr',
    year: 2018,
    chip: 'A12 Bionic',
    chipTier: 12,
    displayInch: 6.1,
    displayType: 'LCD',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 1,
    batteryVideoHours: 16,
    iosSupportNote: IOS_ENDED,
    highlights: ['จอใหญ่ 6.1" สีสันหลากหลาย', 'แบตอึดกว่า XS', 'Face ID ครบเหมือนรุ่นพี่'],
  }),
  spec({
    model: 'iPhone XS',
    generation: 10,
    variant: 'xs',
    year: 2018,
    chip: 'A12 Bionic',
    chipTier: 12,
    displayInch: 5.8,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    batteryVideoHours: 14,
    iosSupportNote: IOS_ENDED,
    highlights: ['จอ OLED คมชัด', 'กล้องคู่มีเลนส์ซูม', 'ขนาดกำลังดีถือมือเดียว'],
  }),
  spec({
    model: 'iPhone XS Max',
    generation: 10,
    variant: 'xsmax',
    year: 2018,
    chip: 'A12 Bionic',
    chipTier: 12,
    displayInch: 6.5,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    batteryVideoHours: 15,
    iosSupportNote: IOS_ENDED,
    highlights: ['จอ OLED ใหญ่ 6.5"', 'กล้องคู่มีเลนส์ซูม', 'แบตใหญ่กว่า XS'],
  }),
  // ── 2019 ──
  spec({
    model: 'iPhone 11',
    generation: 11,
    variant: 'base',
    year: 2019,
    chip: 'A13 Bionic',
    chipTier: 13,
    displayInch: 6.1,
    displayType: 'LCD',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    batteryVideoHours: 17,
    iosSupportNote: IOS_NEAR_END,
    highlights: ['กล้องคู่มีอัลตร้าไวด์', 'โหมดกลางคืน', 'แบตอึดใช้ได้ทั้งวัน'],
  }),
  spec({
    model: 'iPhone 11 Pro',
    generation: 11,
    variant: 'pro',
    year: 2019,
    chip: 'A13 Bionic',
    chipTier: 13,
    displayInch: 5.8,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 3,
    batteryVideoHours: 18,
    iosSupportNote: IOS_NEAR_END,
    highlights: ['กล้อง 3 ตัวครบ ซูม+ไวด์', 'จอ OLED สีสด', 'ตัวเครื่องกระจกด้าน'],
  }),
  spec({
    model: 'iPhone 11 Pro Max',
    generation: 11,
    variant: 'promax',
    year: 2019,
    chip: 'A13 Bionic',
    chipTier: 13,
    displayInch: 6.5,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 3,
    batteryVideoHours: 20,
    iosSupportNote: IOS_NEAR_END,
    highlights: ['กล้อง 3 ตัวครบ ซูม+ไวด์', 'จอ OLED ใหญ่ 6.5"', 'แบตอึดสุดในรุ่น 11'],
  }),
  // ── SE ──
  spec({
    model: 'iPhone SE (2020)',
    generation: 11,
    variant: 'se',
    year: 2020,
    chip: 'A13 Bionic',
    chipTier: 13,
    displayInch: 4.7,
    displayType: 'LCD',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 1,
    faceId: false,
    batteryVideoHours: 13,
    iosSupportNote: IOS_NEAR_END,
    highlights: ['เครื่องเล็กเบา พกง่าย', 'ปุ่มโฮม Touch ID', 'ชิปเดียวกับ iPhone 11'],
  }),
  spec({
    model: 'iPhone SE (2022)',
    generation: 13,
    variant: 'se',
    year: 2022,
    chip: 'A15 Bionic',
    chipTier: 15,
    displayInch: 4.7,
    displayType: 'LCD',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 1,
    has5G: true,
    faceId: false,
    batteryVideoHours: 15,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['เครื่องเล็กเบา ปุ่มโฮม Touch ID', 'ชิปเดียวกับ iPhone 13', 'รองรับ 5G'],
  }),
  // ── 2020 ──
  spec({
    model: 'iPhone 12 mini',
    generation: 12,
    variant: 'mini',
    year: 2020,
    chip: 'A14 Bionic',
    chipTier: 14,
    displayInch: 5.4,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    has5G: true,
    batteryVideoHours: 15,
    iosSupportNote: IOS_1_2Y,
    highlights: ['เครื่องเล็กสุดที่มี Face ID', 'จอ OLED สีสด', 'รองรับ 5G'],
  }),
  spec({
    model: 'iPhone 12',
    generation: 12,
    variant: 'base',
    year: 2020,
    chip: 'A14 Bionic',
    chipTier: 14,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    has5G: true,
    batteryVideoHours: 17,
    iosSupportNote: IOS_1_2Y,
    highlights: ['จอ OLED สีสด ดีไซน์ขอบตรง', 'รองรับ 5G', 'กล้องคู่โหมดกลางคืนครบ'],
  }),
  spec({
    model: 'iPhone 12 Pro',
    generation: 12,
    variant: 'pro',
    year: 2020,
    chip: 'A14 Bionic',
    chipTier: 14,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 3,
    has5G: true,
    batteryVideoHours: 17,
    iosSupportNote: IOS_1_2Y,
    highlights: ['กล้อง 3 ตัว + LiDAR', 'ขอบสแตนเลสหรูหรา', 'รองรับ 5G'],
  }),
  spec({
    model: 'iPhone 12 Pro Max',
    generation: 12,
    variant: 'promax',
    year: 2020,
    chip: 'A14 Bionic',
    chipTier: 14,
    displayInch: 6.7,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 3,
    has5G: true,
    batteryVideoHours: 20,
    iosSupportNote: IOS_1_2Y,
    highlights: ['จอใหญ่ 6.7" กล้อง 3 ตัว', 'แบตอึดสุดในรุ่น 12', 'รองรับ 5G'],
  }),
  // ── 2021 ──
  spec({
    model: 'iPhone 13 mini',
    generation: 13,
    variant: 'mini',
    year: 2021,
    chip: 'A15 Bionic',
    chipTier: 15,
    displayInch: 5.4,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    has5G: true,
    batteryVideoHours: 17,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['เครื่องเล็ก แบตดีกว่า 12 mini', 'จอ OLED สีสด', 'รองรับ 5G'],
  }),
  spec({
    model: 'iPhone 13',
    generation: 13,
    variant: 'base',
    year: 2021,
    chip: 'A15 Bionic',
    chipTier: 15,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    has5G: true,
    batteryVideoHours: 19,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['แบตอึดกว่า 12 ชัดเจน', 'กล้องคู่มีโหมดภาพยนตร์', 'ชิป A15 ลื่น รองรับ 5G'],
  }),
  spec({
    model: 'iPhone 13 Pro',
    generation: 13,
    variant: 'pro',
    year: 2021,
    chip: 'A15 Bionic',
    chipTier: 15,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 12,
    cameraCount: 3,
    has5G: true,
    batteryVideoHours: 22,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['จอ ProMotion 120Hz ลื่น', 'กล้อง 3 ตัวถ่ายมาโครได้', 'ขอบสแตนเลส'],
  }),
  spec({
    model: 'iPhone 13 Pro Max',
    generation: 13,
    variant: 'promax',
    year: 2021,
    chip: 'A15 Bionic',
    chipTier: 15,
    displayInch: 6.7,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 12,
    cameraCount: 3,
    has5G: true,
    batteryVideoHours: 28,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['แบตอึดมาก ใช้ได้เกินวัน', 'จอใหญ่ 6.7" 120Hz', 'กล้อง 3 ตัวถ่ายมาโครได้'],
  }),
  // ── 2022 ──
  spec({
    model: 'iPhone 14',
    generation: 14,
    variant: 'base',
    year: 2022,
    chip: 'A15 Bionic',
    chipTier: 15,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    has5G: true,
    batteryVideoHours: 20,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['กล้องหน้าโฟกัสอัตโนมัติ', 'ตรวจจับอุบัติเหตุรถชน', 'แบตอึดกว่า 13'],
  }),
  spec({
    model: 'iPhone 14 Plus',
    generation: 14,
    variant: 'plus',
    year: 2022,
    chip: 'A15 Bionic',
    chipTier: 15,
    displayInch: 6.7,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 12,
    cameraCount: 2,
    has5G: true,
    batteryVideoHours: 26,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['จอใหญ่ 6.7" ในราคารุ่นธรรมดา', 'แบตอึดมาก', 'เครื่องเบากว่า Pro Max'],
  }),
  spec({
    model: 'iPhone 14 Pro',
    generation: 14,
    variant: 'pro',
    year: 2022,
    chip: 'A16 Bionic',
    chipTier: 16,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 3,
    has5G: true,
    dynamicIsland: true,
    batteryVideoHours: 23,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['กล้องหลัก 48MP รุ่นแรก', 'Dynamic Island + จอเปิดตลอด', 'จอ 120Hz ลื่น'],
  }),
  spec({
    model: 'iPhone 14 Pro Max',
    generation: 14,
    variant: 'promax',
    year: 2022,
    chip: 'A16 Bionic',
    chipTier: 16,
    displayInch: 6.7,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 3,
    has5G: true,
    dynamicIsland: true,
    batteryVideoHours: 29,
    iosSupportNote: IOS_MANY_Y,
    highlights: ['กล้องหลัก 48MP', 'จอใหญ่ 6.7" 120Hz + Dynamic Island', 'แบตอึดมาก'],
  }),
  // ── 2023 ──
  spec({
    model: 'iPhone 15',
    generation: 15,
    variant: 'base',
    year: 2023,
    chip: 'A16 Bionic',
    chipTier: 16,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 48,
    cameraCount: 2,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 20,
    iosSupportNote: IOS_LONG,
    highlights: ['กล้องหลัก 48MP', 'USB-C ใช้สายเดียวกับทุกอุปกรณ์', 'Dynamic Island'],
  }),
  spec({
    model: 'iPhone 15 Plus',
    generation: 15,
    variant: 'plus',
    year: 2023,
    chip: 'A16 Bionic',
    chipTier: 16,
    displayInch: 6.7,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 48,
    cameraCount: 2,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 26,
    iosSupportNote: IOS_LONG,
    highlights: ['จอใหญ่ 6.7" แบตอึดมาก', 'กล้องหลัก 48MP', 'USB-C + Dynamic Island'],
  }),
  spec({
    model: 'iPhone 15 Pro',
    generation: 15,
    variant: 'pro',
    year: 2023,
    chip: 'A17 Pro',
    chipTier: 17,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 3,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 23,
    iosSupportNote: IOS_LONG,
    highlights: ['ขอบไทเทเนียม เบากว่าเดิม', 'ปุ่ม Action ตั้งค่าได้', 'จอ 120Hz กล้อง 3 ตัว'],
  }),
  spec({
    model: 'iPhone 15 Pro Max',
    generation: 15,
    variant: 'promax',
    year: 2023,
    chip: 'A17 Pro',
    chipTier: 17,
    displayInch: 6.7,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 3,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 29,
    iosSupportNote: IOS_LONG,
    highlights: ['ซูม 5 เท่าแบบเทเลโฟโต้', 'ขอบไทเทเนียม เบากว่า 14 Pro Max', 'แบตอึดมาก'],
  }),
  // ── 2024 ──
  spec({
    model: 'iPhone 16',
    generation: 16,
    variant: 'base',
    year: 2024,
    chip: 'A18',
    chipTier: 18,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 48,
    cameraCount: 2,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 22,
    iosSupportNote: IOS_LONG,
    highlights: [
      'ปุ่มกล้อง Camera Control',
      'ชิป A18 รองรับ Apple Intelligence',
      'กล้องหลัก 48MP + อัลตร้าไวด์ถ่ายมาโครได้',
    ],
  }),
  spec({
    model: 'iPhone 16 Plus',
    generation: 16,
    variant: 'plus',
    year: 2024,
    chip: 'A18',
    chipTier: 18,
    displayInch: 6.7,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 48,
    cameraCount: 2,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 27,
    iosSupportNote: IOS_LONG,
    highlights: [
      'จอใหญ่ 6.7" แบตอึดมาก',
      'ปุ่มกล้อง Camera Control',
      'ชิป A18 รองรับ Apple Intelligence',
    ],
  }),
  spec({
    model: 'iPhone 16 Pro',
    generation: 16,
    variant: 'pro',
    year: 2024,
    chip: 'A18 Pro',
    chipTier: 18.5,
    displayInch: 6.3,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 3,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 27,
    iosSupportNote: IOS_LONG,
    highlights: ['จอ 6.3" ขอบบางลง 120Hz', 'ซูม 5 เท่า + อัลตร้าไวด์ 48MP', 'ถ่ายวิดีโอ 4K 120fps'],
  }),
  spec({
    model: 'iPhone 16 Pro Max',
    generation: 16,
    variant: 'promax',
    year: 2024,
    chip: 'A18 Pro',
    chipTier: 18.5,
    displayInch: 6.9,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 3,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 33,
    iosSupportNote: IOS_LONG,
    highlights: ['จอใหญ่สุด 6.9" 120Hz', 'แบตอึดสุดในรุ่น 16', 'ซูม 5 เท่า + วิดีโอ 4K 120fps'],
  }),
  // ── 2025 ──
  spec({
    model: 'iPhone 16e',
    generation: 16,
    variant: 'e',
    year: 2025,
    chip: 'A18',
    chipTier: 18,
    displayInch: 6.1,
    displayType: 'OLED',
    refreshHz: 60,
    mainCameraMp: 48,
    cameraCount: 1,
    has5G: true,
    usbC: true,
    batteryVideoHours: 26,
    iosSupportNote: IOS_LONG,
    highlights: [
      'ชิป A18 ตัวเดียวกับ iPhone 16',
      'แบตอึดกว่า iPhone 16',
      'Face ID + USB-C ในรุ่นเริ่มต้น',
    ],
  }),
  spec({
    model: 'iPhone 17',
    generation: 17,
    variant: 'base',
    year: 2025,
    chip: 'A19',
    chipTier: 19,
    displayInch: 6.3,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 2,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 30,
    iosSupportNote: IOS_LONG,
    highlights: [
      'รุ่นธรรมดารุ่นแรกที่ได้จอ 120Hz',
      'กล้องหลัง 48MP ทั้ง 2 ตัว',
      'แบตอึดกว่า 16 ชัดเจน',
    ],
  }),
  spec({
    model: 'iPhone Air',
    generation: 17,
    variant: 'air',
    year: 2025,
    chip: 'A19 Pro',
    chipTier: 19.5,
    displayInch: 6.5,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 1,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 27,
    iosSupportNote: IOS_LONG,
    highlights: [
      'บางที่สุดเท่าที่ iPhone เคยมี',
      'ชิป A19 Pro ตัวเดียวกับรุ่น Pro',
      'จอ 6.5" 120Hz',
    ],
  }),
  spec({
    model: 'iPhone 17 Pro',
    generation: 17,
    variant: 'pro',
    year: 2025,
    chip: 'A19 Pro',
    chipTier: 19.5,
    displayInch: 6.3,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 3,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 31,
    iosSupportNote: IOS_LONG,
    highlights: [
      'กล้องหลัง 48MP ทั้ง 3 ตัว ซูม 8 เท่า',
      'ระบายความร้อนใหม่ เล่นเกมไม่ตก',
      'แบตอึดกว่า 16 Pro',
    ],
  }),
  spec({
    model: 'iPhone 17 Pro Max',
    generation: 17,
    variant: 'promax',
    year: 2025,
    chip: 'A19 Pro',
    chipTier: 19.5,
    displayInch: 6.9,
    displayType: 'OLED',
    refreshHz: 120,
    mainCameraMp: 48,
    cameraCount: 3,
    has5G: true,
    usbC: true,
    dynamicIsland: true,
    batteryVideoHours: 37,
    iosSupportNote: IOS_LONG,
    highlights: [
      'แบตอึดที่สุดเท่าที่ iPhone เคยมี',
      'กล้องหลัง 48MP ทั้ง 3 ตัว ซูม 8 เท่า',
      'จอใหญ่ 6.9" 120Hz',
    ],
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// findDeviceSpec
// ─────────────────────────────────────────────────────────────────────────────

const byKey = (generation: number, variant: DeviceVariant): DeviceSpec | null =>
  DEVICE_SPECS.find((s) => s.generation === generation && s.variant === variant) ?? null;

const byModel = (model: string): DeviceSpec | null =>
  DEVICE_SPECS.find((s) => s.model === model) ?? null;

/** เลขความจุ 128gb / 1 tb — ตัดทิ้งก่อนเดารุ่น (กัน '256' ถูกจับเป็นเลขรุ่น) */
const STORAGE_RE = /\d+\s*(?:gb|tb|กิ๊ก|กิก)\b/gi;

/**
 * คำไทยที่แปลงเป็น token อังกฤษก่อน match (เรียงยาว→สั้น: 'โปรแม็กซ์' ต้องชนะ 'โปร')
 *  - 'โปร(?!โม)' กัน 'โปรโมชั่น' กลายเป็น pro
 *  - 'แอร์(?!พอด)' กัน 'แอร์พอด' (AirPods) กลายเป็น air
 *  - 'อี' ไม่แปลงที่นี่ (ชนคำว่า 'อีก') — จัดการเฉพาะหลังเลข 16 ใน E_RE
 */
const THAI_ALIASES: [RegExp, string][] = [
  [/โปรแม็กซ์|โปรแมกซ์|โปรแม็ก|โปรแมก/g, ' promax '],
  [/พลัส/g, ' plus '],
  [/โปร(?!โม)/g, ' pro '],
  [/มินิ/g, ' mini '],
  [/เอ็กซ์เอสแม็กซ์|เอ็กซ์เอสแมกซ์|เอ็กซ์เอสแม็ก|เอ็กซ์เอสแมก/g, ' xsmax '],
  [/เอ็กซ์เอส/g, ' xs '],
  [/เอ็กซ์อาร์/g, ' xr '],
  [/เอ็กซ์|เท็น/g, ' x '],
  [/เอสอี/g, ' se '],
  [/แอร์(?!พอด)/g, ' air '],
  [/ไอโฟน|iphone/g, ' '],
];

/**
 * เลขรุ่น 7-17 + variant ติดกัน. กันไม่ให้จับ:
 *  - เลขที่มีหลักต่อ (128, 256, 15000) → `(?![\d,.]\d)` และ lookbehind `(?<![a-z\d])`
 *  - 'ios 17', 'a13' (ชื่อชิป)
 *  - เลขที่ตามด้วยหน่วยเงิน/เวลา ('ผ่อน 12 งวด', 'ดอก 15%', '11 บาท')
 * variant ต้องตามด้วยตัวที่ไม่ใช่ a-z เพื่อไม่ให้ '15 each' กลายเป็น e / '15 per' กลายเป็น p
 */
const MODEL_RE =
  /(?<!ios\s*)(?<![a-z\d])(1[0-7]|[7-9])(?![\d,.]\d)\s*(pro\s*max|promax|pm|plus|\+|pro|p|mini|e)?(?![a-z])(?!\s*(?:gb|tb|กิ๊ก|กิก|งวด|เดือน|บาท|ปี|วัน|ชม|%|คน))/i;

const X_FAMILY: [RegExp, string][] = [
  [/\bxs\s*max\b/i, 'iPhone XS Max'],
  [/\bxsmax\b/i, 'iPhone XS Max'],
  [/\bxs(?![a-z])/i, 'iPhone XS'],
  [/\bxr(?![a-z])/i, 'iPhone XR'],
  [/\bx(?![a-z])/i, 'iPhone X'],
];
const AIR_RE = /\bair(?![a-z])/i;
/** 'se', 'se2', 'se 2020', 'se (2022)', 'se3' — ไม่ระบุปี → SE (2022) */
const SE_RE = /\bse(?![a-z])\s*\(?\s*(2020|2022|2023|gen\s*2|gen\s*3|2|3)?/i;
/** '16e', '16 e', '16อี' (อี ต้องไม่ตามด้วยพยัญชนะไทย — กัน 'อีก') */
const E_RE = /(?<![a-z\d])16\s*(?:e(?![a-z])|อี(?![ก-ฮ]))/i;

const VARIANT_OF: Record<string, DeviceVariant> = {
  promax: 'promax',
  pm: 'promax',
  plus: 'plus',
  '+': 'plus',
  pro: 'pro',
  p: 'pro',
  mini: 'mini',
  e: 'e',
};

interface Hit {
  index: number;
  spec: DeviceSpec | null;
}

/**
 * หา spec จากข้อความลูกค้า: 'ใช้ 11 อยู่', 'ไอโฟน XR', 'iphone 13 pro max', '15พลัส',
 * 'SE', '16e', 'ไอโฟนแอร์', 'เอ็กซ์เอส' → null ถ้าไม่รู้จัก
 *
 * ถ้าข้อความพูดถึงหลายรุ่น ('ใช้ XR อยู่ อยากได้ 15') คืนรุ่นที่ปรากฏก่อน
 * รุ่นที่ไม่มีจริง ('12 plus', '14 mini') → null (ไม่เดาเป็นรุ่นอื่นให้)
 */
export function findDeviceSpec(text: string): DeviceSpec | null {
  let t = (text ?? '').toLowerCase().replace(STORAGE_RE, ' ');
  for (const [re, rep] of THAI_ALIASES) t = t.replace(re, rep);
  // 'ip15' / 'ip xr' — ตัด prefix ip เฉพาะที่ตามด้วยสิ่งที่ดูเป็นรุ่น (ไม่แตะ 'zip', 'vip')
  t = t.replace(/\bip(?=\s*(?:\d|x|se|air|promax|pro|plus|mini))/g, ' ');

  const hits: Hit[] = [];

  const eMatch = E_RE.exec(t);
  if (eMatch) hits.push({ index: eMatch.index, spec: byModel('iPhone 16e') });

  const airMatch = AIR_RE.exec(t);
  if (airMatch) hits.push({ index: airMatch.index, spec: byModel('iPhone Air') });

  const seMatch = SE_RE.exec(t);
  if (seMatch) {
    const y = (seMatch[1] ?? '').replace(/\s+/g, '');
    const is2020 = y === '2020' || y === '2' || y === 'gen2';
    hits.push({
      index: seMatch.index,
      spec: byModel(is2020 ? 'iPhone SE (2020)' : 'iPhone SE (2022)'),
    });
  }

  for (const [re, model] of X_FAMILY) {
    const m = re.exec(t);
    if (m) {
      hits.push({ index: m.index, spec: byModel(model) });
      break; // เรียงยาว→สั้นแล้ว ตัวแรกที่เจอคือตัวที่ถูก
    }
  }

  const numMatch = MODEL_RE.exec(t);
  if (numMatch) {
    const gen = Number(numMatch[1]);
    const rawVariant = (numMatch[2] ?? '').replace(/\s+/g, '');
    const variant: DeviceVariant = rawVariant ? VARIANT_OF[rawVariant] : 'base';
    const numSpec =
      gen === 10 ? (variant === 'base' ? byModel('iPhone X') : null) : byKey(gen, variant);
    hits.push({ index: numMatch.index, spec: numSpec });
  }

  if (hits.length === 0) return null;
  // "iPhone 17 Air" / "ไอโฟน 17 แอร์": เลข 17 มาก่อน "air" ในข้อความ แต่เป็นรุ่นเดียวกัน →
  // คำเฉพาะ (Air/16e) ที่อยู่ติดหลังเลขรุ่นต้องชนะ ไม่งั้นได้สเปค iPhone 17 ผิดรุ่น (รีวิว 2026-08-23)
  hits.sort((a, b) => a.index - b.index);
  const named = hits.find((h) => h.spec && (h.spec.variant === 'air' || h.spec.variant === 'e'));
  if (named && hits[0] !== named && named.index - hits[0].index <= 6) return named.spec;
  return hits[0].spec;
}

// ─────────────────────────────────────────────────────────────────────────────
// compareDevices
// ─────────────────────────────────────────────────────────────────────────────

export interface DeviceDiff {
  better: string[];
  same: string[];
  worse: string[];
  generationGap: number;
}

/** จำนวนข้อ better (ไม่นับ iOS note ที่ต่อท้าย) */
const MAX_BETTER = 3;

interface Ranked {
  score: number;
  text: string;
}

// เกณฑ์จากผล benchmark จริงโดยประมาณ: A13→A16 ~1.6 เท่า, A15→A18 ~1.5 เท่า — "2 เท่า" ต้องห่าง ≥5 รุ่น
// (รีวิว 2026-08-23: เดิม gap ≥3 บอก "2 เท่า" = เกินจริงกับคู่ที่เจอบ่อยที่สุด)
const chipPhrase = (tierGap: number): string => {
  if (tierGap >= 5) return 'เร็วกว่าเดิมราว 2 เท่า';
  if (tierGap >= 3) return 'เร็วขึ้นมาก';
  if (tierGap >= 2) return 'เร็วขึ้นชัดเจน';
  return 'เร็วขึ้นอีกนิด';
};

const lensNote = (count: number): string => {
  if (count >= 3) return 'มีเลนส์ซูม';
  if (count === 2) return 'มีอัลตร้าไวด์';
  return '';
};

/**
 * เทียบ candidate กับ current → ประโยคไทยสั้น ๆ ใช้ตอบลูกค้าได้ทันที
 * better เรียงตามผลกระทบมาก→น้อย สูงสุด 3 ข้อ (+ iOS note ต่อท้ายถ้าต่างกัน), ไม่มีตัวเลขเงิน
 * worse ซื่อสัตย์ทุกข้อ — บอทเอาไปบอกลูกค้าตรง ๆ
 */
/** ตัด emoji/สัญลักษณ์นำหน้าออก — กฎ BASE จำกัด emoji ต่อข้อความ ประโยคจาก tool ต้องสะอาด */
const stripLeadingEmoji = (t: string): string =>
  t.replace(/^[^\p{L}\p{N}]+/u, '').trim();

export function compareDevices(current: DeviceSpec, candidate: DeviceSpec): DeviceDiff {
  const diff = compareDevicesRaw(current, candidate);
  return {
    ...diff,
    better: diff.better.map(stripLeadingEmoji),
    same: diff.same.map(stripLeadingEmoji),
    worse: diff.worse.map(stripLeadingEmoji),
  };
}

function compareDevicesRaw(current: DeviceSpec, candidate: DeviceSpec): DeviceDiff {
  const better: Ranked[] = [];
  const worse: Ranked[] = [];
  const same: string[] = [];

  // ⚡ ชิป
  const tierGap = candidate.chipTier - current.chipTier;
  const curChip = chipShort(current.chip);
  const candChip = chipShort(candidate.chip);
  if (tierGap > 0) {
    better.push({
      score: tierGap >= 3 ? 100 : tierGap >= 2 ? 70 : 40,
      text: `⚡ ชิป ${curChip} → ${candChip} ${chipPhrase(tierGap)}`,
    });
  } else if (tierGap < 0) {
    worse.push({ score: 100, text: `ชิป ${candChip} ช้ากว่า ${curChip} ที่ใช้อยู่` });
  } else {
    same.push(curChip === candChip ? `ชิป ${curChip} ตัวเดียวกัน` : 'ความเร็วชิปใกล้เคียงเดิม');
  }

  // 📷 กล้องหลัก MP
  if (candidate.mainCameraMp > current.mainCameraMp) {
    better.push({
      score: 90,
      text: `📷 กล้องหลัก ${current.mainCameraMp}MP → ${candidate.mainCameraMp}MP คมชัดขึ้นมาก`,
    });
  } else if (candidate.mainCameraMp < current.mainCameraMp) {
    worse.push({
      score: 90,
      text: `กล้องหลักความละเอียดลดลง ${current.mainCameraMp}MP → ${candidate.mainCameraMp}MP`,
    });
  } else {
    same.push('กล้องหลักความละเอียดเท่าเดิม');
  }

  // 📷 จำนวนกล้องหลัง
  if (candidate.cameraCount > current.cameraCount) {
    const note = lensNote(candidate.cameraCount);
    better.push({
      score: 60,
      text: `📷 กล้องหลังเพิ่มเป็น ${candidate.cameraCount} ตัว${note ? ` ${note}` : ''}`,
    });
  } else if (candidate.cameraCount < current.cameraCount) {
    const lost =
      candidate.cameraCount === 1 && current.cameraCount >= 3
        ? ' ไม่มีเลนส์ซูมและอัลตร้าไวด์'
        : candidate.cameraCount === 1
          ? ' ไม่มีอัลตร้าไวด์'
          : ' ไม่มีเลนส์ซูม';
    worse.push({ score: 60, text: `กล้องหลังลดเหลือ ${candidate.cameraCount} ตัว${lost}` });
  } else {
    same.push(`กล้องหลัง ${current.cameraCount} ตัวเท่าเดิม`);
  }

  // 📶 5G
  if (candidate.has5G && !current.has5G) better.push({ score: 75, text: '📶 รองรับ 5G' });
  else if (!candidate.has5G && current.has5G) worse.push({ score: 75, text: 'ไม่รองรับ 5G' });

  // 🖥️ ชนิดจอ
  if (candidate.displayType === 'OLED' && current.displayType === 'LCD') {
    better.push({ score: 65, text: '🖥️ จอ OLED สีสดกว่า ดำสนิท' });
  } else if (candidate.displayType === 'LCD' && current.displayType === 'OLED') {
    worse.push({ score: 65, text: 'จอ LCD สีไม่สดเท่า OLED ที่ใช้อยู่' });
  }

  // 🖥️ Hz
  if (candidate.refreshHz > current.refreshHz) {
    better.push({ score: 55, text: '🖥️ จอลื่น 120Hz' });
  } else if (candidate.refreshHz < current.refreshHz) {
    worse.push({ score: 55, text: 'จอ 60Hz ไม่ลื่นเท่า 120Hz ที่ใช้อยู่' });
  }

  // 🖥️ ขนาดจอ
  if (candidate.displayInch > current.displayInch) {
    better.push({ score: 45, text: `🖥️ จอใหญ่ขึ้นเป็น ${candidate.displayInch}"` });
  } else if (candidate.displayInch < current.displayInch) {
    worse.push({
      score: 45,
      text: `จอเล็กลงจาก ${current.displayInch}" เป็น ${candidate.displayInch}"`,
    });
  } else {
    same.push(`จอขนาด ${current.displayInch}" เท่าเดิม`);
  }

  // 🔋 แบต
  const battGap = candidate.batteryVideoHours - current.batteryVideoHours;
  if (battGap >= 2) {
    better.push({ score: 50 + battGap * 2, text: `🔋 แบตนานขึ้น ~${battGap} ชม.` });
  } else if (battGap <= -2) {
    worse.push({ score: 50 + -battGap * 2, text: `แบตสั้นกว่าเดิม ~${-battGap} ชม.` });
  } else {
    same.push('แบตใกล้เคียงเดิม');
  }

  // 🔒 Face ID
  if (candidate.faceId && !current.faceId) better.push({ score: 50, text: '🔒 สแกนหน้า Face ID' });
  else if (!candidate.faceId && current.faceId) {
    worse.push({ score: 50, text: 'ไม่มี Face ID (ใช้ปุ่มโฮม Touch ID แทน)' });
  }

  // 🔌 USB-C
  if (candidate.usbC && !current.usbC) {
    better.push({ score: 35, text: '🔌 พอร์ต USB-C สายเดียวกับ iPad' });
  } else if (!candidate.usbC && current.usbC) {
    worse.push({ score: 35, text: 'กลับไปใช้สาย Lightning' });
  }

  // ✨ Dynamic Island
  if (candidate.dynamicIsland && !current.dynamicIsland) {
    better.push({ score: 20, text: '✨ มี Dynamic Island' });
  } else if (!candidate.dynamicIsland && current.dynamicIsland) {
    worse.push({ score: 20, text: 'ไม่มี Dynamic Island' });
  }

  const rank = (xs: Ranked[]): string[] => xs.sort((a, b) => b.score - a.score).map((x) => x.text);
  const betterOut = rank(better).slice(0, MAX_BETTER);
  const worseOut = rank(worse);

  // 📱 iOS — ต่อท้ายเสมอถ้าต่างกัน (ไม่นับในโควตา 3 ข้อ)
  const iosGap = iosTier(candidate.iosSupportNote) - iosTier(current.iosSupportNote);
  if (iosGap > 0) betterOut.push(`📱 ${candidate.iosSupportNote}`);
  else if (iosGap < 0) worseOut.push(candidate.iosSupportNote);

  return {
    better: betterOut,
    same,
    worse: worseOut,
    generationGap: candidate.generation - current.generation,
  };
}
