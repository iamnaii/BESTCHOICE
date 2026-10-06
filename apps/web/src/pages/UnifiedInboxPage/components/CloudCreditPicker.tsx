import type { ReactNode } from 'react';
import { Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatWorkSettings } from '../hooks/useChatWork';
import { useLibraryDraft } from '../hooks/useLibraryDraft';
import ChatLibraryPicker from './ChatLibraryPicker';
import LibraryAttachmentTray from './LibraryAttachmentTray';
export default function CloudCreditPicker({
  roomId,
  disabled = false,
  localPicker,
}: {
  roomId: string | null;
  disabled?: boolean;
  localPicker: ReactNode;
}) {
  const { company, settings } = useChatWorkSettings();
  const enabled = !settings.isError && !!settings.data?.flags.chat_cloud_library_enabled;
  const draft = useLibraryDraft(roomId, company, enabled && !disabled, 'credit');
  if (!enabled) return <div>{localPicker}</div>;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">{localPicker}</div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 flex-1"
          disabled={disabled || !roomId}
          onClick={() => draft.setOpen(true)}
        >
          <Cloud className="size-4" />
          เลือกจากคลังไฟล์
        </Button>
      </div>
      <LibraryAttachmentTray draft={draft} />
      <ChatLibraryPicker
        key={`${company}:${roomId}`}
        open={draft.open}
        onOpenChange={draft.setOpen}
        onAdd={draft.add}
      />
    </div>
  );
}
