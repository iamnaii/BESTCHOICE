import { useReservationCountdown } from '../../hooks/useReservationCountdown';

export default function ReservationCountdownBadge({ expiresAt }: { expiresAt: string }) {
  const { label, expired } = useReservationCountdown(expiresAt);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm leading-snug ${
        expired ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
      }`}
    >
      {expired ? 'หมดเวลา' : `เวลาที่เหลือ ${label}`}
    </span>
  );
}
