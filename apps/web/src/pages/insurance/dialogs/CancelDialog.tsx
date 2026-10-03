import { TicketReasonDialog, type TicketReasonDialogProps } from './TicketReasonDialog';

export function CancelDialog(props: TicketReasonDialogProps) {
  return <TicketReasonDialog {...props} action="cancel" />;
}
