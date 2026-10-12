import { appointmentConfirmationText, AppointmentMessageKind } from '@installment/shared';
import { AppointmentDb, AppointmentRow } from './appointment-access';

export async function queueAppointmentConfirmation(
  db: AppointmentDb,
  row: AppointmentRow,
  kind: AppointmentMessageKind,
) {
  const rooms = await db.chatRoom.findMany({
    where: {
      customerId: row.customerId,
      deletedAt: null,
      channel: { not: 'LINE_FINANCE' },
      ...(row.sourceRoomId ? { id: row.sourceRoomId } : {}),
    },
    take: 2,
  });
  // With several conversations, require the originating room instead of guessing a recipient.
  const room = rooms.length === 1 ? rooms[0] : null;
  const recipientId = room?.externalUserId || room?.lineUserId;
  await db.appointmentConfirmation.updateMany({
    where: { appointmentId: row.id, status: 'PENDING' },
    data: { status: 'SUPERSEDED' },
  });
  return db.appointmentConfirmation.create({
    data: {
      appointmentId: row.id,
      version: row.version,
      kind,
      text: appointmentConfirmationText(row, kind),
      roomId: room?.id,
      channel: room?.channel,
      recipientId,
      status:
        room && recipientId && ['LINE_SHOP', 'FACEBOOK'].includes(room.channel)
          ? 'PENDING'
          : 'NO_CHANNEL',
    },
  });
}
