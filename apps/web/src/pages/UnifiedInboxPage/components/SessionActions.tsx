import { UserPlus, CheckCircle, Bot, X, FileSignature } from 'lucide-react';
import { useNavigate } from 'react-router';

interface SessionActionsProps {
  session: any;
  onAssign: (staffId: string) => void;
  onResolve: () => void;
  onReturnToAI: () => void;
  onClose: () => void;
}

export default function SessionActions({
  session,
  onAssign,
  onResolve,
  onReturnToAI,
  onClose,
}: SessionActionsProps) {
  const navigate = useNavigate();

  return (
    <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onResolve}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          ปิดการสนทนา
        </button>

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
