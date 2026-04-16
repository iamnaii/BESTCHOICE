/**
 * PLChart — Profit & Loss monthly comparison bar chart.
 * Extracted into its own chunk so recharts is lazy-loaded
 * and excluded from the initial bundle.
 */
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface MonthEntry {
  month: number;
  label: string;
  revenue: number;
  expenses: number;
  netProfit: number;
}

interface PLChartProps {
  data: MonthEntry[];
  formatter: (v: number) => string;
}

export default function PLChart({ data, formatter }: PLChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" />
        <YAxis tickFormatter={(v) => `${((v as number) / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v) => formatter(v as number)} />
        <Legend />
        <Bar dataKey="revenue" name="รายได้" fill="#22c55e" />
        <Bar dataKey="expenses" name="ค่าใช้จ่าย" fill="#ef4444" />
        <Bar dataKey="netProfit" name="กำไรสุทธิ" fill="#3b82f6" />
      </BarChart>
    </ResponsiveContainer>
  );
}
