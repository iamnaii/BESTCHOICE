import { Injectable } from '@nestjs/common';
import { AfterSalesLookupService } from './services/after-sales-lookup.service';
import { AfterSalesCaseService } from './services/after-sales-case.service';
import { AfterSalesQueryService } from './services/after-sales-query.service';
import { AfterSalesRepairService } from './services/after-sales-repair.service';
import { LookupDto } from './dto/lookup.dto';
import { CreateCaseDto } from './dto/create-case.dto';
import { ListCasesDto } from './dto/list-cases.dto';
import { CancelCaseDto } from './dto/cancel-case.dto';
import { SendDto } from '../repair-tickets/dto/send.dto';
import { MarkRepairedDto } from '../repair-tickets/dto/mark-repaired.dto';
import { SendBackDto } from '../repair-tickets/dto/send-back.dto';
import { ReturnToCustomerDto } from '../repair-tickets/dto/return-to-customer.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };

/**
 * Facade บาง ๆ ของโดเมน after-sales — รวม 4 services (lookup/case/query/repair) ให้ controller
 * เรียกผ่านจุดเดียว ไม่มี logic เอง แค่ re-export ชื่อ method เดิมของแต่ละ service
 */
@Injectable()
export class AfterSalesService {
  constructor(
    private readonly lookupSvc: AfterSalesLookupService,
    private readonly caseSvc: AfterSalesCaseService,
    private readonly querySvc: AfterSalesQueryService,
    private readonly repairSvc: AfterSalesRepairService,
  ) {}

  lookup(dto: LookupDto, user: ReqUser) {
    return this.lookupSvc.lookup(dto, user);
  }

  createCase(dto: CreateCaseDto, files: Express.Multer.File[], user: ReqUser) {
    return this.caseSvc.createCase(dto, files, user);
  }

  list(dto: ListCasesDto, user: ReqUser) {
    return this.querySvc.list(dto, user);
  }

  getCase(id: string, user: ReqUser) {
    return this.querySvc.getCase(id, user);
  }

  findByTicket(ticketId: string, user: ReqUser) {
    return this.querySvc.findByTicket(ticketId, user);
  }

  send(id: string, dto: SendDto, user: ReqUser) {
    return this.repairSvc.send(id, dto, user);
  }

  markRepaired(id: string, dto: MarkRepairedDto, user: ReqUser) {
    return this.repairSvc.markRepaired(id, dto, user);
  }

  sendBack(id: string, dto: SendBackDto, user: ReqUser) {
    return this.repairSvc.sendBack(id, dto, user);
  }

  returnToCustomer(id: string, dto: ReturnToCustomerDto, user: ReqUser) {
    return this.repairSvc.returnToCustomer(id, dto, user);
  }

  cancelCase(id: string, dto: CancelCaseDto, user: ReqUser) {
    return this.repairSvc.cancelCase(id, dto, user);
  }

  addPhoto(id: string, file: Express.Multer.File, user: ReqUser) {
    return this.repairSvc.addPhoto(id, file, user);
  }

  getPhoto(id: string, index: number, user: ReqUser) {
    return this.repairSvc.getPhoto(id, index, user);
  }

  getPurchasePhoto(id: string, angle: string, user: ReqUser) {
    return this.repairSvc.getPurchasePhoto(id, angle, user);
  }
}
