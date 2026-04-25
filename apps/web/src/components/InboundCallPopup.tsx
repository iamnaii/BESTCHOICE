import { useState, useCallback, useEffect } from 'react';
import { Phone, X, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useYeastarSocket, InboundCallEvent } from '@/hooks/useYeastarSocket';
import { cn } from '@/lib/utils';

export function InboundCallPopup() {
  const navigate = useNavigate();
  const [popup, setPopup] = useState<InboundCallEvent | null>(null);
  const [visible, setVisible] = useState(false);

  const handleInbound = useCallback((event: InboundCallEvent) => {
    setPopup(event);
    setVisible(true);
  }, []);

  useYeastarSocket(handleInbound);

  // Auto-dismiss after 30s
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 30_000);
    return () => clearTimeout(timer);
  }, [visible, popup]);

  if (!visible || !popup) return null;

  return (
    <div className="fixed top-4 right-4 z-50 w-80 animate-in slide-in-from-right-4">
      <Card className={cn('border-primary/20 shadow-lg')}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-primary/10 p-2">
                <Phone className="h-4 w-4 text-primary animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-snug">สายเข้า</p>
                <p className="text-xs text-muted-foreground leading-snug">{popup.callerNumber}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => setVisible(false)}
              aria-label="ปิด"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          {popup.customer ? (
            <div className="mt-3 space-y-1">
              <p className="text-sm font-medium leading-snug">{popup.customer.name}</p>
              {popup.contract && (
                <Badge variant="secondary" className="text-xs">
                  {popup.contract.contractNumber}
                </Badge>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground leading-snug">ไม่พบข้อมูลลูกค้า</p>
          )}

          {popup.contract && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full gap-1.5 text-xs"
              onClick={() => {
                navigate(`/contracts/${popup!.contract!.id}`);
                setVisible(false);
              }}
            >
              <ExternalLink className="h-3 w-3" />
              ดูสัญญา
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
