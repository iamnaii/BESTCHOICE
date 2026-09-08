import { useState } from 'react';
import { useParams, useNavigate, useLocation, Link, Outlet } from 'react-router';
import { ChevronRight, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { visibleCategories, categoryById, searchSettings } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';

/** ตั้งค่าลึก 3 ชั้น (หมวด → รายการ → หน้าย่อย) — ต้องบอกตำแหน่ง และต้องมีทางออกที่สอง
 *  นอกจากแถบในเมนู. "หน้าหลัก" เป็นลิงก์ธรรมดาไป '/' ได้เพราะ MainLayout รีเซ็ตโซนให้เอง
 *  เมื่อไปถึง path กลาง (ดู COMMON_PATHS) — ไม่ต้องพึ่ง context ในหน้านี้ */
function Crumbs({ categoryLabel, categoryId }: { categoryLabel?: string; categoryId?: string }) {
  const sep = <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />;
  return (
    <nav aria-label="เส้นทาง" className="flex items-center gap-1.5 text-[12px] leading-snug">
      <Link to="/" className="text-muted-foreground hover:text-primary transition-colors">
        หน้าหลัก
      </Link>
      {sep}
      {categoryLabel && categoryId ? (
        <>
          <Link
            to={`/settings/${categoryId}`}
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            ตั้งค่าระบบ
          </Link>
          {sep}
          <span className="font-medium text-foreground truncate">{categoryLabel}</span>
        </>
      ) : (
        <span className="font-medium text-foreground">ตั้งค่าระบบ</span>
      )}
    </nav>
  );
}

export function SettingsLayout() {
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const { categoryId = '', itemId } = useParams<{ categoryId: string; itemId: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');

  const cat = categoryById(categoryId);
  // ชื่อหมวดขึ้น tab เบราว์เซอร์ด้วย — ก่อนหน้านี้ทั้ง 10 หมวดใช้ชื่อเดียวกันหมด
  // ทำให้ history/แท็บบอกตำแหน่งไม่ได้เลย ซึ่งเป็นอาการเดียวกับที่เจ้าของบ่น
  useDocumentTitle(cat ? `${cat.label} · ตั้งค่าระบบ` : 'ตั้งค่าระบบ');

  const cats = visibleCategories(role);
  const results = searchSettings(query, role);

  // หน้าย่อย (ชั้น 3) มี PageHeader ของตัวเองอยู่แล้ว — ซ้อนหัวข้อทับกันสามชั้นอ่านไม่รู้เรื่อง
  // ชั้นนี้จึงเหลือแค่บรรทัดบอกตำแหน่ง
  const isItemRoute = Boolean(itemId) || pathname !== `/settings/${categoryId}`;

  if (isItemRoute) {
    return (
      <div>
        <div className="py-4 mb-1">
          <Crumbs categoryLabel={cat?.label} categoryId={categoryId} />
        </div>
        <Outlet />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={cat?.label ?? 'ตั้งค่าระบบ'}
        subtitle="กำหนดพารามิเตอร์การทำงานของระบบ"
        breadcrumb={<Crumbs />}
      />

      {/* search */}
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาการตั้งค่า…"
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
        />
        {results.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
            {results.slice(0, 8).map(({ category, item }) => (
              <button
                key={`${category.id}/${item.id}`}
                onClick={() => {
                  setQuery('');
                  navigate(item.kind === 'inline'
                    ? `/settings/${category.id}#${item.id}`
                    : item.path ?? `/settings/${category.id}/${item.id}`);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="text-foreground">{item.label}</span>
                <span className="text-xs text-muted-foreground">{category.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {isMobile ? (
        <div className="space-y-4">
          <select
            value={categoryId}
            onChange={(e) => navigate(`/settings/${e.target.value}`)}
            className="w-full rounded-lg border border-border bg-background py-2 px-3 text-sm"
            aria-label="เลือกหมวดตั้งค่า"
          >
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <Outlet />
        </div>
      ) : (
        <div className="min-w-0">
          <Outlet />
        </div>
      )}
    </div>
  );
}
