import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DEFAULT_ACCESS_POSITIONS,
  PERMISSION_CATALOG,
  type AccessSnapshot,
  type EmployeeAccessContext,
  type EmployeeAccessHistoryPage,
} from '@installment/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import EmployeeAccessPage from './index';
import type { AccessEmployee, AccessPosition, MigrationPreview } from './api';

const position: AccessPosition = {
  id: 'position-sales',
  code: 'SHOP_SALES',
  name: 'พนักงานขายตัวอย่าง',
  permissions: ['sales.read', 'sales.create'],
  isActive: true,
  revision: 7,
  affectedEmployeeCount: 2,
};
const disabledPosition = {
  ...position,
  id: 'position-old',
  code: 'SHOP_OLD',
  name: 'ตำแหน่งเก่า',
  isActive: false,
};
const context: EmployeeAccessContext = {
  companies: ['SHOP', 'FINANCE'],
  branches: [{ id: 'north', name: 'สาขาเหนือ', companyCode: 'SHOP' }],
};
const legacy: AccessEmployee = {
  id: 'legacy',
  name: 'พนักงานเดิม',
  email: 'legacy@example.invalid',
  role: 'SALES',
  branchId: 'north',
  isActive: true,
  accessManaged: false,
  accessRevision: 3,
  accessibleCompanies: [],
  primaryCompany: null,
  canReverseOverride: true,
  accessAssignments: [],
};
const managed: AccessEmployee = {
  ...legacy,
  id: 'managed',
  name: 'พนักงานระบบใหม่',
  accessManaged: true,
  canReverseOverride: null,
  accessAssignments: [
    {
      id: 'assignment-old',
      companyCode: 'SHOP',
      positionId: disabledPosition.id,
      scope: 'BRANCHES',
      branches: [{ branchId: 'north' }],
      position: disabledPosition,
    },
  ],
};
const migration: MigrationPreview = {
  ...legacy,
  managed: false,
  isOwner: false,
  proposedPositionCode: 'SALES',
  proposedCompanies: ['SHOP'],
  proposedBranchIds: ['north'],
  proposedScope: 'BRANCHES',
  personalGrants: {
    canReverseOverride: true,
    accounting_permissions: ['EXPENSE_APPROVE'],
    payment_approval_permissions: [],
  },
  warnings: ['ต้องให้เจ้าของตรวจสอบหน้าที่จริงและยืนยันขอบเขตก่อนเปิดใช้'],
  requiresReview: true,
  reservedRightsRemoved: [],
};
const managedPreview: MigrationPreview = {
  ...migration,
  ...managed,
  managed: true,
  personalGrants: { canReverseOverride: null, accounting_permissions: [], payment_approval_permissions: [] },
};
const history: EmployeeAccessHistoryPage = {
  page: 1,
  limit: 20,
  total: 21,
  items: [
    {
      id: 'event',
      entity: 'access_position',
      entityId: position.id,
      action: 'ACCESS_POSITION_UPDATED',
      createdAt: '2026-11-24T07:00:00Z',
      actor: { id: 'owner', name: 'เจ้าของตัวอย่าง' },
      before: { ...position, permissions: ['sales.create'] },
      after: { ...position, permissions: ['sales.read'] },
    },
  ],
};
const httpError = (status: number) => ({ response: { status, data: {} } });

function renderPage() {
  const data = {
    positions: [position, disabledPosition],
    employees: [
      legacy,
      managed,
      { ...legacy, id: 'owner', name: 'เจ้าของตัวอย่าง', role: 'OWNER' },
      { ...legacy, id: 'inactive', name: 'พนักงานที่ปิด', isActive: false },
    ],
    migration: [migration, managedPreview],
    historyFailure: false,
    positionsFailure: false,
  };
  const get = vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    switch (url) {
      case '/employee-access/positions':
        if (data.positionsFailure) throw httpError(500);
        return { data: data.positions };
      case '/employee-access/employees':
        return { data: data.employees };
      case '/employee-access/catalog':
        return {
          data: {
            permissions: PERMISSION_CATALOG,
            templates: DEFAULT_ACCESS_POSITIONS,
            scopes: ['BRANCHES', 'ASSIGNED', 'COMPANY'],
            companies: ['SHOP', 'FINANCE'],
          },
        };
      case '/employee-access/context':
        return { data: context };
      case '/employee-access/migration-preview':
        return { data: data.migration };
      case '/employee-access/history':
        if (data.historyFailure) throw httpError(500);
        return { data: config?.params?.page === 2 ? { ...history, page: 2, items: [] } : history };
      default: {
        const user = data.employees.find(
          (employee) => url === `/employee-access/employees/${employee.id}/effective-access`,
        );
        if (!user) throw new Error(`Unexpected GET ${url}`);
        const snapshot: AccessSnapshot = {
          userId: user.id,
          isOwner: user.role === 'OWNER',
          managed: user.accessManaged,
          revision: user.accessRevision,
          grants: user.accessManaged
            ? [
                {
                  positionId: position.id,
                  permissions: ['contracts.read'],
                  company: 'FINANCE',
                  scope: 'ASSIGNED',
                  branchIds: ['north'],
                },
              ]
            : [],
        };
        return { data: snapshot };
      }
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeAccessPage />
    </QueryClientProvider>,
  );
  return { data, get, client, user: userEvent.setup() };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const positionTab = () => screen.getByRole('tab', { name: 'ตำแหน่งและสิทธิ์' });
const review = () => button('ตรวจสอบผลกระทบ');

afterEach(() => vi.restoreAllMocks());

describe('EmployeeAccessPage', () => {
  it('keeps permission selections when filtering and locks reserved catalog entries', async () => {
    const { user } = renderPage();
    await user.click(positionTab());
    await user.click(await screen.findByRole('button', { name: 'สร้างตำแหน่ง' }));
    const search = screen.getByRole('searchbox', { name: 'ค้นหาสิทธิ์' });
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(search, { target: { value: 'sales.read' } });
    await user.click(await dialog.findByRole('checkbox', { name: /ดูการขาย/ }));
    fireEvent.change(search, { target: { value: 'positions.manage' } });
    expect(await dialog.findByRole('checkbox', { name: /จัดการตำแหน่งและสิทธิ์/ })).toBeDisabled();
    fireEvent.change(search, { target: { value: 'activity.read' } });
    expect(await dialog.findByRole('checkbox', { name: /ดูสรุปประวัติกิจกรรม/ })).toBeDisabled();
    fireEvent.change(search, { target: { value: 'sales.read' } });
    expect(await dialog.findByRole('checkbox', { name: /ดูการขาย/ })).toBeChecked();
  });

  it('previews position additions, removals and affected staff before saving', async () => {
    const { user } = renderPage();
    await user.click(positionTab());
    await user.click(await screen.findByRole('button', { name: `แก้ไข ${position.name}` }));
    const search = screen.getByRole('searchbox', { name: 'ค้นหาสิทธิ์' });
    fireEvent.change(search, { target: { value: 'sales.create' } });
    await user.click(await screen.findByRole('checkbox', { name: /สร้างการขาย/ }));
    fireEvent.change(search, { target: { value: 'contracts.read' } });
    await user.click(await screen.findByRole('checkbox', { name: /ดูสัญญา/ }));
    await user.click(review());
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/พนักงานที่ได้รับมอบหมาย 2 คน/)).toBeVisible();
    expect(within(dialog.getByRole('region', { name: 'สิทธิ์ที่เพิ่ม' })).getByText('ดูสัญญา')).toBeVisible();
    expect(
      within(dialog.getByRole('region', { name: 'สิทธิ์ที่นำออก' })).getByText('สร้างการขาย'),
    ).toBeVisible();
  });

  it('preserves a stale position draft until explicit reload and does not rebase its write', async () => {
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(httpError(409));
    const { data, user } = renderPage();
    await user.click(positionTab());
    await user.click(await screen.findByRole('button', { name: `แก้ไข ${position.name}` }));
    fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อตำแหน่ง' }), {
      target: { value: 'ร่างก่อนบันทึก' },
    });
    await user.click(review());
    await user.click(button('ยืนยันบันทึก'));
    expect(await screen.findByRole('button', { name: 'โหลดข้อมูลล่าสุด' })).toBeVisible();
    expect(patch).toHaveBeenCalledWith(
      '/employee-access/positions/position-sales',
      expect.objectContaining({
        expectedRevision: 7,
        expectedAffectedEmployeeCount: 2,
        name: 'ร่างก่อนบันทึก',
      }),
    );
    expect(button('ยืนยันบันทึก')).toBeDisabled();
    await user.click(button('กลับไปแก้ไข'));
    expect(screen.getByRole('textbox', { name: 'ชื่อตำแหน่ง' })).toHaveValue('ร่างก่อนบันทึก');
    expect(review()).toBeDisabled();
    data.positions = [{ ...position, name: 'ข้อมูลล่าสุด', revision: 8 }];
    await user.click(button('โหลดข้อมูลล่าสุด'));
    expect(await screen.findByDisplayValue('ข้อมูลล่าสุด')).toBeVisible();
  });

  it('binds status changes to the reviewed affected employee count', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: {} });
    const { user } = renderPage();
    await user.click(positionTab());
    await user.click(await screen.findByRole('button', { name: `ปิดใช้งาน ${position.name}` }));
    expect(screen.getByText(/พนักงานที่ได้รับมอบหมาย 2 คน/)).toBeVisible();
    await user.click(button('ยืนยันบันทึก'));
    expect(patch).toHaveBeenCalledWith('/employee-access/positions/position-sales', {
      expectedRevision: 7,
      expectedAffectedEmployeeCount: 2,
      isActive: false,
    });
  });

  it('keeps the draft if an explicit reload fails after a revision conflict', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(httpError(409));
    const { data, user } = renderPage();
    await user.click(positionTab());
    await user.click(await screen.findByRole('button', { name: `แก้ไข ${position.name}` }));
    fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อตำแหน่ง' }), {
      target: { value: 'เก็บร่างไว้' },
    });
    await user.click(review());
    await user.click(button('ยืนยันบันทึก'));
    const reload = await screen.findByRole('button', { name: 'โหลดข้อมูลล่าสุด' });
    data.positionsFailure = true;
    await user.click(reload);
    expect(await screen.findByRole('button', { name: 'โหลดข้อมูลล่าสุด' })).toBeVisible();
    await user.click(button('กลับไปแก้ไข'));
    expect(screen.getByRole('textbox', { name: 'ชื่อตำแหน่ง' })).toHaveValue('เก็บร่างไว้');
  });

  it('creates templates only after the owner confirms the review', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { createdCount: 5 } });
    const { user } = renderPage();
    await user.click(positionTab());
    await user.click(await screen.findByRole('button', { name: 'เพิ่มตำแหน่งจากแม่แบบ' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('พนักงานที่ได้รับมอบหมาย 0 คน')).toBeVisible();
    await user.click(button('ยืนยันบันทึก'));
    expect(post).toHaveBeenCalledWith('/employee-access/positions/seed-templates');
  });

  it('locks owner and inactive accounts and shows saved tuples alongside the server snapshot', async () => {
    const { user, get } = renderPage();
    await user.click(await screen.findByRole('button', { name: /พนักงานที่ปิด/ }));
    expect(screen.queryByRole('button', { name: 'แก้ไขการมอบหมาย' })).toBeNull();
    expect(get).not.toHaveBeenCalledWith('/employee-access/employees/inactive/effective-access');
    await user.click(button(/เจ้าของตัวอย่าง/));
    expect(screen.queryByRole('button', { name: 'แก้ไขการมอบหมาย' })).toBeNull();
    await user.click(button(/พนักงานระบบใหม่/));
    expect(await screen.findByText(/เฉพาะรายการที่ได้รับมอบหมาย/)).toBeVisible();
    expect(screen.getByText('ตำแหน่งเก่า (ปิดใช้งาน)')).toBeVisible();
    expect(screen.getByText(/ต้องได้รับมอบหมายรายการนั้นจริง/)).toBeVisible();
    const grant = screen.getByText(position.name);
    await user.click(grant);
    expect(screen.getByText('ดูสัญญา')).toBeVisible();
    expect(screen.queryByText('สร้างการขาย')).toBeNull();
  });

  it('requires a fresh acknowledgement before converting legacy access and sends only the chosen tuple', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: /พนักงานเดิม/ }));
    expect(await screen.findByText(/ยังไม่ได้คำนวณสิทธิ์เดิมทั้งหมด/)).toBeVisible();
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการมอบหมาย' }));
    await user.click(button('เพิ่มตำแหน่งที่มอบหมาย'));
    const editor = within(screen.getByRole('dialog'));
    await user.selectOptions(editor.getByRole('combobox', { name: 'ตำแหน่ง' }), position.id);
    await user.selectOptions(editor.getByRole('combobox', { name: 'ส่วนงาน' }), 'FINANCE');
    await user.click(review());
    expect(await editor.findByText(/เลือกอย่างน้อย 1 สาขา/)).toBeVisible();
    await user.click(editor.getByRole('checkbox', { name: /สาขาเหนือ/ }));
    await user.click(review());
    const migrationReview = within(await editor.findByRole('region', { name: 'การเปลี่ยนจากสิทธิ์เดิม' }));
    expect(migrationReview.getByText(/ลบสิทธิ์รายบุคคลเดิม/)).toBeVisible();
    expect(editor.getByText(/การตั้งค่ากลับรายการสินทรัพย์/)).toBeVisible();
    expect(button('ยืนยันบันทึก')).toBeDisabled();
    await user.click(editor.getByRole('checkbox', { name: /รับทราบ/ }));
    await user.click(button('กลับไปแก้ไข'));
    await user.selectOptions(editor.getByRole('combobox', { name: 'ขอบเขต' }), 'COMPANY');
    await user.click(review());
    expect(await editor.findByText(/ให้สิทธิ์กับทุกสาขา/)).toBeVisible();
    expect(button('ยืนยันบันทึก')).toBeDisabled();
    await user.click(editor.getByRole('checkbox', { name: /รับทราบ/ }));
    await user.click(button('ยืนยันบันทึก'));
    expect(put).toHaveBeenCalledWith('/employee-access/employees/legacy/assignments', {
      expectedRevision: 3,
      assignments: [
        {
          positionId: position.id,
          company: 'FINANCE',
          scope: 'COMPANY',
          branchIds: [],
          expectedPositionRevision: 7,
        },
      ],
    });
  });

  it('requires another acknowledgement when the legacy overrides change before saving', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
    const { data, user } = renderPage();
    await user.click(await screen.findByRole('button', { name: /พนักงานเดิม/ }));
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการมอบหมาย' }));
    await user.click(review());
    expect(await screen.findByText(/รายจ่าย: อนุมัติ/)).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: /รับทราบ/ }));
    data.migration = [
      {
        ...migration,
        personalGrants: { ...migration.personalGrants, accounting_permissions: ['EXPENSE_CANCEL'] },
      },
    ];
    await user.click(button('ยืนยันบันทึก'));
    expect(await screen.findByText(/รายจ่าย: ยกเลิก/)).toBeVisible();
    expect(put).not.toHaveBeenCalled();
    expect(button('ยืนยันบันทึก')).toBeDisabled();
  });

  it('requires acknowledgement before removing a managed employee’s explicit deny override', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
    const { data, user } = renderPage();
    data.migration = [
      {
        ...managedPreview,
        personalGrants: { ...managedPreview.personalGrants, canReverseOverride: false },
      },
    ];
    await user.click(await screen.findByRole('button', { name: /พนักงานระบบใหม่/ }));
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการมอบหมาย' }));
    await user.click(button('นำการมอบหมายที่ 1 ออก'));
    await user.click(review());
    expect(await screen.findByText(/ปฏิเสธเป็นรายบุคคล/)).toBeVisible();
    expect(screen.queryByText('เริ่มใช้สิทธิ์ตามตำแหน่งทันที')).toBeNull();
    expect(button('ยืนยันบันทึก')).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /รับทราบ/ }));
    await user.click(button('ยืนยันบันทึก'));
    expect(put).toHaveBeenCalledWith('/employee-access/employees/managed/assignments', {
      expectedRevision: 3,
      assignments: [],
    });
  });

  it('rechecks managed overrides and requires a new acknowledgement if a reviewed override disappears', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
    const { data, user } = renderPage();
    data.migration = [
      {
        ...managedPreview,
        personalGrants: { ...managedPreview.personalGrants, canReverseOverride: false },
      },
    ];
    await user.click(await screen.findByRole('button', { name: /พนักงานระบบใหม่/ }));
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการมอบหมาย' }));
    await user.click(button('นำการมอบหมายที่ 1 ออก'));
    await user.click(review());
    await user.click(await screen.findByRole('checkbox', { name: /รับทราบ/ }));
    data.migration = [managedPreview];
    await user.click(button('ยืนยันบันทึก'));
    expect(await screen.findByText(/ข้อมูลสิทธิ์รายบุคคลเปลี่ยนแปลง/)).toBeVisible();
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /รับทราบ/ })).not.toBeChecked();
    expect(button('ยืนยันบันทึก')).toBeDisabled();
  });

  it('invalidates an assignment confirmation when a reviewed position revision changes without changing permission labels', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
    const { user, client } = renderPage();
    await user.click(await screen.findByRole('button', { name: /พนักงานเดิม/ }));
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการมอบหมาย' }));
    await user.click(button('เพิ่มตำแหน่งที่มอบหมาย'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'ตำแหน่ง' }), position.id);
    await user.click(screen.getByRole('checkbox', { name: /สาขาเหนือ/ }));
    await user.click(review());
    await user.click(await screen.findByRole('checkbox', { name: /รับทราบ/ }));
    expect(button('ยืนยันบันทึก')).toBeEnabled();
    act(() =>
      client.setQueryData(['employee-access', 'positions'], [{ ...position, revision: 8 }, disabledPosition]),
    );
    expect(await screen.findByText(/ตำแหน่งหรือสาขามีการเปลี่ยนแปลง/)).toBeVisible();
    expect(button('ยืนยันบันทึก')).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it('retries failed history reads and renders hand-labelled before and after states', async () => {
    const { data, user } = renderPage();
    data.historyFailure = true;
    await user.click(screen.getByRole('tab', { name: 'ประวัติการเปลี่ยนแปลง' }));
    await screen.findByRole('alert');
    data.historyFailure = false;
    await user.click(button('ลองใหม่'));
    expect(await screen.findByText('เจ้าของตัวอย่าง')).toBeVisible();
    await user.click(screen.getByText('ดูรายละเอียด'));
    expect(
      within(screen.getByRole('region', { name: 'ก่อนเปลี่ยน' })).getByText('สร้างการขาย'),
    ).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'หลังเปลี่ยน' })).getByText('ดูการขาย')).toBeVisible();
    await user.click(button('หน้าถัดไป'));
    expect(await screen.findByText('ไม่มีรายการในหน้านี้')).toBeVisible();
  });
});
