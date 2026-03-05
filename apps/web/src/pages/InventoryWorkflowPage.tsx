import { lazy, Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '@/contexts/AuthContext';

const StockPage = lazy(() => import('@/pages/StockPage'));
const SuppliersPage = lazy(() => import('@/pages/SuppliersPage'));
const PurchaseOrdersPage = lazy(() => import('@/pages/PurchaseOrdersPage'));
const InspectionPage = lazy(() => import('@/pages/InspectionPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const StockTransfersPage = lazy(() => import('@/pages/StockTransfersPage'));

interface Step {
  key: string;
  label: string;
  shortLabel: string;
  group: 'purchasing' | 'warehouse';
  roles?: string[];
}

const allSteps: Step[] = [
  { key: 'stock', label: 'เช็คสต็อก', shortLabel: 'สต็อก', group: 'purchasing', roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
  { key: 'suppliers', label: 'Supplier', shortLabel: 'Supplier', group: 'purchasing', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { key: 'purchase-orders', label: 'สั่งซื้อ & ตรวจรับ', shortLabel: 'สั่งซื้อ', group: 'purchasing', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { key: 'inspections', label: 'ตรวจเช็คเครื่อง', shortLabel: 'QC', group: 'warehouse' },
  { key: 'products', label: 'สินค้าในคลัง', shortLabel: 'คลัง', group: 'warehouse' },
  { key: 'transfers', label: 'โอนไปสาขา', shortLabel: 'โอน', group: 'warehouse', roles: ['OWNER', 'BRANCH_MANAGER'] },
];

const stepComponents: Record<string, React.LazyExoticComponent<() => JSX.Element>> = {
  'stock': StockPage,
  'suppliers': SuppliersPage,
  'purchase-orders': PurchaseOrdersPage,
  'inspections': InspectionPage,
  'products': ProductsPage,
  'transfers': StockTransfersPage,
};

const Loader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
  </div>
);

export default function InventoryWorkflowPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const steps = useMemo(
    () => allSteps.filter((s) => !s.roles || (user && s.roles.includes(user.role))),
    [user],
  );

  const rawTab = searchParams.get('tab') || steps[0]?.key || 'stock';
  const rawIdx = steps.findIndex((s) => s.key === rawTab);
  // Fallback to first step if tab is invalid or filtered out by role
  const activeIdx = rawIdx >= 0 ? rawIdx : 0;
  const activeTab = steps[activeIdx]?.key || 'stock';
  const ActiveComponent = stepComponents[activeTab];

  const goTo = (key: string) => setSearchParams({ tab: key });

  return (
    <div className="space-y-0">
      {/* Stepper */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center">
          {steps.map((step, idx) => {
            const isActive = step.key === activeTab;
            const isPast = idx < activeIdx;
            const showGroupDivider =
              idx > 0 && step.group !== steps[idx - 1].group;

            return (
              <div key={step.key} className="flex items-center">
                {/* Group divider */}
                {showGroupDivider && (
                  <div className="mx-2 h-8 w-px bg-gray-300" />
                )}

                {/* Connector line */}
                {idx > 0 && !showGroupDivider && (
                  <div
                    className={clsx(
                      'w-6 sm:w-10 h-0.5 transition-colors',
                      isPast ? 'bg-primary-500' : 'bg-gray-200',
                    )}
                  />
                )}

                {/* Step button */}
                <button
                  onClick={() => goTo(step.key)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap cursor-pointer',
                    isActive
                      ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/20'
                      : isPast
                        ? 'bg-primary-50 text-primary-700 hover:bg-primary-100'
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                  )}
                >
                  <span
                    className={clsx(
                      'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                      isActive
                        ? 'bg-white/20 text-white'
                        : isPast
                          ? 'bg-primary-200 text-primary-700'
                          : 'bg-gray-200 text-gray-500',
                    )}
                  >
                    {isPast ? (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{step.shortLabel}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Group labels */}
        <div className="flex mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          <span className="flex-1">จัดซื้อ</span>
          <span className="flex-1 text-right">คลังสินค้า</span>
        </div>
      </div>

      {/* Step content */}
      <div>
        <Suspense fallback={<Loader />}>
          {ActiveComponent ? <ActiveComponent /> : <Loader />}
        </Suspense>
      </div>

      {/* Navigation buttons */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => activeIdx > 0 && goTo(steps[activeIdx - 1].key)}
          disabled={activeIdx <= 0}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeIdx > 0
              ? 'text-gray-700 hover:bg-gray-100 cursor-pointer'
              : 'text-gray-300 cursor-not-allowed',
          )}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          ก่อนหน้า
        </button>

        <span className="text-xs text-gray-400">
          {activeIdx + 1} / {steps.length}
        </span>

        <button
          onClick={() => activeIdx < steps.length - 1 && goTo(steps[activeIdx + 1].key)}
          disabled={activeIdx >= steps.length - 1}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeIdx < steps.length - 1
              ? 'bg-primary-600 text-white hover:bg-primary-700 cursor-pointer'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed',
          )}
        >
          ขั้นตอนถัดไป
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
