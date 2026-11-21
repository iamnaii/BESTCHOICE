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
  fireEvent.click(screen.getByRole('button', { name: 'iPhone 17 Pro' }));
  expect(screen.getByRole('status')).toHaveTextContent('iPhone 17 Pro');
});
