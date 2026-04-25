import { useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Phone } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PbxExtension {
  number: string;
  name: string;
  status: string;
}

export default function UserProfilePage() {
  useDocumentTitle('โปรไฟล์ของฉัน');
  const { user } = useAuth();
  const [yeastarExtension, setYeastarExtension] = useState('');

  const { data: pbxExtensions = [] } = useQuery<PbxExtension[]>({
    queryKey: ['yeastar-extensions'],
    queryFn: () =>
      api
        .get<PbxExtension[]>('/yeastar/extensions')
        .then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    retry: false, // ถ้า Yeastar ไม่ได้ config ให้ silent fail
  });

  const saveExtensionMutation = useMutation({
    mutationFn: (extension: string) => api.patch('/users/me/extension', { extension }),
    onSuccess: () => toast.success('บันทึก Extension สำเร็จ'),
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  if (!user) return null;

  return (
    <div>
      <PageHeader title="โปรไฟล์ของฉัน" subtitle="ข้อมูลส่วนตัวและการตั้งค่าบัญชี" />

      <div className="flex flex-col gap-5 max-w-2xl">
        {/* ข้อมูลบัญชี */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ข้อมูลบัญชี</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground leading-snug">ชื่อ</p>
                <p className="font-medium leading-snug">{user.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground leading-snug">อีเมล</p>
                <p className="font-medium leading-snug">{user.email}</p>
              </div>
              {user.branchName && (
                <div>
                  <p className="text-muted-foreground leading-snug">สาขา</p>
                  <p className="font-medium leading-snug">{user.branchName}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Yeastar PBX Extension */}
        {pbxExtensions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" strokeWidth={1.75} />
                ระบบโทรศัพท์ Yeastar PBX
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Extension Yeastar (โทรศัพท์)</label>
                <div className="flex gap-2">
                  <Select value={yeastarExtension} onValueChange={setYeastarExtension}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="เลือก extension" />
                    </SelectTrigger>
                    <SelectContent>
                      {pbxExtensions.map((e) => (
                        <SelectItem key={e.number} value={e.number}>
                          {e.number} — {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => saveExtensionMutation.mutate(yeastarExtension)}
                    disabled={saveExtensionMutation.isPending || !yeastarExtension}
                  >
                    {saveExtensionMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'บันทึก'
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  ใช้สำหรับโทรออกและรับสายผ่านระบบ Yeastar PBX
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
