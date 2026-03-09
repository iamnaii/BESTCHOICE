import { Settings, Building2, Shield, User, Users, FolderOpen, MessageCircle, Bell, MapPin, FileText } from 'lucide-react';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'settings', label: 'ตั้งค่า', icon: <Settings size={18} /> },
  { id: 'broker', label: 'โบรคเกอร์', icon: <Building2 size={18} /> },
  { id: 'insurer', label: 'บริษัทประกันภัย', icon: <Shield size={18} /> },
  { id: 'agent', label: 'ตัวแทน', icon: <User size={18} /> },
  { id: 'employee', label: 'พนักงาน', icon: <Users size={18} /> },
  { id: 'category', label: 'ประเภท', icon: <FolderOpen size={18} /> },
  { id: 'chat', label: 'ห้องแชท', icon: <MessageCircle size={18} /> },
  { id: 'notify', label: 'แจ้งเตือน', icon: <Bell size={18} /> },
  { id: 'address', label: 'ที่อยู่', icon: <MapPin size={18} /> },
  { id: 'template', label: 'แบบพิมพ์', icon: <FileText size={18} /> },
];

interface Props {
  activeId: string;
  onSelect: (id: string) => void;
}

export default function EditorSidebar({ activeId, onSelect }: Props) {
  return (
    <div className="w-[200px] min-h-full bg-[#1E1B2E] flex flex-col">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-white/10">
        <h1 className="text-white font-bold text-sm">BESTCHOICEPHONE</h1>
        <p className="text-[#A5A0C0] text-[10px]">Document Template Editor</p>
      </div>

      {/* Menu */}
      <nav className="flex-1 py-2">
        {MENU_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
              activeId === item.id
                ? 'bg-[#6D28D9] text-white'
                : 'text-[#A5A0C0] hover:bg-white/5 hover:text-white'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10">
        <p className="text-[#A5A0C0] text-[10px]">BESTCHOICEPHONE Co., Ltd.</p>
      </div>
    </div>
  );
}
