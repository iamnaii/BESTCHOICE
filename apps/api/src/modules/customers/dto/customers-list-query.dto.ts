import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ContractStatus, CreditCheckStatus, CustomerCreditCheckStatus } from '@prisma/client';
import {
  CUSTOMER_INSTALLMENT_STATES,
  CUSTOMER_PURCHASE_KINDS,
  CUSTOMER_PURCHASED_WITHIN,
  CUSTOMER_SORT_KEYS,
  CUSTOMER_VIEWS,
  PROSPECT_CONTACTED_WITHIN,
  PROSPECT_SORT_KEYS,
  PROSPECT_SOURCES,
} from '@installment/shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** ระดับลูกค้า — ยังไม่มี enum ใน schema (CustomerTierService คำนวณสด) */
export const CUSTOMER_TIERS = ['GOLD', 'GOOD', 'NEW', 'RISKY', 'BLACKLIST'] as const;

/**
 * คีย์เรียงที่ findAll "ทำตามจริง" — ทุกตัวเรียงที่ฐานข้อมูลได้
 *
 * 🔴 `lastPurchaseAt` / `lastContactAt` อยู่ใน CUSTOMER_SORT_KEYS / PROSPECT_SORT_KEYS
 * ของ packages/shared แต่ **ไม่อยู่ในรายการนี้** เพราะทั้งคู่เป็น aggregate ของ
 * relation (MAX(sales.created_at) / MAX(chat_rooms.last_customer_at)) ซึ่ง Prisma
 * orderBy ทำไม่ได้ และการจัดเรียงในหน่วยความจำต้องดึงทุกแถวที่ match ก่อน paginate
 * (สาขาเดียวกับ tier/creditScore ที่ findMany แบบไม่จำกัดจำนวน) ⇒ ส่งมาก็ถูกมองข้าม
 * แล้วตกไปเรียง createdAt desc — ฝั่งเว็บต้อง **ไม่** ทำหัวคอลัมน์สองตัวนี้ให้กดได้
 */
export const HONOURED_CUSTOMER_SORT_KEYS = ['name', 'createdAt', 'contractCount', 'creditScore'] as const;

const ALL_SORT_KEYS = [...new Set<string>([...CUSTOMER_SORT_KEYS, ...PROSPECT_SORT_KEYS])];

/**
 * พารามิเตอร์ของ GET /customers และ GET /customers/export
 *
 * ชื่อพารามิเตอร์อ้างอิง PLAN §4 ทุกตัว และรับ **ชื่อพ้อง** ที่ URL ของหน้าเว็บใช้ด้วย
 * (bought = purchasedWithin · precheck = creditCheckStatus · owner = assignedToId · q = search)
 * เพื่อให้ URL ที่ bookmark ไว้และ deep-link จากหน้าอื่นใช้ได้ทั้งสองแบบ
 * การรวมชื่อพ้องทำที่ CustomerQueryService.findAll (normalizeFilters) ไม่ใช่ที่ controller
 * ⇒ ทั้ง list และ export เห็นค่าเดียวกันเสมอ
 */
export class CustomersListQueryDto extends PaginationDto {
  // ---- ร่วมสองแท็บ -------------------------------------------------------
  /** ไม่ส่ง = ทุกคน (หน้าอื่น 5 จุดใช้ endpoint นี้เป็นตัวเลือกคน ต้องเจอคนที่ยังไม่เคยซื้อ) */
  @IsOptional() @IsIn([...CUSTOMER_VIEWS]) view?: string;
  @IsOptional() @IsString() @MaxLength(500) search?: string;
  /** ชื่อพ้องของ search (URL ของหน้าเว็บใช้ ?q=) */
  @IsOptional() @IsString() @MaxLength(500) q?: string;
  @IsOptional() @IsIn(ALL_SORT_KEYS) sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: string;

  // ---- แท็บ ลูกค้า -------------------------------------------------------
  @IsOptional() @IsIn([...CUSTOMER_PURCHASE_KINDS]) purchase?: string;
  /** อ่านเฉพาะเมื่อ purchase = INSTALLMENT */
  @IsOptional() @IsIn([...CUSTOMER_INSTALLMENT_STATES]) state?: string;
  @IsOptional() @IsIn([...CUSTOMER_PURCHASED_WITHIN]) purchasedWithin?: string;
  /** ชื่อพ้องของ purchasedWithin (URL ใช้ ?bought=) */
  @IsOptional() @IsIn([...CUSTOMER_PURCHASED_WITHIN]) bought?: string;
  @IsOptional() @IsIn([...CUSTOMER_TIERS]) tier?: string;
  @IsOptional() @IsString() @MaxLength(128) branchId?: string;

  // ---- ที่มา (ร่วมสองแท็บ — Task 13 fix round, R16) -----------------------
  // 🔴 เคยอยู่ใต้หัวข้อ "แท็บ ผู้สนใจ" แต่ source ใช้ได้ทั้งสองแท็บมาตั้งแต่ Task 13
  // (ลูกค้าที่ซื้อแล้วก็มี "ที่มา" เหมือนกัน — มาจากแชท/คนแนะนำ/walk-in) ย้ายมาไว้หัวข้อ
  // ของตัวเองกัน fromChat ที่เพิ่มใหม่ถูกเข้าใจผิดว่าเป็นตัวกรองเฉพาะแท็บผู้สนใจไปด้วย
  @IsOptional() @IsIn([...PROSPECT_SOURCES]) source?: string;
  /**
   * "มาจากแชท" (Task 13 fix round, R16) — กดการ์ด KPI "มาจากแชท" แล้วกรองซ้ำ (กดแล้วกรอง)
   * ใช้ predicate เดียวกับที่ KPI นับ (CHAT_SOURCE_WHERE/NOT_CHAT_SOURCE_WHERE ใน
   * CustomerQueryService) ไม่ใช่ overload ของ `source` — 🔴 ต้องเป็น **string** ไม่ใช่ boolean
   * ด้วยเหตุผลเดียวกับ `hasOverdue` ด้านล่าง (enableImplicitConversion ทำ Boolean('false') === true)
   */
  @IsOptional() @IsIn(['true', 'false']) fromChat?: string;

  // ---- แท็บ ผู้สนใจ ------------------------------------------------------
  /**
   * สถานะเครดิตของ **ลูกค้า** (CustomerCreditCheckStatus) — คนละ enum กับ creditStatus
   * ส่งสมาชิกของ CreditCheckStatus มาที่ฟิลด์นี้เคยทำให้ Prisma โยน 500
   */
  @IsOptional() @IsIn(Object.values(CustomerCreditCheckStatus)) creditCheckStatus?: string;
  /** ชื่อพ้องของ creditCheckStatus (URL ใช้ ?precheck=) */
  @IsOptional() @IsIn(Object.values(CustomerCreditCheckStatus)) precheck?: string;
  /** แท็บผู้สนใจ: CustomerTagType คั่นด้วย comma เช่น VIP,HIGH_RISK */
  @IsOptional() @IsString() @MaxLength(200) tag?: string;
  @IsOptional() @IsIn([...PROSPECT_CONTACTED_WITHIN]) contacted?: string;
  /** userId ของพนักงาน หรือคำว่า unassigned */
  @IsOptional() @IsString() @MaxLength(128) assignedToId?: string;
  /** ชื่อพ้องของ assignedToId (URL ใช้ ?owner=) */
  @IsOptional() @IsString() @MaxLength(128) owner?: string;

  // ---- ตัวกรองเดิมที่ยังมีผู้เรียก ---------------------------------------
  /** deep-link เก่า: DashboardWatchList ยิง /customers?contractStatus=ACTIVE */
  @IsOptional() @IsIn(Object.values(ContractStatus)) contractStatus?: string;
  /**
   * 🔴 ต้องเป็น **string** ไม่ใช่ boolean
   *
   * ValidationPipe ของแอปตั้ง `transformOptions.enableImplicitConversion: true`
   * (app.setup.ts) ⇒ class-transformer จะแปลงค่าตาม `design:type` ของฟิลด์ **ก่อน**
   * ที่ @Transform ของเราจะได้ทำงาน และ `Boolean('false') === true`
   * ⇒ `?hasOverdue=false` เคยกลายเป็น true แล้ว "เปิด" ตัวกรองแทนที่จะปิด
   * ประกาศเป็น string แล้วแปลงค่าที่ findAll (CustomerQueryService) ที่เดียว
   */
  @IsOptional() @IsIn(['true', 'false']) hasOverdue?: string;
  /** สถานะของ **ใบตรวจเครดิต** (CreditCheckStatus) — คนละฟิลด์กับ creditCheckStatus */
  @IsOptional() @IsIn(Object.values(CreditCheckStatus)) creditStatus?: string;
}
