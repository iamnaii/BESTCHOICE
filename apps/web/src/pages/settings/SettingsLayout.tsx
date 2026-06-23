import { useState } from 'react';
import { useParams, useNavigate, Link, Outlet } from 'react-router';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { visibleCategories, visibleItems, searchSettings } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';

export function SettingsLayout() {
  useDocumentTitle('ตั้งค่าระบบ');
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const { categoryId = '' } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');

  const cats = visibleCategories(role);
  const results = searchSettings(query, role);

  return (
    <div>
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดพารามิเตอร์การทำงานของระบบ" />

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
                onClick={() => { setQuery(''); navigate(`/settings/${category.id}#${item.id}`); }}
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
        <div className="flex gap-6">
          <nav className="w-60 shrink-0 space-y-1">
            {cats.map((c) => {
              const active = c.id === categoryId;
              const Icon = c.icon;
              return (
                <Link
                  key={c.id}
                  to={`/settings/${c.id}`}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    active ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/60'
                  }`}
                >
                  <span className="flex items-center gap-2 leading-snug">
                    <Icon className="size-4" />
                    {c.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{visibleItems(c, role).length}</span>
                </Link>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1">
            <Outlet />
          </div>
        </div>
      )}
    </div>
  );
}
