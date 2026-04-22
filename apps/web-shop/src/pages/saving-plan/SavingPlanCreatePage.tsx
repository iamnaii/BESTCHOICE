import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { api } from '../../lib/api';
import ShopLayout from '../../components/layout/ShopLayout';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import PlanCalculator from '../../components/saving-plan/PlanCalculator';
import type { SavingPlan } from '../../types/saving-plan';

export default function SavingPlanCreatePage() {
  const nav = useNavigate();
  const [targetAmount, setTargetAmount] = useState(9000);
  const [targetProductModel, setTargetProductModel] = useState('iPhone 13');
  const [calc, setCalc] = useState({ monthlyAmount: 1500, durationMonths: 6 });
  const mut = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/saving-plans', {
          targetProductModel,
          targetAmount,
          monthlyAmount: calc.monthlyAmount,
          durationMonths: calc.durationMonths,
        })
        .then((r) => r.data as SavingPlan),
    onSuccess: (plan) => {
      toast.success('สร้างแผนออมดาวน์แล้ว');
      nav(`/saving-plan/${plan.id}`);
    },
    onError: (e: AxiosError<{ message?: string }>) =>
      toast.error(e.response?.data?.message ?? 'สร้างแผนไม่สำเร็จ'),
  });
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-6 leading-snug">
        <h1 className="text-2xl font-bold">สร้างแผนออมดาวน์</h1>
        <div className="space-y-1">
          <Label htmlFor="model">รุ่นที่อยากได้</Label>
          <Input
            id="model"
            value={targetProductModel}
            onChange={(e) => setTargetProductModel(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="target">เป้าหมายเงินดาวน์ (บาท)</Label>
          <Input
            id="target"
            type="number"
            min={1000}
            value={targetAmount}
            onChange={(e) => setTargetAmount(Number(e.target.value))}
          />
        </div>
        <PlanCalculator targetAmount={targetAmount} onChange={setCalc} />
        <Button className="w-full" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'กำลังสร้าง...' : 'สร้างแผน'}
        </Button>
      </div>
    </ShopLayout>
  );
}
