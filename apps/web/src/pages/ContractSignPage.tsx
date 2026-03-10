import { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import toast from 'react-hot-toast';

interface Signature {
  id: string;
  signerType: string;
  signatureImage: string;
  signedAt: string;
}

export default function ContractSignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signerType, setSignerType] = useState<'CUSTOMER' | 'STAFF'>('CUSTOMER');
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signMode, setSignMode] = useState<'choose' | 'draw' | 'saved'>('choose');

  // Get contract detail to check workflow
  const { data: contract } = useQuery<{ id: string; status: string; workflowStatus: string; contractNumber: string }>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });

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

  const signMutation = useMutation({
    mutationFn: async (body: { signatureImage: string; signerType: string }) => {
      const { data } = await api.post(`/contracts/${id}/sign`, body);
      return data;
    },
    onSuccess: (_data, variables) => {
      toast.success(`ลงนาม ${variables.signerType === 'CUSTOMER' ? 'ลูกค้า' : 'พนักงาน'} สำเร็จ`);
      queryClient.invalidateQueries({ queryKey: ['contract-signatures', id] });
      queryClient.invalidateQueries({ queryKey: ['contract', id] });
      queryClient.invalidateQueries({ queryKey: ['contract-preview', id] });
      clearCanvas();
      setSignMode('choose');
      // Auto-switch to staff if customer just signed
      if (variables.signerType === 'CUSTOMER') setSignerType('STAFF');
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
      const { data } = await api.post(`/contracts/${id}/generate-document`, { documentType: 'CONTRACT' });
      return data;
    },
    onSuccess: () => {
      toast.success('สร้างเอกสารสัญญาสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract', id] });
      navigate(`/contracts/${id}`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
  }, [signMode]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
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
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    setHasDrawn(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
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

  const handleSignFromCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) { toast.error('กรุณาลงนามก่อน'); return; }
    const signatureImage = canvas.toDataURL('image/png');
    // Save staff signature for future use
    if (signerType === 'STAFF') {
      saveSignatureMutation.mutate(signatureImage);
    }
    signMutation.mutate({ signatureImage, signerType });
  };

  const handleSignFromSaved = () => {
    if (!savedSignature) { toast.error('ไม่พบลายเซ็นที่บันทึกไว้'); return; }
    signMutation.mutate({ signatureImage: savedSignature, signerType });
  };

  const customerSigned = signatures.some((s) => s.signerType === 'CUSTOMER');
  const staffSigned = signatures.some((s) => s.signerType === 'STAFF');
  const allSigned = customerSigned && staffSigned;
  // Allow signing when contract status is DRAFT (any workflow stage)
  const canSign = contract?.status === 'DRAFT';

  // Determine if current signer type is already signed
  const currentAlreadySigned = signerType === 'CUSTOMER' ? customerSigned : staffSigned;

  return (
    <div>
      <PageHeader
        title="ลงนามสัญญา"
        subtitle="ลงนามดิจิทัลบนสัญญาผ่อนชำระ"
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
                {signatures.map((sig) => (
                  <div key={sig.id} className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                    <img src={sig.signatureImage} alt="signature" className="h-10 border rounded" />
                    <div>
                      <div className="text-sm font-medium text-green-700">
                        {sig.signerType === 'CUSTOMER' ? 'ลูกค้า' : 'พนักงาน'}
                      </div>
                      <div className="text-xs text-green-600">{new Date(sig.signedAt).toLocaleString('th-TH')}</div>
                    </div>
                  </div>
                ))}
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
                  onChange={(e) => { setSignerType(e.target.value as 'CUSTOMER' | 'STAFF'); setSignMode('choose'); }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="CUSTOMER" disabled={customerSigned}>ลูกค้า {customerSigned ? '(ลงนามแล้ว)' : ''}</option>
                  <option value="STAFF" disabled={staffSigned}>พนักงาน {staffSigned ? '(ลงนามแล้ว)' : ''}</option>
                </select>
              </div>

              {!currentAlreadySigned && (
                <div className="bg-white rounded-lg border p-4">
                  {/* Mode chooser: show saved signature option for STAFF when available */}
                  {signMode === 'choose' && (
                    <div className="space-y-3">
                      {/* Show saved signature option for STAFF */}
                      {signerType === 'STAFF' && savedSignature && (
                        <div className="border-2 border-primary-200 bg-primary-50 rounded-lg p-4">
                          <div className="text-sm font-medium text-primary-800 mb-2">ลายเซ็นที่บันทึกไว้</div>
                          <div className="bg-white rounded border p-3 flex justify-center mb-3">
                            <img src={savedSignature} alt="saved-signature" className="h-16" />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleSignFromSaved}
                              disabled={signMutation.isPending}
                              className="flex-1 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                            >
                              {signMutation.isPending ? 'กำลังบันทึก...' : 'ใช้ลายเซ็นที่บันทึกไว้'}
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

                      {/* If no saved signature or is customer, go straight to draw mode */}
                      {(signerType === 'CUSTOMER' || !savedSignature) && (
                        <SignaturePad
                          canvasRef={canvasRef}
                          hasDrawn={hasDrawn}
                          isPending={signMutation.isPending}
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
                        {signerType === 'STAFF' && savedSignature && (
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
                        isPending={signMutation.isPending}
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
              <div className="text-green-700 font-semibold text-lg mb-2">ลงนามครบถ้วนแล้ว</div>
              <p className="text-sm text-green-600 mb-4">ลูกค้าและพนักงานลงนามเรียบร้อย สามารถสร้างเอกสารสัญญาได้</p>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {generateMutation.isPending ? 'กำลังสร้าง...' : 'สร้างเอกสารสัญญา'}
              </button>
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
      sandbox="allow-same-origin"
    />
  );
}
