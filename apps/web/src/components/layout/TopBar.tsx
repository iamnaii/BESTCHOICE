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
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 shadow-sm">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-gray-500">
          {user?.branchName && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              {user.branchName}
            </span>
          )}
        </h2>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-semibold text-gray-800">{user?.name}</p>
          <p className="text-sm text-gray-500">
            {user?.role && roleLabels[user.role]}
          </p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-sky-400 flex items-center justify-center">
          <span className="text-white text-sm font-bold">{user?.name?.charAt(0)}</span>
        </div>
        <button
          onClick={logout}
          className="px-3.5 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          ออก
        </button>
      </div>
    </header>
  );
}
