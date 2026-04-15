import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquareMore } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';

interface GreetingConfig {
  greetingMessage: string;
}

const DEFAULT_GREETING = `สวัสดีครับ! ยินดีต้อนรับสู่ BESTCHOICE 🎉

คุณสามารถใช้เมนูด้านล่างเพื่อ:
📱 ดูสินค้ามือถือและราคา
💳 ตรวจสอบยอดผ่อนชำระ
📄 ดูรายละเอียดสัญญา
💰 ชำระค่างวดผ่าน QR Code

หากต้องการความช่วยเหลือ พิมพ์ "ช่วยเหลือ" ได้เลยครับ`;

export default function LineGreetingPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['line-greeting-config'],
    queryFn: async () => {
      const res = await api.get('/line-oa/greeting');
      return res.data as GreetingConfig;
    },
    retry: 1,
  });

  useEffect(() => {
    if (data?.greetingMessage !== undefined) {
      setMessage(data.greetingMessage || DEFAULT_GREETING);
      setIsDirty(false);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return api.put('/line-oa/greeting', { greetingMessage: message });
    },
    onSuccess: () => {
      toast.success('บันทึกข้อความต้อนรับแล้ว');
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['line-greeting-config'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const handleChange = (value: string) => {
    setMessage(value);
    setIsDirty(value !== (data?.greetingMessage || DEFAULT_GREETING));
  };

  const handleReset = () => {
    setMessage(DEFAULT_GREETING);
    setIsDirty(DEFAULT_GREETING !== (data?.greetingMessage || DEFAULT_GREETING));
  };

  const charCount = message.length;
  const isOverLimit = charCount > 5000;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="ข้อความต้อนรับ LINE"
        subtitle="ข้อความที่ลูกค้าจะได้รับเมื่อเพิ่ม Bot เป็นเพื่อนครั้งแรก"
        icon={<MessageSquareMore size={22} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Edit Panel */}
        <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5">
          <h2 className="font-semibold text-foreground mb-3">แก้ไขข้อความ</h2>

          {isLoading ? (
            <div className="text-sm text-muted-foreground">กำลังโหลด...</div>
          ) : (
            <div className="space-y-3">
              <div>
                <textarea
                  value={message}
                  onChange={(e) => handleChange(e.target.value)}
                  rows={12}
                  placeholder="ข้อความต้อนรับ..."
                  className={`w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background resize-none font-sans ${
                    isOverLimit ? 'border-destructive' : ''
                  }`}
                />
                <div className={`flex justify-between text-xs mt-1 ${isOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                  <span>ใช้ได้ emoji, ตัวอักษร, และ line break</span>
                  <span>{charCount.toLocaleString()} / 5,000</span>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !isDirty || isOverLimit}
                >
                  {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={saveMutation.isPending}
                >
                  รีเซ็ตเป็นค่าเริ่มต้น
                </Button>
              </div>

              {isDirty && (
                <p className="text-xs text-warning">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</p>
              )}
            </div>
          )}
        </div>

        {/* Preview Panel */}
        <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5">
          <h2 className="font-semibold text-foreground mb-3">ตัวอย่างใน LINE</h2>

          {/* LINE Chat Mock */}
          <div className="bg-[#95c072] rounded-xl p-3 min-h-[300px]">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sm font-bold text-[#06c755]">
                BC
              </div>
              <span className="text-white text-sm font-semibold">BESTCHOICE</span>
            </div>

            {/* Message Bubble */}
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-xs font-bold text-[#06c755] shrink-0">
                BC
              </div>
              <div className="bg-white rounded-2xl rounded-tl-sm px-3 py-2.5 max-w-[85%] shadow-sm">
                {message ? (
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
                    {message.length > 300 ? message.slice(0, 300) + '...' : message}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 italic">ยังไม่มีข้อความ</p>
                )}
              </div>
            </div>

            {/* Timestamp */}
            <div className="flex justify-center mt-3">
              <span className="text-white/70 text-xs">เมื่อกี้</span>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-700 font-medium mb-1">เมื่อไหร่ที่ส่ง?</p>
            <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
              <li>เมื่อลูกค้าเพิ่ม Bot เป็นเพื่อนครั้งแรก (Follow event)</li>
              <li>เมื่อลูกค้า Unblock แล้ว Follow ใหม่</li>
            </ul>
          </div>

          <div className="mt-3 p-3 bg-muted rounded-lg">
            <p className="text-xs text-muted-foreground font-medium mb-1">เคล็ดลับ:</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>ใช้ emoji ทำให้ข้อความดูเป็นมิตร</li>
              <li>บอก feature สำคัญที่ลูกค้าทำได้</li>
              <li>แนะนำให้พิมพ์ "ช่วยเหลือ" เพื่อดู command ทั้งหมด</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
