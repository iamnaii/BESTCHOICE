import { LineLinkInviteController } from '../link-invite.controller';
import type { IntegrationConfigService } from '../../integrations/integration-config.service';

/**
 * ตรรกะล้วน — สร้าง controller ตรง ๆ ไม่ผ่าน Nest module เพราะคลาสนี้มี
 * `@UseGuards(JwtAuthGuard, RolesGuard)` ระดับคลาส ซึ่งลาก PrismaService เข้ามาโดยไม่จำเป็น
 */
function build(value: string | null) {
  const getValue = jest.fn().mockResolvedValue(value);
  const controller = new LineLinkInviteController({
    getValue,
  } as unknown as IntegrationConfigService);
  return { controller, getValue };
}

describe('LineLinkInviteController.getLinkInvite', () => {
  it('ยังไม่ตั้งค่า → configured:false (หน้าจอจะบอกให้ไปตั้งค่า ไม่ใช่โชว์ QR เปล่า)', async () => {
    expect(await build(null).controller.getLinkInvite()).toEqual({
      configured: false,
      oaBasicId: null,
      addFriendUrl: null,
    });
  });

  it('ตั้งค่าเป็นช่องว่าง → ถือว่ายังไม่ตั้ง', async () => {
    expect((await build('   ').controller.getLinkInvite()).configured).toBe(false);
  });

  it('กรอกมาพร้อม @ → ใช้ตามนั้น', async () => {
    const res = await build('@bestchoice').controller.getLinkInvite();
    expect(res.oaBasicId).toBe('@bestchoice');
    expect(res.addFriendUrl).toBe('https://line.me/R/ti/p/%40bestchoice');
  });

  it('กรอกมาโดยไม่มี @ → เติมให้ (เจ้าของพิมพ์ทั้งสองแบบได้)', async () => {
    expect((await build('bestchoice').controller.getLinkInvite()).oaBasicId).toBe('@bestchoice');
  });

  it('มีช่องว่างหัวท้าย → ตัดทิ้งก่อน ไม่งั้นลิงก์พัง', async () => {
    const res = await build('  @shop123  ').controller.getLinkInvite();
    expect(res.oaBasicId).toBe('@shop123');
    expect(res.addFriendUrl).toContain('shop123');
    expect(res.addFriendUrl).not.toContain(' ');
  });

  it('อ่านค่าจาก integration line-shop คีย์ oaBasicId', async () => {
    const { controller, getValue } = build('@x');
    await controller.getLinkInvite();
    expect(getValue).toHaveBeenCalledWith('line-shop', 'oaBasicId');
  });
});
