import { LogOut } from 'lucide-react';

interface SidebarUserInfoProps {
  user: {
    name?: string;
    branchName?: string | null;
  };
  onLogout: () => void;
}

export function SidebarUserInfo({ user, onLogout }: SidebarUserInfoProps) {
  return (
    <div className="px-4 py-4 border-t border-white/10 shrink-0">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-full bg-primary/30 flex items-center justify-center shrink-0">
          <span className="text-white text-sm font-semibold">{user.name?.charAt(0)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-2sm font-medium text-white truncate">{user.name}</p>
          <p className="text-2xs text-white/50 truncate">{user.branchName}</p>
        </div>
        <button onClick={onLogout} className="text-white/40 hover:text-white transition-colors">
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}
