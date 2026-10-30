import { Injectable, OnModuleInit } from '@nestjs/common';
import { ACCESS_BOUNDARIES } from './access-policy.registry';

/**
 * ขอบเขตของ route ลงเวลา (ก้อน 10 D3) สำหรับตอนเปิดระบบสิทธิ์ตามตำแหน่ง (`accessManaged=true`)
 * - staff route ที่ไม่ใช่ OWNER ต้องมี boundary ไม่งั้น 403 RESOURCE_BOUNDARY_REQUIRED (access-policy.ts)
 * - ข้อมูลลงเวลาเป็นของ SHOP ทั้งหมด · การกรองสาขาจริงทำใน AttendanceService.assertBranchScope จาก `user.branchId`
 * - ใช้ `selection` (ห่อ handler: engine ตรวจว่ามีสิทธิ์ใน SHOP แล้วเรียก handler จริง) — ห้ามใช้ `collection`
 *   เพราะ interceptor คืนผลของ execute(scope) **แทน** handler (รีวิว I1: หน้าได้ scope แทนข้อมูล · PATCH/PUT ตอบ 200 โดยไม่บันทึก)
 * - manifest ของ route เหล่านี้ต้องเป็น `resolution: 'record'` (policy รับ selection เฉพาะ record)
 */
export const ATTENDANCE_BOUNDARY_ROUTES = [
  'AttendanceController.today',
  'AttendanceController.month',
  'AttendanceController.photo',
  'AttendanceController.correctDay',
  'AttendanceController.setDayKinds',
];

@Injectable()
export class AccessAttendanceBoundary implements OnModuleInit {
  onModuleInit() {
    for (const route of ATTENDANCE_BOUNDARY_ROUTES) {
      ACCESS_BOUNDARIES.set(route, async () => ({
        kind: 'selection',
        company: 'SHOP',
        execute: (handler) => handler(),
      }));
    }
  }
}
