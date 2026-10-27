import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AttendanceService, type Actor } from './attendance.service';
import { BranchDayQueryDto, BranchMonthQueryDto, CorrectDayDto, MeMonthQueryDto, SetDayKindsDto } from './dto/attendance.dto';
import { bangkokCalendarParts } from '../../utils/date.util';

/**
 * เมนู ลงเวลา (ก้อน 10 D3 · สเปก §7 §8) — OWNER ทุกสาขา · ผจก.สาขาเฉพาะสาขาตัวเอง (ขอบเขตอยู่ใน service)
 * `me` = self-service ทุก role · route ทุกตัวลงทะเบียนใน access manifest (attendance.read / attendance.manage / attendance.devices)
 */
const ALL_STAFF = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'] as const;

const thisMonth = () => {
  const { year, month } = bangkokCalendarParts(new Date());
  return `${year}-${String(month + 1).padStart(2, '0')}`;
};

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get('today')
  @Roles('OWNER', 'BRANCH_MANAGER')
  today(@CurrentUser() user: Actor, @Query() query: BranchDayQueryDto) {
    return this.service.today(user, query.branchId, query.date ? new Date(`${query.date}T12:00:00+07:00`) : new Date());
  }

  @Get('month')
  @Roles('OWNER', 'BRANCH_MANAGER')
  month(@CurrentUser() user: Actor, @Query() query: BranchMonthQueryDto) {
    return this.service.month(user, query.branchId, query.month);
  }

  @Get('me')
  @Roles(...ALL_STAFF)
  me(@CurrentUser() user: Actor, @Query() query: MeMonthQueryDto) {
    return this.service.me(user.id, query.month ?? thisMonth());
  }

  @Get('punches/:id/photo')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async photo(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.service.photoStream(user, id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    // error กลางสตรีม (storage) — อย่าทิ้ง response ค้าง: ยังไม่ส่ง header ตอบ 500 · ส่งแล้วตัดคอนเนกชัน
    file.stream.on('error', () => {
      if (res.headersSent) res.destroy();
      else res.status(500).json({ message: 'อ่านรูปไม่สำเร็จ' });
    });
    file.stream.pipe(res);
  }

  @Patch('days/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  correctDay(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectDayDto) {
    return this.service.correctDay(user, id, dto);
  }

  @Put('day-kinds')
  @Roles('OWNER', 'BRANCH_MANAGER')
  setDayKinds(@CurrentUser() user: Actor, @Body() dto: SetDayKindsDto) {
    return this.service.setDayKinds(user, dto);
  }

  @Post('days/:id/clear-conflict')
  @Roles('OWNER')
  clearConflict(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.clearConflictFlag(user, id);
  }
}
