import { Injectable, OnModuleInit } from '@nestjs/common';
import { ACCESS_BOUNDARIES } from './access-policy.registry';

/**
 * ขอบเขตของ route ลงเวลา (ก้อน 10 D3) สำหรับตอนเปิดระบบสิทธิ์ตามตำแหน่ง (`accessManaged=true`)
 * - staff route ที่ไม่ใช่ OWNER ต้องมี boundary ไม่งั้น 403 RESOURCE_BOUNDARY_REQUIRED (access-policy.ts)
 * - ข้อมูลลงเวลาเป็นของ SHOP ทั้งหมด · การกรองสาขาจริงทำใน AttendanceService.assertBranchScope จาก `user.branchId`
 *   ⇒ boundary นี้ประกาศเป็น collection ของ SHOP และคืน scope ให้ handler ตามสัญญาของ engine โดยไม่ซ้อนการกรองอีกชั้น
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
        kind: 'collection',
        company: 'SHOP',
        execute: async (scope: unknown) => scope,
      }));
    }
  }
}
