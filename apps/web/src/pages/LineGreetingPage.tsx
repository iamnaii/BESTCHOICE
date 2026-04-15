import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquareMore, Save, RotateCcw } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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
  const [showQuickReply, setShowQuickReply] = useState(true);

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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="ข้อความต้อนรับ LINE"
        subtitle="ข้อความที่ลูกค้าจะได้รับเมื่อเพิ่ม Bot เป็นเพื่อนครั้งแรก"
        icon={<MessageSquareMore size={22} />}
      />

      {/* Main 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Editor Panel ─── */}
        <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
          {/* Section header */}
          <div className="px-5 py-3.5 border-b border-border/50 bg-gradient-to-r from-[#06C755]/5 to-transparent">
            <h2 className="font-semibold text-foreground text-sm">ข้อความต้อนรับ</h2>
          </div>

          <div className="p-5 space-y-4">
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">กำลังโหลด...</div>
            ) : (
              <>
                {/* Textarea */}
                <div>
                  <Textarea
                    value={message}
                    onChange={(e) => handleChange(e.target.value)}
                    rows={10}
                    placeholder="ข้อความต้อนรับ..."
                    className={isOverLimit ? 'border-destructive' : ''}
                  />
                  <div
                    className={`flex justify-between text-xs mt-1.5 ${
                      isOverLimit ? 'text-destructive' : 'text-muted-foreground'
                    }`}
                  >
                    <span>รองรับ emoji, ตัวอักษร, และ line break</span>
                    <span>{charCount.toLocaleString()} / 5,000</span>
                  </div>
                </div>

                {/* Quick Reply toggle */}
                <div className="pt-1 border-t border-border/40">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Quick Reply Buttons</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showQuickReply}
                      onChange={(e) => setShowQuickReply(e.target.checked)}
                      className="accent-[#06C755]"
                    />
                    <span className="text-sm">แสดง Quick Reply หลังข้อความ</span>
                  </label>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || !isDirty || isOverLimit}
                    className="bg-gradient-to-r from-[#06C755] to-[#04B44C] hover:from-[#05a848] hover:to-[#039a40] text-white border-0 gap-1.5"
                  >
                    <Save size={14} />
                    {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={saveMutation.isPending}
                    className="gap-1.5"
                  >
                    <RotateCcw size={14} />
                    รีเซ็ต
                  </Button>
                </div>

                {/* Unsaved indicator */}
                {isDirty && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ─── Preview Panel ─── */}
        <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
          {/* Section header */}
          <div className="px-5 py-3.5 border-b border-border/50 bg-gradient-to-r from-[#06C755]/5 to-transparent">
            <h2 className="font-semibold text-foreground text-sm">ตัวอย่างใน LINE</h2>
          </div>

          <div className="p-5 flex justify-center">
            {/* Phone frame */}
            <div className="relative max-w-[320px] w-full">
              <div className="bg-gray-800 rounded-[2.5rem] p-3 shadow-2xl">
                {/* Notch */}
                <div className="bg-black w-24 h-5 rounded-full mx-auto mb-2" />
                {/* LINE screen */}
                <div className="bg-[#7b9ebc] rounded-2xl overflow-hidden min-h-[400px] flex flex-col">
                  {/* LINE green header */}
                  <div className="bg-[#06C755] px-4 py-3 flex items-center gap-3 shrink-0">
                    <div className="w-8 h-8 rounded-full bg-white/30" />
                    <div>
                      <div className="text-white font-bold text-sm">BESTCHOICE</div>
                      <div className="text-white/70 text-[10px]">Official Account</div>
                    </div>
                  </div>

                  {/* Chat area */}
                  <div className="p-4 space-y-3 flex-1">
                    {/* System message */}
                    <div className="text-center">
                      <span className="text-[10px] text-white/60 bg-white/20 px-3 py-1 rounded-full">
                        เพิ่มเพื่อนแล้ว
                      </span>
                    </div>

                    {/* Bot message bubble */}
                    <div className="flex items-start gap-2">
                      <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
                        <span className="text-[#06C755] text-xs font-bold">BC</span>
                      </div>
                      <div className="bg-white rounded-2xl rounded-tl-sm px-3.5 py-2.5 max-w-[80%] shadow-sm">
                        <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">
                          {message
                            ? message.length > 300
                              ? message.slice(0, 300) + '...'
                              : message
                            : 'ข้อความจะแสดงที่นี่...'}
                        </p>
                      </div>
                    </div>

                    {/* Quick Reply buttons */}
                    {showQuickReply && (
                      <div className="flex gap-2 overflow-x-auto pb-1 mt-2">
                        {['📱 ดูสินค้า', '💰 สอบถามราคา', '📄 ดูสัญญา', '💬 คุยกับพนักงาน'].map((btn) => (
                          <div
                            key={btn}
                            className="shrink-0 px-3 py-1.5 bg-white rounded-full text-[11px] text-[#06C755] font-medium border border-[#06C755]/30 shadow-sm"
                          >
                            {btn}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bottom input bar */}
                  <div className="bg-white/95 border-t px-4 py-2.5 flex items-center gap-2 shrink-0">
                    <div className="flex-1 bg-gray-100 rounded-full px-3 py-1.5 text-[12px] text-gray-400">
                      Aa
                    </div>
                  </div>
                </div>
                {/* Home indicator */}
                <div className="w-32 h-1 bg-white/30 rounded-full mx-auto mt-2" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Tips Card ─── */}
      <div className="rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">💡</span>
          <h3 className="font-semibold text-blue-900 text-sm">เคล็ดลับการเขียนข้อความต้อนรับที่ดี</h3>
        </div>
        <ul className="space-y-1.5 text-sm text-blue-800">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">•</span>
            <span>ใช้ emoji ทำให้ข้อความดูเป็นมิตรและน่าอ่านมากขึ้น</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">•</span>
            <span>บอก feature สำคัญที่ลูกค้าสามารถใช้งานผ่าน LINE ได้</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">•</span>
            <span>ส่งเมื่อลูกค้า Follow ครั้งแรก และเมื่อ Unblock แล้ว Follow ใหม่</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">•</span>
            <span>แนะนำให้พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งทั้งหมดที่ใช้ได้</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
