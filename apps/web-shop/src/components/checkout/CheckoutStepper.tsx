import { Stepper } from '@/components/ui/Stepper';

interface Props {
  current: 1 | 2 | 3;
}

const STEPS = [
  { label: 'ที่อยู่', description: 'ข้อมูลจัดส่ง' },
  { label: 'จัดส่ง', description: 'เลือกวิธีจัดส่ง' },
  { label: 'ชำระเงิน', description: 'เลือกช่องทาง' },
];

export default function CheckoutStepper({ current }: Props) {
  return <Stepper steps={STEPS} current={current} />;
}
