import { lazy, Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '@/contexts/AuthContext';

const StockPage = lazy(() => import('@/pages/StockPage'));
const PurchaseOrdersPage = lazy(() => import('@/pages/PurchaseOrdersPage'));
const InspectionPage = lazy(() => import('@/pages/InspectionPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const StockTransfersPage = lazy(() => import('@/pages/StockTransfersPage'));
const StockAlertsPage = lazy(() => import('@/pages/StockAlertsPage'));
const StockAdjustmentsPage = lazy(() => import('@/pages/StockAdjustmentsPage'));
const StockCountPage = lazy(() => import('@/pages/StockCountPage'));

interface Tab {
  key: string;
  label: string;
  roles?: string[];
}

const allTabs: Tab[] = [
  { key: 'stock', label: 'สต็อก', roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
  { key: 'purchase-orders', label: 'สั่งซื้อ', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { key: 'inspections', label: 'ตรวจเช็ค' },
  { key: 'products', label: 'สินค้าในคลัง' },
  { key: 'transfers', label: 'โอนสาขา', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { key: 'alerts', label: 'แจ้งเตือนสต็อก', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { key: 'adjustments', label: 'ปรับสต็อก', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { key: 'stock-count', label: 'ตรวจนับ', roles: ['OWNER', 'BRANCH_MANAGER'] },
];

const tabComponents: Record<string, React.LazyExoticComponent<() => JSX.Element>> = {
  'stock': StockPage,
  'purchase-orders': PurchaseOrdersPage,
  'inspections': InspectionPage,
  'products': ProductsPage,
  'transfers': StockTransfersPage,
  'alerts': StockAlertsPage,
  'adjustments': StockAdjustmentsPage,
  'stock-count': StockCountPage,
};

const Loader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
  </div>
);

export default function InventoryWorkflowPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabs = useMemo(
    () => allTabs.filter((t) => !t.roles || (user && t.roles.includes(user.role))),
    [user],
  );

  const rawTab = searchParams.get('tab') || tabs[0]?.key || 'stock';
  const activeTab = tabs.find((t) => t.key === rawTab) ? rawTab : tabs[0]?.key || 'stock';
  const ActiveComponent = tabComponents[activeTab];

  const goTo = (key: string) => setSearchParams({ tab: key });

  return (
    <div>
      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-6">
          <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Inventory tabs">
            {tabs.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  onClick={() => goTo(tab.key)}
                  className={clsx(
                    'whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer',
                    isActive
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <Suspense fallback={<Loader />}>
        {ActiveComponent ? <ActiveComponent /> : <Loader />}
      </Suspense>
    </div>
  );
}
