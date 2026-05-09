import { Gavel, Plus, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLegalCase } from '../hooks/useLegalCase';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  contractId: string;
  contractStatus: string;
  onOpen: () => void;
}

const LEGAL_ROLES = ['OWNER', 'FINANCE_MANAGER'];

/**
 * LegalCaseBanner — appears at the top of Customer 360 when the contract has
 * escalated to LEGAL status (P2 Task 7). Two states:
 *  - no LegalCase yet → "เพิ่มข้อมูลคดี" CTA (OWNER + FINANCE_MANAGER only)
 *  - LegalCase exists → summary + "ดูคดี" link
 */
export default function LegalCaseBanner({ contractId, contractStatus, onOpen }: Props) {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canEdit = LEGAL_ROLES.includes(role);
  const enabled = contractStatus === 'TERMINATED';
  const { data: legalCase } = useLegalCase(enabled ? contractId : null);

  if (!enabled) return null;

  return (
    <div className="border border-warning/40 bg-warning/10 rounded-lg p-3 mb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Gavel className="size-4 text-warning mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium leading-snug">คดีในชั้นศาล</div>
            {legalCase ? (
              <div className="text-xs text-muted-foreground leading-snug truncate">
                เลขคดี{' '}
                <span className="font-mono tabular-nums">{legalCase.caseNumber}</span>{' '}
                · {legalCase.court}
                {legalCase.hearingDate && (
                  <>
                    {' '}· นัด{' '}
                    {new Date(legalCase.hearingDate).toLocaleDateString('th-TH', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground leading-snug">
                ยังไม่มีข้อมูลคดี{canEdit ? '' : ' (ติดต่อผู้จัดการการเงิน)'}
              </div>
            )}
          </div>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={onOpen} className="shrink-0">
            {legalCase ? (
              <>
                <Eye className="size-4 mr-1" />
                ดูคดี
              </>
            ) : (
              <>
                <Plus className="size-4 mr-1" />
                เพิ่มข้อมูลคดี
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
