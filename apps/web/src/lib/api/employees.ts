import api from '@/lib/api';

export type EmploymentType = 'MONTHLY' | 'DAILY' | 'CONTRACT';

export interface EmployeeUser {
  id: string;
  name: string;
  nickname: string | null;
  employeeId: string | null;
  nationalId: string | null; // masked in list, full in detail
  startDate: string | null;
  branchId: string | null;
  isActive: boolean;
}

export interface Employee {
  id: string;
  userId: string;
  position: string | null;
  employmentType: EmploymentType;
  baseSalary: string | null; // Prisma Decimal serialises to string
  ssoEligible: boolean;
  bankName: string | null;
  bankAccountNo: string | null;
  taxIdOverride: string | null;
  note: string | null;
  resignedDate: string | null;
  user: EmployeeUser;
}

export interface EmployeeListResult {
  data: Employee[];
  total: number;
  page: number;
  limit: number;
}

export interface ProvisionableUser {
  userId: string;
  employeeId: string | null;
  name: string;
  nickname: string | null;
}

export interface ProvisionEmployeeInput {
  userId: string;
  position?: string;
  employmentType?: EmploymentType;
  baseSalary?: number;
  ssoEligible?: boolean;
  bankName?: string;
  bankAccountNo?: string;
  taxIdOverride?: string;
  note?: string;
}

export type UpdateEmployeeInput = Partial<Omit<ProvisionEmployeeInput, 'userId'>> & {
  resignedDate?: string | null;
};

export const employeeKeys = {
  all: ['employees'] as const,
  list: (params: Record<string, unknown>) => [...employeeKeys.all, 'list', params] as const,
  detail: (id: string) => [...employeeKeys.all, 'detail', id] as const,
  provisionable: (search: string) => [...employeeKeys.all, 'provisionable', search] as const,
};

export const employeesApi = {
  list: (params: { search?: string; isActive?: boolean; page?: number; limit?: number }) => {
    const query: Record<string, unknown> = { page: params.page ?? 1, limit: params.limit ?? 50 };
    if (params.search) query.search = params.search;
    if (params.isActive !== undefined) query.isActive = String(params.isActive);
    return api.get<EmployeeListResult>('/employees', { params: query }).then((r) => r.data);
  },
  detail: (id: string) => api.get<Employee>(`/employees/${id}`).then((r) => r.data),
  provisionable: (search?: string) =>
    api
      .get<ProvisionableUser[]>('/employees/provisionable', { params: search ? { search } : {} })
      .then((r) => r.data),
  provision: (input: ProvisionEmployeeInput) =>
    api.post<Employee>('/employees', input).then((r) => r.data),
  update: (id: string, input: UpdateEmployeeInput) =>
    api.patch<Employee>(`/employees/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/employees/${id}`).then((r) => r.data),
};
