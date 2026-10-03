import { TicketReasonDialog, type TicketReasonDialogProps } from './TicketReasonDialog';

export function SendBackDialog(props: TicketReasonDialogProps) {
  return <TicketReasonDialog {...props} action="send-back" />;
}
