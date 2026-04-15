import { useRef, useEffect, useState, useMemo } from 'react';
import { Send, MoreVertical, ArrowLeft, Paperclip, Smile } from 'lucide-react';
import MessageBubble from './MessageBubble';
import SessionActions from './SessionActions';
import CommandPalette from './CommandPalette';
import AiSuggestPanel from './AiSuggestPanel';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import api from '@/lib/api';

interface ChatPanelProps {
  session: any;
  messages: any[];
  isLoadingMessages: boolean;
  onSendMessage: (text: string) => void;
  onSendFile?: (file: File) => void;
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
  onSendFile,
  onBack,
  onAssign,
  onResolve,
  onReturnToAI,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState<{ aiDraft: string; intent: string } | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  const shortcutActions = useMemo(
    () => ({
      onOpenPalette: () => setShowPalette(true),
      onResolve,
      onEscape: () => setShowPalette(false),
    }),
    [onResolve],
  );
  useKeyboardShortcuts(shortcutActions);

  const QUICK_EMOJIS = ['😊', '👍', '🙏', '❤️', '😄', '👋', '✅', '📱', '💰', '🎉'];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSendFile) {
      onSendFile(file);
    }
    e.target.value = ''; // reset
  };

  const insertEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    setShowEmoji(false);
    inputRef.current?.focus();
  };

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const getLastCustomerMessage = () => {
    const customerMsgs = messages.filter((m: any) => m.role === 'CUSTOMER');
    return customerMsgs[customerMsgs.length - 1]?.text ?? customerMsgs[customerMsgs.length - 1]?.content ?? '';
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    onSendMessage(text);
    if (selectedSuggestion) {
      const type = text === selectedSuggestion.aiDraft ? 'ACCEPT' : 'EDIT';
      api.post('/staff-chat/ai/training-feedback', {
        sessionId: session.id,
        type,
        customerMessage: getLastCustomerMessage(),
        aiDraft: selectedSuggestion.aiDraft,
        humanEdit: type === 'EDIT' ? text : undefined,
        intent: selectedSuggestion.intent,
      }).catch(() => {});
      setSelectedSuggestion(null);
    }
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCannedResponse = (content: string) => {
    setInputText((prev) => (prev ? prev + ' ' + content : content));
    inputRef.current?.focus();
  };

  const lastMessageAt =
    messages.length > 0
      ? new Date(messages[messages.length - 1]?.createdAt ?? 0).getTime()
      : 0;

  const handleSelectSuggestion = (text: string, metadata: { aiDraft: string; intent: string }) => {
    setInputText(text);
    setSelectedSuggestion(metadata);
    inputRef.current?.focus();
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

      {/* AI Suggestions */}
      {!isResolved && (
        <AiSuggestPanel
          sessionId={session.id}
          onSelectSuggestion={handleSelectSuggestion}
          lastMessageAt={lastMessageAt}
        />
      )}

      {/* Input */}
      {!isResolved && (
        <div className="border-t border-gray-200 p-3 bg-white">
          {/* Emoji picker */}
          {showEmoji && (
            <div className="flex gap-1 mb-2 p-1.5 bg-gray-50 rounded-lg flex-wrap">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-200 rounded transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            {/* File upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="แนบไฟล์/รูปภาพ"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            {/* Emoji toggle */}
            <button
              onClick={() => setShowEmoji(!showEmoji)}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
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

      {/* Command Palette */}
      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        onSelectCannedResponse={handleCannedResponse}
        onResolve={onResolve}
        sessionId={session?.id ?? null}
      />
    </div>
  );
}
