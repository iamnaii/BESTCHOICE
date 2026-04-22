import { Input, InputAddon, InputGroup } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function InputStory() {
  return (
    <div className="p-8 space-y-6 max-w-md">
      <div>
        <Label htmlFor="name">ชื่อ-นามสกุล</Label>
        <Input id="name" placeholder="บีม ทดสอบ" />
      </div>
      <div>
        <Label htmlFor="phone" required help="เบอร์ 10 หลัก">เบอร์โทรศัพท์</Label>
        <Input id="phone" placeholder="0812345678" />
      </div>
      <div>
        <Label htmlFor="id" required error="เลขบัตรประชาชน 13 หลัก">เลขบัตรประชาชน</Label>
        <Input id="id" defaultValue="12345" aria-invalid="true" />
      </div>
      <div>
        <Label htmlFor="amount">จำนวนเงิน</Label>
        <InputGroup>
          <InputAddon>฿</InputAddon>
          <Input id="amount" type="number" placeholder="9000" />
        </InputGroup>
      </div>
    </div>
  );
}
