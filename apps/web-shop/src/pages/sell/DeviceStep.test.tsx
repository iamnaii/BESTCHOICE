import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import DeviceStep from './components/DeviceStep';
import { groupModels } from './device-options';
it('filters models in the same screen then preserves the API model value', () => {
  const models = [
    { model: 'iPhone 17 Pro', storages: [] },
    { model: 'iPhone Air', storages: [] },
  ];
  function Harness() {
    const [series, setSeries] = useState('');
    const [model, setModel] = useState('');
    return (
      <>
        <output>{model}</output>
        <DeviceStep
          stage="device"
          groups={groupModels(models)}
          seriesId={series}
          model={model}
          storage=""
          storages={[]}
          disabled={false}
          onSeries={setSeries}
          onModel={setModel}
          onStorage={() => {}}
        />
      </>
    );
  }
  render(<Harness />);
  expect(screen.queryByRole('button', { name: 'iPhone 17 Pro' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'กลุ่ม iPhone 17' }));
  expect(screen.queryByRole('button', { name: 'iPhone Air' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '2. เลือกรุ่นของ iPhone 17' })).toBeInTheDocument();
  expect(screen.queryByText(/รุ่นย่อย/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'iPhone 17 Pro' }));
  expect(screen.getByRole('status')).toHaveTextContent('iPhone 17 Pro');
  fireEvent.click(screen.getByRole('button', { name: 'กลุ่ม iPhone Air' }));
  expect(screen.getByRole('heading', { name: '2. เลือกรุ่นของ iPhone Air' })).toBeInTheDocument();
});
it('tells the customer what to do when a model has no storage open for buying', () => {
  render(
    <DeviceStep
      stage="storage"
      groups={groupModels([{ model: 'iPhone 17 Pro', storages: [] }])}
      seriesId=""
      model="iPhone 17 Pro"
      storage=""
      storages={[]}
      disabled={false}
      onSeries={() => {}}
      onModel={() => {}}
      onStorage={() => {}}
    />,
  );
  expect(
    screen.getByText('รุ่นนี้ยังไม่เปิดรับซื้อ เลือกรุ่นอื่นหรือสอบถามร้าน'),
  ).toBeInTheDocument();
});
