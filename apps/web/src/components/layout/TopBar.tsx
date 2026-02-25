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
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div />
      <div className="flex items-center gap-4">
        <div className="text-sm text-right">
          <p className="font-medium text-gray-900">{user?.name}</p>
          <p className="text-gray-500 text-xs">
            {user?.role && roleLabels[user.role]}
            {user?.branchName && ` | ${user.branchName}`}
          </p>
        </div>
        <button
          onClick={logout}
          className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          ออกจากระบบ
        </button>
      </div>
    </header>
  );
}
