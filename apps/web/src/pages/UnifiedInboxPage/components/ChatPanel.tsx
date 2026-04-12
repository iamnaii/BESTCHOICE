import { useRef, useEffect, useState } from 'react';
import { Send, MoreVertical, ArrowLeft } from 'lucide-react';
import MessageBubble from './MessageBubble';
import SessionActions from './SessionActions';

interface ChatPanelProps {
  session: any;
  messages: any[];
  isLoadingMessages: boolean;
  onSendMessage: (text: string) => void;
  onBack: () => void;
  onAssign: (staffId: string) => void;
  onResolve: () => void;
  onReturnToAI: () => void;
}

export default function ChatPanel({
  session,
  messages,
  isLoadingMessages,
  onSendMessage,
  onBack,
  onAssign,
  onResolve,
  onReturnToAI,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [showActions, setShowActions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    onSendMessage(text);
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        เลือกการสนทนาจากรายการด้านซ้าย
      </div>
    );
  }

  const displayName = session.customer?.name ?? session.lineUserId?.slice(0, 12) ?? 'ไม่ทราบชื่อ';
  const isResolved = session.sessionStatus === 'RESOLVED';

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="lg:hidden text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h3 className="font-medium text-sm text-gray-900">{displayName}</h3>
            <span className="text-xs text-gray-400">
              {session.channel.replace('_', ' ')} · {session.sessionStatus}
            </span>
          </div>
        </div>
        <button
          onClick={() => setShowActions(!showActions)}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
      </div>

      {/* Actions dropdown */}
      {showActions && (
        <SessionActions
          session={session}
          onAssign={onAssign}
          onResolve={onResolve}
          onReturnToAI={onReturnToAI}
          onClose={() => setShowActions(false)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
            กำลังโหลดข้อความ...
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      {!isResolved && (
        <div className="border-t border-gray-200 p-3 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="พิมพ์ข้อความ... (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
              rows={1}
              className="flex-1 resize-none px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 max-h-32"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="p-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
