import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { api } from '@/lib/api';
import ShopLayout from '@/components/layout/ShopLayout';
import PlanCalculator from '@/components/saving-plan/PlanCalculator';
import {
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  Input,
  InputAddon,
  InputGroup,
  Label,
  Stack,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';
import type { SavingPlan } from '@/types/saving-plan';

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

  const submitLabel = mut.isPending ? 'กำลังสร้าง...' : 'สร้างแผน';

  return (
    <ShopLayout>
      <CategoryHero
        title="สร้างแผนออมดาวน์"
        breadcrumbs={[{ label: 'ออมดาวน์', to: '/saving-plan' }, { label: 'สร้างแผน' }]}
      />
      <Container narrow>
        <div className="py-6 md:py-8">
          <Card variant="elevated">
            <CardBody>
              <Stack gap={6}>
                <div>
                  <Label htmlFor="model" required>
                    รุ่นที่อยากได้
                  </Label>
                  <Input
                    id="model"
                    value={targetProductModel}
                    onChange={(e) => setTargetProductModel(e.target.value)}
                    placeholder="เช่น iPhone 13"
                  />
                </div>

                <div>
                  <Label htmlFor="target" required>
                    เป้าหมายเงินดาวน์
                  </Label>
                  <InputGroup>
                    <InputAddon>฿</InputAddon>
                    <Input
                      id="target"
                      type="number"
                      min={1000}
                      value={targetAmount}
                      onChange={(e) => setTargetAmount(Number(e.target.value))}
                    />
                  </InputGroup>
                </div>

                <PlanCalculator targetAmount={targetAmount} onChange={setCalc} />

                <div className="hidden md:block">
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={() => mut.mutate()}
                    disabled={mut.isPending}
                    loading={mut.isPending}
                  >
                    {submitLabel}
                  </Button>
                </div>
              </Stack>
            </CardBody>
          </Card>
        </div>
        <StickyBottomBarSpacer />
      </Container>

      <StickyBottomBar>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          loading={mut.isPending}
        >
          {submitLabel}
        </Button>
      </StickyBottomBar>
    </ShopLayout>
  );
}
