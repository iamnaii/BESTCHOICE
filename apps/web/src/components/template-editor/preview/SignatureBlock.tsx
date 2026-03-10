import { buildSampleContext } from '@/utils/templateRenderer';
import { AVAILABLE_VARIABLES } from '@/constants/variables';

// Memoize context
let _ctx: Record<string, any> | null = null;
function getCtx() {
  if (!_ctx) _ctx = buildSampleContext(AVAILABLE_VARIABLES);
  return _ctx;
}

export default function SignatureBlock() {
  const ctx = getCtx();
  const customerName = ctx['CUSTOMER.FULLNAME'] || '...................................';
  const managerName = 'เอกนรินทร์ คงเดช';

  return (
    <div className="my-8" style={{ fontSize: '16px', lineHeight: 2 }}>
      {/* Row 1: Main signatories */}
      <div className="grid grid-cols-2 gap-x-8 mb-8">
        {/* ผู้ให้เช่าซื้อ */}
        <div className="text-center">
          <div>ลงชื่อ..................................................ผู้ให้เช่าซื้อ</div>
          <div>( {managerName} )</div>
          <div style={{ fontSize: '14px', color: '#666' }}>ผู้จัดการ บริษัท เบสท์ช้อยส์โฟน จำกัด</div>
        </div>
        {/* ผู้เช่าซื้อ */}
        <div className="text-center">
          <div>ลงชื่อ..................................................ผู้เช่าซื้อ</div>
          <div>( {customerName} )</div>
        </div>
      </div>

      {/* Row 2: Witnesses */}
      <div className="grid grid-cols-2 gap-x-8">
        <div className="text-center">
          <div>ลงชื่อ..................................................พยาน</div>
          <div>({'  '.repeat(15)})</div>
        </div>
        <div className="text-center">
          <div>ลงชื่อ..................................................พยาน</div>
          <div>({'  '.repeat(15)})</div>
        </div>
      </div>
    </div>
  );
}
