import { ROLE_LABELS } from '@/constants/user-roles';

interface PermissionUser<P extends string> {
  id: string;
  name: string;
  role: string;
  permissions: P[];
}

export function UserPermissionTable<P extends string>({
  users,
  permissions,
  labels,
  saving,
  onToggle,
  isDisabled,
}: {
  users: PermissionUser<P>[];
  permissions: readonly P[];
  labels: Record<P, string>;
  saving: boolean;
  onToggle: (userId: string, permission: P, checked: boolean) => void;
  isDisabled?: (user: PermissionUser<P>, permission: P) => boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="min-w-44 p-3 text-left font-medium">
              ผู้ใช้
            </th>
            {permissions.map((permission) => (
              <th key={permission} scope="col" className="min-w-28 p-3 text-center font-medium">
                {labels[permission]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((row) => (
            <tr key={row.id} className="border-t">
              <th scope="row" className="p-3 text-left font-normal">
                <p className="font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{ROLE_LABELS[row.role] ?? row.role}</p>
              </th>
              {permissions.map((permission) => (
                <td key={permission} className="p-3 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
                    aria-label={`${row.name}: ${labels[permission]}`}
                    checked={row.role === 'OWNER' || row.permissions.includes(permission)}
                    disabled={row.role === 'OWNER' || saving || !!isDisabled?.(row, permission)}
                    onChange={(event) => onToggle(row.id, permission, event.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
