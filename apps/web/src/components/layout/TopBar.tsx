import { useAuth } from '@/contexts/AuthContext';

const roleLabels: Record<string, string> = {
  OWNER: 'เจ้าของ',
  BRANCH_MANAGER: 'ผู้จัดการสาขา',
  SALES: 'พนักงานขาย',
  ACCOUNTANT: 'ฝ่ายบัญชี',
};

export default function TopBar() {
  const { user, logout } = useAuth();

  return (
    <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-slate-500">
          {user?.branchName && (
            <span className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {user.branchName}
            </span>
          )}
        </h2>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-semibold text-slate-700">{user?.name}</p>
          <p className="text-xs text-slate-400">
            {user?.role && roleLabels[user.role]}
          </p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-sky-400 flex items-center justify-center">
          <span className="text-white text-sm font-semibold">{user?.name?.charAt(0)}</span>
        </div>
        <button
          onClick={logout}
          className="px-4 py-2 text-sm text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          ออก
        </button>
      </div>
    </header>
  );
}
