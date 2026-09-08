import { Suspense, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { categoryById, visibleItems } from '@/config/settings-access';
import type { SettingsItem, SettingsRole } from '@/config/settings-registry';

const groupLabelClass = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-snug';

function ItemSection({ item, categoryId }: { item: SettingsItem; categoryId: string }) {
  if (item.kind === 'inline' && item.component) {
    const C = item.component;
    return (
      <div id={item.id} className="scroll-mt-20">
        <Suspense fallback={
          <p data-settings-loading role="status" className="py-4 text-sm text-muted-foreground leading-snug">
            กำลังโหลด{item.label}…
          </p>
        }>
          <C />
        </Suspense>
      </div>
    );
  }
  const to = item.kind === 'route' ? `/settings/${categoryId}/${item.id}` : (item.path ?? '#');
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4 hover:bg-accent transition-colors"
    >
      <span className="text-sm font-medium text-foreground leading-snug">{item.label}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

export function CategoryPage({ categoryId }: { categoryId: string }) {
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const { hash } = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);

  // Earlier panels can move the target as lazy forms replace their placeholders.
  // Scroll once after this category's forms settle, then stop observing changes.
  useEffect(() => {
    const content = contentRef.current;
    if (!hash || !content) return;
    const scrollWhenReady = () => {
      if (content.querySelector('[data-settings-loading]')) return false;
      const target = document.getElementById(hash.slice(1));
      if (target && content.contains(target)) target.scrollIntoView({ block: 'start' });
      return true;
    };
    if (scrollWhenReady()) return;
    const observer = new MutationObserver(() => {
      if (scrollWhenReady()) observer.disconnect();
    });
    observer.observe(content, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [categoryId, hash, role]);

  const cat = categoryById(categoryId);
  if (!cat) return <p className="text-sm text-muted-foreground">ไม่พบหมวดนี้</p>;

  const items = visibleItems(cat, role);
  // จัดกลุ่มตาม group (รักษาลำดับการประกาศ)
  const groups: { name: string | undefined; items: SettingsItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  // ชื่อหมวดอยู่บน PageHeader ของ SettingsLayout แล้ว — เดิมโชว์ซ้ำสองที่ติดกัน
  return (
    <div ref={contentRef} className="space-y-6">
      {groups.map((g, gi) => (
        <section key={`${g.name ?? ''}-${gi}`} className="space-y-4">
          {g.name && <h2 className={groupLabelClass}>{g.name}</h2>}
          {g.items.map((item) => (
            <ItemSection key={item.id} item={item} categoryId={cat.id} />
          ))}
        </section>
      ))}
    </div>
  );
}
