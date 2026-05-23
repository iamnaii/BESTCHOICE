import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import api from '@/lib/api';
import { ImeiLookupStep, type LookupResult } from './WizardSteps/ImeiLookupStep';
import { DefectDescriptionStep } from './WizardSteps/DefectDescriptionStep';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FoundResult = Extract<LookupResult, { found: true }>;

/** Derive recommended payer from warranty status (mirrors WarrantyPreviewStep logic) */
function derivePayer(status: string | null): 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM' {
  if (status === 'IN_7DAY_DEFECT' || status === 'IN_SHOP_WARRANTY') return 'SHOP';
  if (status === 'IN_MANUFACTURER') return 'SUPPLIER_CLAIM';
  return 'CUSTOMER';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CreateInsuranceWizardPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // ── URL search-param pre-fill ─────────────────────────────────────────────
  const presetContractId = params.get('contractId') ?? undefined;
  const presetCustomerId = params.get('customerId') ?? undefined;
  const presetProductId = params.get('productId') ?? undefined;
  const intent = params.get('intent') ?? undefined;
  const originRepairTicketId = params.get('originRepairTicketId') ?? undefined;
  const bypassWindow = params.get('bypassWindow') === 'true';

  // ── C1 FIX: intent=exchange routes to the legacy DefectExchangePage ───────
  // RepairTicketDetailPage's "Replace" button + LIFF deep links send
  // ?intent=exchange[&originRepairTicketId=X&bypassWindow=true]. The new
  // 2-step wizard handles REPAIR only; exchange flow continues to live on
  // /defect-exchange until SP2 ships the formal request queue. Redirecting
  // here preserves all params including bypassWindow.
  useEffect(() => {
    if (intent !== 'exchange') return;
    const qs = new URLSearchParams();
    if (presetContractId) qs.set('contractId', presetContractId);
    if (presetCustomerId) qs.set('customerId', presetCustomerId);
    if (presetProductId) qs.set('productId', presetProductId);
    if (originRepairTicketId) qs.set('originRepairTicketId', originRepairTicketId);
    if (bypassWindow) qs.set('bypassWindow', 'true');
    navigate(`/defect-exchange?${qs.toString()}`, { replace: true });
  }, [intent, presetContractId, presetCustomerId, presetProductId, originRepairTicketId, bypassWindow, navigate]);

  // ── State ─────────────────────────────────────────────────────────────────
  // null = still in ImeiLookupStep; non-null = moved to DefectDescriptionStep
  const [imeiResult, setImeiResult] = useState<FoundResult | null>(null);

  // ── Preset auto-lookup ────────────────────────────────────────────────────
  // Two pathways for skipping the manual IMEI scan:
  //   1. presetContractId — from WarrantyCheckPage (INSTALLMENT case) or
  //      /defect-exchange redirect. Fetch contract → IMEI → lookup.
  //   2. presetProductId — from WarrantyCheckPage CASH-sale case (no contract).
  //      Fetch product → IMEI → lookup directly. (W1 fix)
  const didAutoLookup = useRef(false);

  useEffect(() => {
    if (intent === 'exchange') return; // C1: redirect-in-progress
    if (imeiResult || didAutoLookup.current) return;
    if (!presetContractId && !presetProductId) return;

    didAutoLookup.current = true;
    let cancelled = false;

    (async () => {
      try {
        let imei: string | null | undefined;

        if (presetContractId) {
          const contractRes = await api.get(`/contracts/${presetContractId}`);
          const contract = contractRes.data as { product?: { imeiSerial?: string | null } };
          imei = contract.product?.imeiSerial;
        } else if (presetProductId) {
          // W1: CASH-sale path — no contract, fetch product directly
          const productRes = await api.get(`/products/${presetProductId}`);
          const product = productRes.data as { imeiSerial?: string | null };
          imei = product.imeiSerial;
        }

        if (!imei || cancelled) return;

        const lookupRes = await api.get<LookupResult>('/repair-tickets/lookup-by-imei', {
          params: { imei },
        });
        if (cancelled) return;

        const data = lookupRes.data;
        if (data.found) setImeiResult(data);
      } catch {
        // Silently ignore — user can scan manually
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [presetContractId, presetProductId, intent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="รับเครื่องเข้าซ่อม"
        subtitle={undefined}
        breadcrumb={
          <div className="flex gap-2 text-sm flex-wrap">
            <span
              className={
                imeiResult == null ? 'font-medium text-foreground' : 'text-muted-foreground'
              }
            >
              1. สแกน IMEI
            </span>
            <span className="text-muted-foreground">→</span>
            <span
              className={
                imeiResult != null ? 'font-medium text-foreground' : 'text-muted-foreground'
              }
            >
              2. รายละเอียดซ่อม
            </span>
          </div>
        }
        action={
          <div className="flex gap-2">
            {imeiResult && (
              <Button variant="ghost" size="sm" onClick={() => setImeiResult(null)}>
                เริ่มใหม่
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate('/insurance')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              กลับ
            </Button>
          </div>
        }
      />

      {/* Step 1 — IMEI Lookup */}
      {imeiResult === null && (
        <ImeiLookupStep onRepairChosen={setImeiResult} />
      )}

      {/* Step 2 — Repair description */}
      {imeiResult !== null && (
        <DefectDescriptionStep
          wizardState={{
            customerId: imeiResult.customer?.id,
            customerName: imeiResult.customer?.name,
            customerPhone: imeiResult.customer?.phone,
            contractId: imeiResult.contract?.id,
            productId: imeiResult.product.id,
            deviceBrand: imeiResult.product.brand,
            deviceModel: imeiResult.product.model,
            deviceImei: imeiResult.product.imeiSerial,
            // deviceSerial not returned by lookup — omit (API field is optional)
          }}
          defaultPayer={derivePayer(imeiResult.warrantyStatus)}
          onBack={() => setImeiResult(null)}
        />
      )}
    </div>
  );
}
