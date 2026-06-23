import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { categoryById, visibleItems } from '@/config/settings-access';
import type { SettingsItem, SettingsRole } from '@/config/settings-registry';

const groupLabelClass = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-snug';

function ItemSection({ item }: { item: SettingsItem }) {
  if (item.kind === 'inline' && item.component) {
    const C = item.component;
    return (
      <div id={item.id} className="scroll-mt-20">
        <C />
      </div>
    );
  }
  // external / route(P1=ลิงก์)
  return (
    <Link
      to={item.path ?? '#'}
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

  return (
    <div className="space-y-6">
      {groups.map((g, gi) => (
        <section key={g.name ?? gi} className="space-y-4">
          {g.name && <h3 className={groupLabelClass}>{g.name}</h3>}
          {g.items.map((item) => (
            <ItemSection key={item.id} item={item} />
          ))}
        </section>
      ))}
    </div>
  );
}
