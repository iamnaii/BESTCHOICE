import api from '@/lib/api';

export type EmploymentType = 'MONTHLY' | 'DAILY' | 'CONTRACT';

export interface EmployeeProfileDetail {
  id: string;
  position: string | null;
  employmentType: EmploymentType;
  baseSalary: string | null; // Prisma Decimal → JSON string
  ssoEligible: boolean;
  bankName: string | null;
  bankAccountNo: string | null;
  resignedDate: string | null;
}

export interface UserDetail {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
  employeeId: string | null;
  nickname: string | null;
  phone: string | null;
  lineId: string | null;
  address: string | null;
  avatarUrl: string | null;
  startDate: string | null;
  nationalId: string | null;
  birthDate: string | null;
  branch: { id: string; name: string } | null;
  employeeProfile: EmployeeProfileDetail | null;
}

export interface EmployeeProfileInput {
  position?: string;
  employmentType?: EmploymentType;
  baseSalary?: number;
  ssoEligible?: boolean;
  bankName?: string;
  bankAccountNo?: string;
  resignedDate?: string | null;
}

// user fields + optional employee block (combined save)
export type SaveUserProfileBody = Record<string, unknown> & {
  employee?: EmployeeProfileInput | null;
};

export const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
};

export const usersApi = {
  detail: (id: string) => api.get<UserDetail>(`/users/${id}`).then((r) => r.data),
  create: (body: SaveUserProfileBody) => api.post<UserDetail>('/users', body).then((r) => r.data),
  saveProfile: (id: string, body: SaveUserProfileBody) =>
    api.put<UserDetail>(`/users/${id}/profile`, body).then((r) => r.data),
};
