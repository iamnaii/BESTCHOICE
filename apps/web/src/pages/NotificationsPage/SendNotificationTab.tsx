import { useState } from 'react';

interface Props {
  onSend: (data: { customerId: string; channel: string; subject: string; message: string }) => void;
  isSending: boolean;
}

const INPUT_CLS =
  'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

export default function SendNotificationTab({ onSend, isSending }: Props) {
  const [form, setForm] = useState({ customerId: '', channel: 'LINE', subject: '', message: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSend(form);
    setForm({ customerId: '', channel: 'LINE', subject: '', message: '' });
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6 max-w-lg">
      <h3 className="text-lg font-semibold mb-4">ส่งการแจ้งเตือนด้วยตนเอง</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Customer ID *</label>
          <input type="text" value={form.customerId} onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))} className={INPUT_CLS} placeholder="รหัสลูกค้า" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">ช่องทาง *</label>
          <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} className={INPUT_CLS}>
            <option value="LINE">LINE</option>
            <option value="SMS">SMS</option>
            <option value="IN_APP">ในระบบ (IN_APP)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">หัวข้อ</label>
          <input type="text" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} className={INPUT_CLS} placeholder="หัวข้อการแจ้งเตือน" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">ข้อความ *</label>
          <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} rows={4} className={INPUT_CLS} placeholder="เนื้อหาข้อความแจ้งเตือน" required />
        </div>
        <div>
          <button type="submit" disabled={isSending} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            {isSending ? 'กำลังส่ง...' : 'ส่งการแจ้งเตือน'}
          </button>
        </div>
      </form>
    </div>
  );
}
