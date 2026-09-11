import { useCallback, useState } from 'react';

export type FinanceSide = 'bc' | 'gfin';

/**
 * state ของเครื่องคำนวณค่างวด — ยกขึ้นที่หน้า (index.tsx) เพื่อให้ปุ่ม "คัดลอกสรุปส่งลูกค้า"
 * ใช้ค่าที่เลือกอยู่ · ค่า null = ยังไม่เลือก ให้การ์ดใช้ค่าตั้งต้น (12 งวด · ดาวน์ขั้นต่ำ · คอมตามหมวด)
 * สองฝั่งจำแยกกัน สลับไปมาไม่หาย
 */
export interface CalcState {
  fin: FinanceSide;
  bc: { months: number | null; downAmount: number | null };
  gfin: { months: number | null; downPct: number | null; commissionPct: number | null };
}

export const INITIAL_CALC_STATE: CalcState = {
  fin: 'bc',
  bc: { months: null, downAmount: null },
  gfin: { months: null, downPct: null, commissionPct: null },
};

export type CalcStatePatch = Partial<CalcState> | ((prev: CalcState) => CalcState);

export function useInstallmentCalcState(): [CalcState, (patch: CalcStatePatch) => void] {
  const [state, setState] = useState<CalcState>(INITIAL_CALC_STATE);
  const update = useCallback((patch: CalcStatePatch) => {
    setState((prev) => (typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }));
  }, []);
  return [state, update];
}
