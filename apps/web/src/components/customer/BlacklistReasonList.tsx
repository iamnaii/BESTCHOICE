import { Ban, FileWarning, FileX, Phone, Smartphone, Tag, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import type { BlacklistReason, BlacklistReasonCode } from '@installment/shared';

const ICONS: Record<BlacklistReasonCode, LucideIcon> = {
  ACTIVE_CONTRACT: FileWarning,
  TERMINATED_UNRETURNED: FileX,
  REPOSSESSED: Smartphone,
  BAD_DEBT: Ban,
  MANUAL_TAG: Tag,
  PHONE_MATCH: Phone,
  REFERENCES_BLACKLISTED: Users,
  REFERENCED_BY_BLACKLISTED: Users,
};

/** รายการเหตุผล blacklist — ชุดเดียวกันทั้งหน้าสร้างสัญญา ป้ายขยาย และแผงแชท · ชื่อคนที่จับคู่เป็นลิงก์ไปหน้าลูกค้า */
export default function BlacklistReasonList({ reasons, className = '' }: { reasons: BlacklistReason[]; className?: string }) {
  return (
    <ul className={`space-y-1 text-xs leading-snug ${className}`}>
      {reasons.map((r, i) => {
        const Icon = ICONS[r.code] ?? Ban;
        return (
          <li key={`${r.code}-${r.contractNumber ?? r.related?.customerId ?? i}`} className="flex items-start gap-1.5">
            <Icon className={`mt-0.5 size-3.5 shrink-0 ${r.level === 'HARD' ? 'text-destructive' : 'text-warning-strong'}`} aria-hidden />
            <span className="text-foreground">
              {r.message}
              {r.related && (
                <>
                  {' · '}
                  <Link to={`/customers/${r.related.customerId}`} className="font-medium text-primary hover:underline">{r.related.name}</Link>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
