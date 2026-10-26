import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { homeActionsForRole } from '@/config/work-navigation';

/** ตารางปุ่ม "เริ่มงาน" ตามบทบาท — ใช้ร่วมกันระหว่างหน้าเริ่มงาน (StaffHome) และหน้าหลักหน้าร้าน (SALES) */
export default function HomeActionsGrid({ role }: { role: string }) {
  const actions = homeActionsForRole(role);
  if (actions.length === 0) return null;

  return (
    <section aria-labelledby="start-work-title">
      <h2 id="start-work-title" className="text-base font-semibold leading-snug">
        เริ่มงาน
      </h2>
      <p className="mt-1 text-sm text-muted-foreground leading-snug">
        เลือกงานที่ต้องการทำ ระบบจะพาไปยังหน้าที่เกี่ยวข้อง
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {actions.map(({ id, label, description, path, icon: Icon }) => (
          <Link
            key={id}
            to={path}
            className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <ArrowRight
                className="size-4 text-muted-foreground group-hover:text-primary"
                aria-hidden="true"
              />
            </span>
            <span className="text-base font-semibold leading-snug">{label}</span>
            <span className="text-sm text-muted-foreground leading-snug">{description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
