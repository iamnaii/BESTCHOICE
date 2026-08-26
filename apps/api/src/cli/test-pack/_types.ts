import type { PrismaService } from '../../prisma/prisma.service';

/** ข้อมูลอ้างอิงที่ทุกโดเมนใช้ร่วมกัน — resolve ครั้งเดียวตอนเริ่ม */
export interface SeedRefs {
  branchId: string;
  branchName: string;
  /** สาขาที่สอง — ใช้กับโอนย้ายสต็อก; null เมื่อมีสาขาเดียว (โดเมนนั้นจะข้ามเอง) */
  secondBranchId: string | null;
  salespersonId: string;
  /** OWNER หรือ BRANCH_MANAGER — ผู้บันทึก/ผู้ตรวจทั่วไป */
  reviewerId: string;
  /** OWNER เท่านั้น — ใช้เป็นผู้อนุมัติที่ต้องต่างจากผู้บันทึก */
  ownerId: string;
  shopCompanyId: string | null;
  financeCompanyId: string | null;
}

export interface SeedContext {
  prisma: PrismaService;
  refs: SeedRefs;
  dryRun: boolean;
  /** เที่ยงคืนของวันไทยวันนี้ */
  today: Date;
  /** YYYYMMDD ตามเวลาไทย — ใช้ประกอบเลขเอกสาร TEST- */
  dateStr: string;
}

/** หนึ่งบรรทัดที่ dry-run พิมพ์ออกมา */
export interface PlanRow {
  label: string;
  detail: string;
}

export interface SeedStat {
  created: number;
  skipped: number;
  /** ข้อความไทยที่ orchestrator พิมพ์ใต้ชื่อโดเมน เช่น เหตุผลที่ข้าม */
  notes: string[];
}

export interface CleanupStat {
  /** ชื่อสิ่งที่ลบ → จำนวน เช่น { 'ใบค่าใช้จ่าย': 4 } */
  removed: Record<string, number>;
  /** คำเตือนที่ต้องเด้งให้คนกดเห็น เช่น ตารางที่รอดข้าม factory reset */
  warnings: string[];
}

export interface DomainSeeder {
  /** ชื่อสั้นสำหรับ DOMAINS= — ตัวพิมพ์เล็ก ขีดกลาง */
  key: string;
  /** ชื่อไทยสำหรับพิมพ์บนหน้าจอ */
  label: string;
  /** route ที่โดเมนนี้ปลดล็อก — Task 13 ใช้ generate ตารางใน README */
  routes: string[];
  /** วิธีที่ cleanup ค้นแถวของโดเมนนี้ (ข้อความไทย) — Task 13 ใช้ generate ตาราง KEEP/WIPE */
  markerDoc: string;
  /** dry-run: บอกว่าจะสร้างอะไร ห้ามเขียน DB */
  plan(ctx: SeedContext): Promise<PlanRow[]>;
  seed(ctx: SeedContext): Promise<SeedStat>;
  cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat>;
}
