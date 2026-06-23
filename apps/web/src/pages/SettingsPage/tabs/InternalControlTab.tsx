import { MakerCheckerToggle } from '../components/MakerCheckerToggle';
import { ReversePermissionCard } from '../components/ReversePermissionCard';
import { ReverseReasonsManagementCard } from '../components/ReverseReasonsManagementCard';
import { PettyCashCustodianCard } from '../components/PettyCashCustodianCard';
import { TestModeToggle } from '../components/TestModeToggle';

/**
 * InternalControlActionBar — Settings tab รวมการตั้งค่า "ควบคุมภายใน & สิทธิ์"
 * ทั้งหมดขององค์กร. Consolidated 2026-06-23 (Direction B): ย้าย 4 การ์ดจากแท็บ
 * "ผู้ใช้งาน" เดิม (Maker-Checker, สิทธิ์กลับรายการ, ผู้ดูแลเงินสดย่อย, โหมดทดสอบ)
 * มารวมที่นี่ เพื่อให้ /users เป็นการจัดการผู้ใช้ล้วนๆ. คู่ reverse (Setting 1
 * ReversePermissionCard + Setting 2 ReverseReasonsManagementCard) กลับมาอยู่ด้วยกัน.
 *
 * Permission gating: SettingsPage redirect non-OWNER ออกทั้ง route แล้ว ไม่ต้อง guard ซ้ำ.
 */
const sectionLabel = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-snug';

export function InternalControlTab() {
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className={sectionLabel}>การอนุมัติ & สิทธิ์</h3>
        <MakerCheckerToggle />
        <ReversePermissionCard />
        <ReverseReasonsManagementCard />
      </section>

      <section className="space-y-4">
        <h3 className={sectionLabel}>เงินสด</h3>
        <PettyCashCustodianCard />
      </section>

      <section className="space-y-4">
        <h3 className={`${sectionLabel} text-destructive`}>ความปลอดภัย</h3>
        <TestModeToggle />
      </section>
    </div>
  );
}
