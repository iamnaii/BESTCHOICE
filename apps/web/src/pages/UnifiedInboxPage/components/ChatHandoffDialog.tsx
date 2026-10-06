import ChatFollowUpDialog from './ChatFollowUpDialog';
export default function ChatHandoffDialog(props: {
  roomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <ChatFollowUpDialog {...props} handoff />;
}
