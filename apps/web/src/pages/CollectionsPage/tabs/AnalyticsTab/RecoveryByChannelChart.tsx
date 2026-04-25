import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import QueryBoundary from '@/components/QueryBoundary';
import {
  useRecoveryByChannel,
  type RecoveryByChannelRow,
  type RecoveryChannel,
} from '../../hooks/useRecoveryByChannel';

const CHANNEL_LABEL: Record<RecoveryChannel, string> = {
  LINE: 'LINE',
  SMS: 'SMS',
  CALL: 'โทรศัพท์',
  INTERNAL_ALERT: 'แจ้งเตือนใน',
};

const COLOR_RATE = '#10b981'; // emerald-500
const COLOR_AMOUNT = '#3b82f6'; // blue-500
const AXIS_STYLE = { stroke: '#a1a1aa', fontSize: 11 };
const GRID_PROPS = { strokeDasharray: '3 3', stroke: '#e4e4e7' };

const bahtFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });

interface Props {
  from: Date | null;
  to: Date | null;
}

export default function RecoveryByChannelChart({ from, to }: Props) {
  const { data = [], isLoading, isError, error, refetch } = useRecoveryByChannel({
    from,
    to,
  });

  const chartData = data.map((row: RecoveryByChannelRow) => ({
    channel: CHANNEL_LABEL[row.channel] ?? row.channel,
    'อัตราการเก็บได้ (%)': row.recoveryRate,
    'เงินเก็บได้เฉลี่ย (฿)': row.avgRecoveryAmount,
    actionsSent: row.actionsSent,
    recovered: row.recovered,
  }));

  const hasAnyAction = data.some((r) => r.actionsSent > 0);

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-5">
        <div className="mb-4">
          <div className="text-sm font-semibold mb-0.5 leading-snug">
            อัตราการเก็บเงินตามช่องทางทวงถาม
          </div>
          <div className="text-xs text-muted-foreground leading-snug">
            ภายใน 7 วันหลังส่งข้อความ · แท่งซ้าย=อัตรา %, แท่งขวา=เงินเก็บได้เฉลี่ย ฿
          </div>
        </div>

        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดข้อมูลการเก็บเงินตามช่องทางได้"
        >
          {!hasAnyAction ? (
            <div className="py-8 text-center text-xs text-muted-foreground italic leading-snug">
              ยังไม่มีข้อมูลในช่วงเวลาที่เลือก
            </div>
          ) : (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="channel" {...AXIS_STYLE} />
                  <YAxis
                    yAxisId="left"
                    {...AXIS_STYLE}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    {...AXIS_STYLE}
                    tickFormatter={(v) => bahtFormat.format(Number(v))}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'อัตราการเก็บได้ (%)') {
                        return [`${value}%`, name];
                      }
                      if (name === 'เงินเก็บได้เฉลี่ย (฿)') {
                        return [`${bahtFormat.format(Number(value))} ฿`, name];
                      }
                      return [String(value), String(name)];
                    }}
                    labelFormatter={(label, payload) => {
                      const first = payload?.[0]?.payload as
                        | { actionsSent: number; recovered: number }
                        | undefined;
                      if (!first) return label;
                      return `${label} · ส่ง ${first.actionsSent} ครั้ง · เก็บได้ ${first.recovered} ราย`;
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    yAxisId="left"
                    dataKey="อัตราการเก็บได้ (%)"
                    fill={COLOR_RATE}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="เงินเก็บได้เฉลี่ย (฿)"
                    fill={COLOR_AMOUNT}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}
