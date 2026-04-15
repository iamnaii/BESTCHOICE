import { useState } from 'react';
import { UserPlus, CheckCircle, Bot, X, FileSignature, ArrowRightLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

interface SessionActionsProps {
  session: any;
  onAssign: (staffId: string) => void;
  onTransfer: (staffId: string) => void;
  onResolve: () => void;
  onReturnToAI: () => void;
  onClose: () => void;
  currentUserId: string;
}

export default function SessionActions({
  session,
  onAssign,
  onTransfer,
  onResolve,
  onReturnToAI,
  onClose,
  currentUserId,
}: SessionActionsProps) {
  const navigate = useNavigate();
  const [showStaffList, setShowStaffList] = useState(false);

  // Fetch online staff only when transfer dropdown is opened
  const staffQuery = useQuery({
    queryKey: ['staff-online'],
    queryFn: () => api.get('/staff-chat/staff/online').then((r: any) => r.data),
    enabled: showStaffList,
    staleTime: 30_000,
  });

  const assignedToMe = session?.assignedStaffId === currentUserId;
  const assignedStaffName = session?.assignedStaff?.name ?? session?.assignedStaff?.email ?? null;

  return (
    <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Assign to me */}
        {!assignedToMe && (
          <button
            onClick={() => {
              onAssign(currentUserId);
              onClose();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            รับเรื่องนี้
          </button>
        )}

        {/* Current assignment badge */}
        {assignedStaffName && (
          <span className="text-xs text-gray-500 px-2 py-1.5 bg-white border border-gray-200 rounded-lg">
            มอบหมายให้: <span className="font-medium text-gray-700">{assignedStaffName}</span>
          </span>
        )}

        {/* Transfer to other staff */}
        <div className="relative">
          <button
            onClick={() => setShowStaffList((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 transition-colors"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            โอนให้พนักงาน
            <ChevronRight className={`w-3 h-3 transition-transform ${showStaffList ? 'rotate-90' : ''}`} />
          </button>

          {showStaffList && (
            <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
              {staffQuery.isLoading && (
                <div className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  กำลังโหลด...
                </div>
              )}
              {staffQuery.isError && (
                <div className="px-3 py-2 text-xs text-red-500">โหลดรายชื่อไม่ได้</div>
              )}
              {staffQuery.data && (staffQuery.data as any[]).length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">ไม่มีพนักงานออนไลน์</div>
              )}
              {(staffQuery.data as any[] | undefined)
                ?.filter((s: any) => s.id !== currentUserId)
                .map((staff: any) => (
                  <button
                    key={staff.id}
                    onClick={() => {
                      onTransfer(staff.id);
                      setShowStaffList(false);
                      onClose();
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="ออนไลน์" />
                    <span className="truncate">{staff.name ?? staff.email}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Resolve */}
        <button
          onClick={onResolve}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          ปิดการสนทนา
        </button>

        {/* Create contract */}
        {session.customerId && (
          <button
            onClick={() => {
              navigate(`/contracts/create?customerId=${session.customerId}`);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <FileSignature className="w-3.5 h-3.5" />
            สร้างสัญญา
          </button>
        )}

        {/* Return to AI bot */}
        {session.handoffMode && (
          <button
            onClick={onReturnToAI}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors"
          >
            <Bot className="w-3.5 h-3.5" />
            ส่งกลับ Bot
          </button>
        )}

        <div className="ml-auto">
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
