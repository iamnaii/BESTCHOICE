import { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import toast from 'react-hot-toast';

type SignerType = 'CUSTOMER' | 'COMPANY' | 'WITNESS_1' | 'WITNESS_2' | 'GUARDIAN';

const SIGNER_LABELS: Record<SignerType, string> = {
  CUSTOMER: 'ผู้ซื้อ (ผู้เช่าซื้อ)',
  COMPANY: 'ผู้ขาย (ผู้ให้เช่าซื้อ)',
  WITNESS_1: 'พยาน 1',
  WITNESS_2: 'พยาน 2',
  GUARDIAN: 'ผู้ปกครอง',
};

const REQUIRED_SIGNERS: SignerType[] = ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'];

interface Signature {
  id: string;
  signerType: string;
  signerName?: string;
  signatureImage: string;
  signedAt: string;
}

interface ContractDetail {
  id: string;
  status: string;
  workflowStatus: string;
  contractNumber: string;
  pdpaConsentId: string | null;
  customer?: {
    id: string;
    birthDate?: string;
  };
}

/** Normalize STAFF → COMPANY for backward compatibility */
function normalizeSignerType(type: string): string {
  return type === 'STAFF' ? 'COMPANY' : type;
}

/** Canvas drawing helper: get position relative to canvas, accounting for DPI scaling */
function getCanvasPos(
  e: React.MouseEvent | React.TouchEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  if ('touches' in e) {
    return {
      x: (e.touches[0].clientX - rect.left) * scaleX,
      y: (e.touches[0].clientY - rect.top) * scaleY,
    };
  }
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

/** Setup canvas context for signature drawing */
function setupCanvasCtx(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#000';
}

export default function ContractSignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signerType, setSignerType] = useState<SignerType>('CUSTOMER');
  const [signerName, setSignerName] = useState('');
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signMode, setSignMode] = useState<'choose' | 'draw' | 'saved'>('choose');
  const [gpsLoading, setGpsLoading] = useState(false);

  // Get contract detail to check workflow and customer age
  const { data: contract } = useQuery<ContractDetail>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });

  // Determine if guardian signature is required (customer age 17-19)
  const requiresGuardian = (() => {
    if (!contract?.customer?.birthDate) return false;
    const birth = new Date(contract.customer.birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age >= 17 && age < 20;
  })();

  const requiredSigners = requiresGuardian ? [...REQUIRED_SIGNERS, 'GUARDIAN' as SignerType] : REQUIRED_SIGNERS;

  // Get contract preview
  const { data: preview } = useQuery<{ html: string }>({
    queryKey: ['contract-preview', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/preview`); return data; },
  });

  // Get existing signatures
  const { data: signatures = [] } = useQuery<Signature[]>({
    queryKey: ['contract-signatures', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/signatures`); return data; },
  });

  // Get saved staff signature
  const { data: savedSigData } = useQuery<{ signatureImage: string | null }>({
    queryKey: ['saved-signature'],
    queryFn: async () => { const { data } = await api.get('/users/me/signature'); return data; },
  });
  const savedSignature = savedSigData?.signatureImage || null;

  // PDPA consent
  const hasPdpaConsent = !!contract?.pdpaConsentId;
  const [showPdpaModal, setShowPdpaModal] = useState(false);
  const pdpaCanvasRef = useRef<HTMLCanvasElement>(null);
  const [pdpaDrawing, setPdpaDrawing] = useState(false);
  const [pdpaHasDrawn, setPdpaHasDrawn] = useState(false);

  const pdpaConsentMutation = useMutation({
    mutationFn: async (signatureImage: string) => {
      const { data } = await api.post(`/contracts/${id}/pdpa-consent`, { signatureImage });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกความยินยอม PDPA สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract', id] });
      setShowPdpaModal(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Setup PDPA canvas
  useEffect(() => {
    if (!showPdpaModal) return;
    setupCanvasCtx(pdpaCanvasRef.current);
  }, [showPdpaModal]);

  // Capture screen size for signature metadata
  const getScreenSize = () => `${window.screen.width}x${window.screen.height}`;

  // Capture GPS location (non-blocking with short timeout)
  const getGpsLocation = useCallback((): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => { setGpsLoading(false); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        () => { setGpsLoading(false); resolve(null); },
        { timeout: 3000, maximumAge: 120000 },
      );
    });
  }, []);

  const signMutation = useMutation({
    mutationFn: async (body: {
      signatureImage: string;
      signerType: string;
      signerName?: string;
      screenSize?: string;
      gpsLatitude?: number;
      gpsLongitude?: number;
    }) => {
      const { data } = await api.post(`/contracts/${id}/sign`, body);
      return data;
    },
    onSuccess: async (_data, variables) => {
      const label = SIGNER_LABELS[variables.signerType as SignerType] || variables.signerType;
      toast.success(`ลงนาม ${label} สำเร็จ`);
      clearCanvas();
      setSignMode('choose');
      setSignerName('');

      // Wait for signatures refetch to get actual server state (avoid stale data race)
      const freshSignatures = await queryClient.fetchQuery<Signature[]>({
        queryKey: ['contract-signatures', id],
        queryFn: async () => { const { data } = await api.get(`/contracts/${id}/signatures`); return data; },
      });
      queryClient.invalidateQueries({ queryKey: ['contract', id] });
      queryClient.invalidateQueries({ queryKey: ['contract-preview', id] });

      const freshSignedTypes = new Set(freshSignatures.map(s => normalizeSignerType(s.signerType)));
      const nowAllSigned = requiredSigners.every(t => freshSignedTypes.has(t));

      if (nowAllSigned) {
        // Auto-generate contract + PDPA documents
        toast.loading('กำลังสร้าง PDF สัญญาและ PDPA...', { id: 'auto-gen' });
        generateMutation.mutate(undefined, {
          onSettled: () => toast.dismiss('auto-gen'),
        });
      } else {
        // Auto-advance to next unsigned signer
        const nextUnsigned = requiredSigners.find(t => !freshSignedTypes.has(t));
        if (nextUnsigned) setSignerType(nextUnsigned);
      }
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Save signature to user profile
  const saveSignatureMutation = useMutation({
    mutationFn: async (signatureImage: string) => {
      const { data } = await api.put('/users/me/signature', { signatureImage });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-signature'] });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${id}/generate-signed-documents`);
      return data;
    },
    onSuccess: (data) => {
      // Check if both documents were generated
      const contractOk = !!data?.contract;
      const pdpaOk = !!data?.pdpa;
      if (contractOk && pdpaOk) {
        toast.success('สร้างเอกสารสัญญาและ PDPA สำเร็จ');
      } else if (contractOk) {
        toast.success('สร้างเอกสารสัญญาสำเร็จ (PDPA ไม่สามารถสร้างได้)');
      } else if (pdpaOk) {
        toast.success('สร้างเอกสาร PDPA สำเร็จ (สัญญาไม่สามารถสร้างได้)');
      } else {
        toast.error('ไม่สามารถสร้างเอกสารได้ กรุณาลองใหม่');
        return; // Don't navigate away
      }
      queryClient.invalidateQueries({ queryKey: ['contract', id] });
      queryClient.invalidateQueries({ queryKey: ['contract-documents', id] });
      navigate(`/contracts/${id}`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Canvas setup
  useEffect(() => {
    setupCanvasCtx(canvasRef.current);
  }, [signMode]);

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    setHasDrawn(true);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const endDraw = () => setIsDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleSignFromCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) { toast.error('กรุณาลงนามก่อน'); return; }
    const signatureImage = canvas.toDataURL('image/png');
    // Save staff/company signature for future use
    if (signerType === 'COMPANY') {
      saveSignatureMutation.mutate(signatureImage);
    }
    const gps = await getGpsLocation();
    signMutation.mutate({
      signatureImage,
      signerType,
      signerName: signerName || undefined,
      screenSize: getScreenSize(),
      gpsLatitude: gps?.lat,
      gpsLongitude: gps?.lng,
    });
  };

  const handleSignFromSaved = async () => {
    if (!savedSignature) { toast.error('ไม่พบลายเซ็นที่บันทึกไว้'); return; }
    const gps = await getGpsLocation();
    signMutation.mutate({
      signatureImage: savedSignature,
      signerType,
      signerName: signerName || undefined,
      screenSize: getScreenSize(),
      gpsLatitude: gps?.lat,
      gpsLongitude: gps?.lng,
    });
  };

  // PDPA canvas drawing handlers (reuse getCanvasPos helper)
  const pdpaStartDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = pdpaCanvasRef.current;
    if (!canvas) return;
    setPdpaDrawing(true);
    setPdpaHasDrawn(true);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const pdpaDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!pdpaDrawing) return;
    const canvas = pdpaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const pdpaEndDraw = () => setPdpaDrawing(false);

  const pdpaClear = () => {
    const canvas = pdpaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setPdpaHasDrawn(false);
  };

  // Check which signers have signed
  const signedTypes = new Set(signatures.map(s => normalizeSignerType(s.signerType)));
  const allSigned = requiredSigners.every(t => signedTypes.has(t));
  const canSign = contract?.status === 'DRAFT';
  const currentAlreadySigned = signedTypes.has(signerType);
  const isBusy = signMutation.isPending || gpsLoading;

  // Show COMPANY option for saved signature
  const showSavedOption = (signerType === 'COMPANY' || signerType === 'WITNESS_1' || signerType === 'WITNESS_2') && savedSignature;

  return (
    <div>
      <PageHeader
        title="ลงนามสัญญา"
        subtitle={`ลงนามดิจิทัลบนสัญญาผ่อนชำระ (ต้องลงนาม ${requiredSigners.length} ฝ่าย)`}
        action={
          <button onClick={() => navigate(`/contracts/${id}`)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
            กลับ
          </button>
        }
      />

      {/* Warning if contract is not draft */}
      {contract && contract.status !== 'DRAFT' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="text-sm font-medium text-amber-800">ไม่สามารถลงนามได้</div>
          <div className="text-xs text-amber-600 mt-1">สัญญาไม่อยู่ในสถานะร่าง (สถานะปัจจุบัน: {contract.status})</div>
        </div>
      )}

      {/* PDPA Consent Step */}
      {canSign && !hasPdpaConsent && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-amber-800">ขั้นตอนที่ 3: ต้องได้รับความยินยอม PDPA จากลูกค้าก่อน</h3>
              <p className="text-xs text-amber-600 mt-1">ลูกค้าต้องยินยอมให้เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคล ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 ก่อนลงนามสัญญา</p>
            </div>
            <button
              onClick={() => setShowPdpaModal(true)}
              className="ml-4 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 whitespace-nowrap"
            >
              บันทึกความยินยอม PDPA
            </button>
          </div>
        </div>
      )}

      {canSign && hasPdpaConsent && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
          <span className="text-green-600 text-sm font-medium">&#10003; ได้รับความยินยอม PDPA แล้ว</span>
        </div>
      )}

      {/* PDPA Consent Modal */}
      {showPdpaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="ยินยอม PDPA" onKeyDown={(e) => { if (e.key === 'Escape') setShowPdpaModal(false); }} tabIndex={-1} ref={(el: HTMLDivElement | null) => el?.focus()}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">ยินยอม PDPA</h2>
            <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-700 mb-4 max-h-48 overflow-y-auto leading-relaxed">
              <p className="font-semibold mb-2">ประกาศความเป็นส่วนตัว (Privacy Notice)</p>
              <p className="mb-2">บริษัท เบสท์ช้อยส์โฟน จำกัด ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลของท่าน ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562</p>
              <p className="font-medium mb-1">วัตถุประสงค์ในการเก็บรวบรวมข้อมูล:</p>
              <ol className="list-decimal ml-4 mb-2">
                <li>เพื่อการทำสัญญาผ่อนชำระสินค้า</li>
                <li>เพื่อการติดตามหนี้และบริหารสัญญา</li>
                <li>เพื่อการจัดทำเอกสารทางกฎหมาย</li>
                <li>เพื่อการติดต่อสื่อสารเกี่ยวกับสัญญา</li>
              </ol>
              <p className="font-medium mb-1">ข้อมูลที่เก็บรวบรวม:</p>
              <p className="mb-2">ชื่อ-นามสกุล, เลขบัตรประชาชน, ที่อยู่, เบอร์โทรศัพท์, อีเมล, LINE ID, ข้อมูลอาชีพและรายได้, ข้อมูลบุคคลอ้างอิง, รูปถ่ายบัตรประชาชน, ข้อมูลสินค้า (IMEI/S/N)</p>
              <p className="font-medium mb-1">ระยะเวลาเก็บข้อมูล:</p>
              <p>ตลอดอายุสัญญา + 5 ปีหลังปิดสัญญา (ตามอายุความทางกฎหมาย)</p>
            </div>
            <p className="text-sm text-gray-700 mb-3 font-medium">ลงลายมือชื่อยินยอม</p>
            <canvas
              ref={pdpaCanvasRef}
              width={460}
              height={160}
              className="w-full border-2 border-dashed border-gray-300 rounded-lg cursor-crosshair touch-none mb-3"
              style={{ height: '160px' }}
              onMouseDown={pdpaStartDraw}
              onMouseMove={pdpaDraw}
              onMouseUp={pdpaEndDraw}
              onMouseLeave={pdpaEndDraw}
              onTouchStart={pdpaStartDraw}
              onTouchMove={pdpaDraw}
              onTouchEnd={pdpaEndDraw}
            />
            <div className="flex gap-3">
              <button
                onClick={pdpaClear}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg"
              >
                ล้าง
              </button>
              <div className="flex-1" />
              <button onClick={() => setShowPdpaModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button
                onClick={() => {
                  if (!pdpaHasDrawn || !pdpaCanvasRef.current) { toast.error('กรุณาลงนามก่อน'); return; }
                  pdpaConsentMutation.mutate(pdpaCanvasRef.current.toDataURL('image/png'));
                }}
                disabled={!pdpaHasDrawn || pdpaConsentMutation.isPending}
                className="px-6 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {pdpaConsentMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันยินยอม'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signature Checklist */}
      <div className="mb-6 bg-white rounded-lg border p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">สถานะการลงนาม ({requiredSigners.filter(t => signedTypes.has(t)).length}/{requiredSigners.length})</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {requiredSigners.map(type => {
            const signed = signedTypes.has(type);
            const sig = signatures.find(s => normalizeSignerType(s.signerType) === type);
            return (
              <div key={type} className={`p-2 rounded-lg border text-center ${signed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-medium ${signed ? 'text-green-700' : 'text-gray-500'}`}>
                  {signed ? '\u2705' : '\u2B1C'} {SIGNER_LABELS[type]}
                </div>
                {sig?.signerName && <div className="text-[10px] text-gray-500 mt-0.5">{sig.signerName}</div>}
                {sig && <div className="text-[10px] text-gray-400">{new Date(sig.signedAt).toLocaleString('th-TH')}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contract Preview (A4 via iframe) */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">ตัวอย่างสัญญา</h2>
          <div className="bg-gray-200 rounded-lg border overflow-hidden" style={{ height: '70vh' }}>
            {preview ? (
              <ContractPreviewFrame html={preview.html} />
            ) : (
              <div className="flex items-center justify-center py-12 bg-white"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
            )}
          </div>
        </div>

        {/* Signature Pad */}
        <div>
          {/* Existing Signatures */}
          {signatures.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">ลงนามแล้ว</h3>
              <div className="space-y-2">
                {signatures.map((sig) => {
                  const normalizedType = normalizeSignerType(sig.signerType);
                  return (
                    <div key={sig.id} className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                      <img src={sig.signatureImage} alt="signature" className="h-10 border rounded" />
                      <div>
                        <div className="text-sm font-medium text-green-700">
                          {SIGNER_LABELS[normalizedType as SignerType] || normalizedType}
                        </div>
                        {sig.signerName && <div className="text-xs text-green-600">{sig.signerName}</div>}
                        <div className="text-xs text-green-600">{new Date(sig.signedAt).toLocaleString('th-TH')}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sign pad - enabled when contract is DRAFT */}
          {!allSigned && canSign && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-lg font-semibold text-gray-900">ลงนาม</h2>
                <select
                  value={signerType}
                  onChange={(e) => { setSignerType(e.target.value as SignerType); setSignMode('choose'); setSignerName(''); }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                >
                  {requiredSigners.map(type => (
                    <option key={type} value={type} disabled={signedTypes.has(type)}>
                      {SIGNER_LABELS[type]} {signedTypes.has(type) ? '(ลงนามแล้ว)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* GPS loading indicator */}
              {gpsLoading && (
                <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400" />
                  กำลังขอตำแหน่ง GPS...
                </div>
              )}

              {!currentAlreadySigned && (
                <div className="bg-white rounded-lg border p-4">
                  {/* Signer name input */}
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">ชื่อผู้ลงนาม</label>
                    <input
                      type="text"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder={`ระบุชื่อ${SIGNER_LABELS[signerType]}`}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  {/* Mode chooser: show saved signature option for staff-like signers */}
                  {signMode === 'choose' && (
                    <div className="space-y-3">
                      {showSavedOption && (
                        <div className="border-2 border-primary-200 bg-primary-50 rounded-lg p-4">
                          <div className="text-sm font-medium text-primary-800 mb-2">ลายเซ็นที่บันทึกไว้</div>
                          <div className="bg-white rounded border p-3 flex justify-center mb-3">
                            <img src={savedSignature} alt="saved-signature" className="h-16" />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleSignFromSaved}
                              disabled={isBusy}
                              className="flex-1 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                            >
                              {isBusy ? 'กำลังบันทึก...' : 'ใช้ลายเซ็นที่บันทึกไว้'}
                            </button>
                            <button
                              onClick={() => setSignMode('draw')}
                              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                              เซ็นใหม่
                            </button>
                          </div>
                        </div>
                      )}

                      {/* If no saved signature or is customer/guardian, go straight to draw mode */}
                      {!showSavedOption && (
                        <SignaturePad
                          canvasRef={canvasRef}
                          hasDrawn={hasDrawn}
                          isPending={isBusy}
                          onStartDraw={startDraw}
                          onDraw={draw}
                          onEndDraw={endDraw}
                          onClear={clearCanvas}
                          onSign={handleSignFromCanvas}
                        />
                      )}
                    </div>
                  )}

                  {/* Draw mode (re-sign) */}
                  {signMode === 'draw' && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-gray-500">เซ็นลายเซ็นใหม่</div>
                        {showSavedOption && (
                          <button
                            onClick={() => setSignMode('choose')}
                            className="text-xs text-primary-600 hover:underline"
                          >
                            ใช้ลายเซ็นที่บันทึกไว้
                          </button>
                        )}
                      </div>
                      <SignaturePad
                        canvasRef={canvasRef}
                        hasDrawn={hasDrawn}
                        isPending={isBusy}
                        onStartDraw={startDraw}
                        onDraw={draw}
                        onEndDraw={endDraw}
                        onClear={clearCanvas}
                        onSign={handleSignFromCanvas}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Generate Document */}
          {allSigned && (
            <div className="bg-green-50 rounded-lg border border-green-200 p-6 text-center">
              <div className="text-green-700 font-semibold text-lg mb-2">ลงนามครบถ้วนแล้ว ({requiredSigners.length} ฝ่าย)</div>
              <p className="text-sm text-green-600 mb-4">
                ผู้ซื้อ, ผู้ขาย, พยาน 1, พยาน 2{requiresGuardian ? ', ผู้ปกครอง' : ''} ลงนามเรียบร้อย
              </p>
              {generateMutation.isPending ? (
                <div className="flex items-center justify-center gap-2 text-green-700">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-700" />
                  <span className="text-sm">กำลังสร้าง PDF สัญญาและ PDPA...</span>
                </div>
              ) : generateMutation.isError ? (
                <div>
                  <p className="text-sm text-red-600 mb-3">สร้างเอกสารไม่สำเร็จ กรุณาลองใหม่</p>
                  <button
                    onClick={() => generateMutation.mutate()}
                    className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    ลองสร้างใหม่
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  สร้าง PDF สัญญาและ PDPA
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Reusable signature drawing pad */
function SignaturePad({
  canvasRef,
  hasDrawn,
  isPending,
  onStartDraw,
  onDraw,
  onEndDraw,
  onClear,
  onSign,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  hasDrawn: boolean;
  isPending: boolean;
  onStartDraw: (e: React.MouseEvent | React.TouchEvent) => void;
  onDraw: (e: React.MouseEvent | React.TouchEvent) => void;
  onEndDraw: () => void;
  onClear: () => void;
  onSign: () => void;
}) {
  return (
    <>
      <div className="text-xs text-gray-500 mb-2 text-center">กรุณาลงนามในกรอบด้านล่าง</div>
      <canvas
        ref={canvasRef}
        width={500}
        height={200}
        className="w-full border-2 border-dashed border-gray-300 rounded-lg cursor-crosshair touch-none"
        style={{ height: '200px' }}
        onMouseDown={onStartDraw}
        onMouseMove={onDraw}
        onMouseUp={onEndDraw}
        onMouseLeave={onEndDraw}
        onTouchStart={onStartDraw}
        onTouchMove={onDraw}
        onTouchEnd={onEndDraw}
      />
      <div className="flex gap-3 mt-3">
        <button onClick={onClear} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          ล้าง
        </button>
        <div className="flex-1" />
        <button
          onClick={onSign}
          disabled={!hasDrawn || isPending}
          className="px-6 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {isPending ? 'กำลังบันทึก...' : 'ยืนยันลงนาม'}
        </button>
      </div>
    </>
  );
}

/** Renders contract HTML in a sandboxed iframe for proper A4 page rendering */
function ContractPreviewFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const writeContent = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  useEffect(() => {
    writeContent();
  }, [writeContent]);

  return (
    <iframe
      ref={iframeRef}
      title="contract-preview"
      className="w-full h-full border-0"
      sandbox="allow-same-origin allow-scripts"
    />
  );
}
