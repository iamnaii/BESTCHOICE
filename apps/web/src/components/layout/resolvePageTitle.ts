import { getMenuConfig, getSidebarForRole, type MenuItem } from '@/config/menu';
import { NAV_LABELS } from '@/config/work-navigation';

/** Exceptions for routes without a navigable menu item. */
export const PAGE_TITLE_MAP: Record<string, string> = {
  '/': NAV_LABELS.home,
  '/products': NAV_LABELS.stock,
  '/settings': 'ตั้งค่า',
  '/users': 'ผู้ใช้',
  '/branches': 'สาขา',
  '/notifications': 'แจ้งเตือน',
  '/after-sales/new': 'แจ้งปัญหาเครื่อง',
};

const normalizePath = (path: string) => path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
const menuTitles: Record<string, string> = {};
function addMenuItem(item: MenuItem) {
  if (item.children?.length) {
    item.children.forEach(addMenuItem);
    return;
  }
  const path = normalizePath(item.path);
  if (path.startsWith('/') && !menuTitles[path]) menuTitles[path] = item.label;
}
// The function's public interface has no role. Use stable OWNER-first labels
// for duplicate paths while including routes available only to another role.
for (const role of ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES', 'VIEWER']) {
  getMenuConfig(role).sidebar.forEach(section => section.items.forEach(addMenuItem));
  getSidebarForRole(role, 'settings').forEach(section => section.items.forEach(addMenuItem));
}
const titles = { ...menuTitles, ...PAGE_TITLE_MAP };
const prefixes = Object.keys(titles).filter(path => path !== '/').sort((a, b) => b.length - a.length);

export function resolvePageTitle(pathname: string): string {
  const path = normalizePath(pathname);
  if (titles[path]) return titles[path];
  const prefix = prefixes.find(candidate => path.startsWith(`${candidate}/`));
  if (prefix) return titles[prefix];
  return path.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Dashboard';
}
