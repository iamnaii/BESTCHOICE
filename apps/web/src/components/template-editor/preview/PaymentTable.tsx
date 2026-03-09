import { AVAILABLE_VARIABLES } from '@/constants/variables';
import { formatDateMedium, formatNumberDecimal } from '@/utils/formatters';

interface Props {
  previewMode: boolean;
}

export default function PaymentTable({ previewMode }: Props) {
  const installmentsDef = AVAILABLE_VARIABLES.find(v => v.key === 'INSTALLMENTS');
  const installments = previewMode && installmentsDef
    ? (installmentsDef.sampleValue as { NO: number; DUE_DATE: string; AMOUNT: number }[])
    : null;

  if (!previewMode) {
    return (
      <div className="my-3 border border-gray-300 rounded p-3 text-center text-xs text-gray-500">
        <p className="font-mono text-blue-600">{'{{for INSTALLMENT in INSTALLMENTS}}'}</p>
        <table className="w-full mt-2 border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-300 px-3 py-1.5 text-left text-xs">งวดที่</th>
              <th className="border border-gray-300 px-3 py-1.5 text-left text-xs">วันที่ครบกำหนดชำระ</th>
              <th className="border border-gray-300 px-3 py-1.5 text-right text-xs">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 px-3 py-1.5 text-xs font-mono text-violet-600">{'{{= INSTALLMENT.NO}}'}</td>
              <td className="border border-gray-300 px-3 py-1.5 text-xs font-mono text-violet-600">{'{{= INSTALLMENT.DUE_DATE | date:m}}'}</td>
              <td className="border border-gray-300 px-3 py-1.5 text-xs font-mono text-violet-600 text-right">{'{{= INSTALLMENT.AMOUNT | num:2}}'}</td>
            </tr>
          </tbody>
        </table>
        <p className="font-mono text-blue-600 mt-1">{'{{/for}}'}</p>
      </div>
    );
  }

  return (
    <table className="w-full my-3 border-collapse text-[13px]">
      <thead>
        <tr className="bg-gray-50">
          <th className="border border-gray-400 px-3 py-1.5 text-center w-16">งวดที่</th>
          <th className="border border-gray-400 px-3 py-1.5 text-center">วันที่ครบกำหนดชำระ</th>
          <th className="border border-gray-400 px-3 py-1.5 text-right w-28">จำนวนเงิน</th>
        </tr>
      </thead>
      <tbody>
        {installments?.map(inst => (
          <tr key={inst.NO}>
            <td className="border border-gray-400 px-3 py-1 text-center">{inst.NO}</td>
            <td className="border border-gray-400 px-3 py-1 text-center">{formatDateMedium(inst.DUE_DATE)}</td>
            <td className="border border-gray-400 px-3 py-1 text-right">{formatNumberDecimal(inst.AMOUNT)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
