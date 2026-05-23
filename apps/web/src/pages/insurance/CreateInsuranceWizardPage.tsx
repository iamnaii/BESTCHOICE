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

  // ── State ─────────────────────────────────────────────────────────────────
  // null = still in ImeiLookupStep; non-null = moved to DefectDescriptionStep
  const [imeiResult, setImeiResult] = useState<FoundResult | null>(null);

  // ── Preset-contract auto-lookup ───────────────────────────────────────────
  // If the page was opened from WarrantyCheckPage or a defect-exchange redirect
  // with presetContractId, silently fetch the IMEI and run the lookup so the
  // user skips the scan step.
  const didAutoLookup = useRef(false);

  useEffect(() => {
    if (!presetContractId || imeiResult || didAutoLookup.current) return;
    didAutoLookup.current = true;

    let cancelled = false;

    (async () => {
      try {
        // Step 1: fetch contract to get the product's IMEI
        const contractRes = await api.get(`/contracts/${presetContractId}`);
        const contract = contractRes.data as {
          id: string;
          product?: { imeiSerial?: string | null };
        };
        const imei = contract.product?.imeiSerial;
        if (!imei || cancelled) return;

        // Step 2: run IMEI lookup
        const lookupRes = await api.get<LookupResult>('/repair-tickets/lookup-by-imei', {
          params: { imei },
        });
        if (cancelled) return;

        const data = lookupRes.data;
        if (data.found) {
          setImeiResult(data);
        }
      } catch {
        // Silently ignore — user can scan manually
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [presetContractId]); // eslint-disable-line react-hooks/exhaustive-deps

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
