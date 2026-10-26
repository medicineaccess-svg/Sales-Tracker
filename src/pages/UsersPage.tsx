import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, Mail, MoreHorizontal, Pencil, Power, UserPlus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { useDepartments } from '@/hooks/useData';
import { edgeFunctionError, notify } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { passwordSchema } from './auth/PasswordPages';

interface ManagedUser {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'department_user';
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  departments: { code: string; name: string } | null;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) throw new Error(await edgeFunctionError(error));
  return data as T;
}

const createSchema = z
  .object({
    email: z.string().trim().email('Enter a valid email'),
    full_name: z.string().trim().max(120),
    role: z.enum(['admin', 'department_user']),
    department_code: z.string(),
    mode: z.enum(['password', 'invite']),
    password: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'department_user' && !v.department_code) ctx.addIssue({ code: 'custom', path: ['department_code'], message: 'Choose a department' });
    if (v.mode === 'password') {
      const r = passwordSchema.safeParse(v.password);
      if (!r.success) ctx.addIssue({ code: 'custom', path: ['password'], message: r.error.issues[0].message });
    }
  });
type CreateValues = z.infer<typeof createSchema>;

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: depts } = useDepartments();
  const { register, handleSubmit, watch, reset, formState } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: '', full_name: '', role: 'department_user', department_code: 'npp', mode: 'password', password: '' },
  });
  const mode = watch('mode');
  const role = watch('role');
  const m = useMutation({
    mutationFn: (v: CreateValues) =>
      call({
        action: 'create',
        email: v.email,
        full_name: v.full_name,
        role: v.role,
        department_code: v.role === 'admin' ? null : v.department_code,
        password: v.mode === 'password' ? v.password : undefined,
      }),
    onSuccess: async (_, v) => {
      notify.success(v.mode === 'invite' ? 'Invitation sent' : 'User created');
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => notify.error((e as Error).message),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add user"
      description="Users are linked to one department. Only administrators can create accounts."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-user" loading={m.isPending}>
            Create user
          </Button>
        </>
      }
    >
      <form id="create-user" className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={handleSubmit((v) => m.mutate(v))}>
        <Field label="Email" htmlFor="u-email" required error={formState.errors.email?.message} className="sm:col-span-2">
          <Input id="u-email" type="email" autoComplete="off" {...register('email')} />
        </Field>
        <Field label="Full name" htmlFor="u-name" error={formState.errors.full_name?.message} className="sm:col-span-2">
          <Input id="u-name" {...register('full_name')} />
        </Field>
        <Field label="Role" htmlFor="u-role">
          <Select id="u-role" {...register('role')}>
            <option value="department_user">Department user</option>
            <option value="admin">Administrator</option>
          </Select>
        </Field>
        <Field label="Department" htmlFor="u-dept" error={formState.errors.department_code?.message}>
          <Select id="u-dept" {...register('department_code')} disabled={role === 'admin'}>
            <option value="">—</option>
            {depts?.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
                {d.status !== 'active' ? ' (coming soon)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How should they sign in?" htmlFor="u-mode" className="sm:col-span-2">
          <Select id="u-mode" {...register('mode')}>
            <option value="password">Set a temporary password now</option>
            <option value="invite">Email an invitation link</option>
          </Select>
        </Field>
        {mode === 'password' && (
          <Field
            label="Temporary password"
            htmlFor="u-pass"
            required
            error={formState.errors.password?.message}
            hint="Share it securely; ask the user to change it from Profile after first sign-in."
            className="sm:col-span-2"
          >
            <Input id="u-pass" type="password" autoComplete="new-password" {...register('password')} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

function EditAccessDialog({ user, onClose }: { user: ManagedUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: depts } = useDepartments();
  const [role, setRole] = useState(user?.role ?? 'department_user');
  const [dept, setDept] = useState(user?.departments?.code ?? '');
  const [name, setName] = useState(user?.full_name ?? '');
  const [lastId, setLastId] = useState<string | null>(null);
  if (user && user.id !== lastId) {
    setLastId(user.id);
    setRole(user.role);
    setDept(user.departments?.code ?? '');
    setName(user.full_name ?? '');
  }
  const m = useMutation({
    mutationFn: () =>
      call({ action: 'update_access', user_id: user!.id, role, department_code: role === 'admin' ? null : dept || null, is_active: user!.is_active, full_name: name }),
    onSuccess: async () => {
      notify.success('User access updated');
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (e) => notify.error((e as Error).message),
  });
  return (
    <Modal
      open={!!user}
      onOpenChange={(o) => !o && onClose()}
      title="Edit user access"
      description={user?.email}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={role === 'department_user' && !dept}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name" htmlFor="e-name">
          <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="e-role">
          <Select id="e-role" value={role} onChange={(e) => setRole(e.target.value as ManagedUser['role'])}>
            <option value="department_user">Department user</option>
            <option value="admin">Administrator</option>
          </Select>
        </Field>
        <Field label="Department" htmlFor="e-dept" error={role === 'department_user' && !dept ? 'Choose a department' : undefined}>
          <Select id="e-dept" value={dept} onChange={(e) => setDept(e.target.value)} disabled={role === 'admin'}>
            <option value="">—</option>
            {depts?.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-muted">Role changes are checked and recorded by the database; the last active administrator cannot be removed.</p>
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [toggle, setToggle] = useState<ManagedUser | null>(null);
  const [pwUser, setPwUser] = useState<ManagedUser | null>(null);
  const [pw, setPw] = useState('');
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => call<{ users: ManagedUser[] }>({ action: 'list' }).then((r) => r.users),
  });

  const activeToggle = useMutation({
    mutationFn: (u: ManagedUser) =>
      call({ action: 'update_access', user_id: u.id, role: u.role, department_code: u.departments?.code ?? null, is_active: !u.is_active }),
    onSuccess: async (_, u) => {
      notify.success(u.is_active ? 'User deactivated' : 'User reactivated');
      setToggle(null);
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => notify.error((e as Error).message),
  });
  const reset = useMutation({
    mutationFn: (u: ManagedUser) => call({ action: 'send_reset', user_id: u.id }),
    onSuccess: () => notify.success('Password reset email sent'),
    onError: (e) => notify.error((e as Error).message),
  });
  const setPassword = useMutation({
    mutationFn: () => {
      const r = passwordSchema.safeParse(pw);
      if (!r.success) throw new Error(r.error.issues[0].message);
      return call({ action: 'set_password', user_id: pwUser!.id, password: pw });
    },
    onSuccess: () => {
      notify.success('Temporary password set');
      setPwUser(null);
      setPw('');
    },
    onError: (e) => notify.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Create named accounts, assign each user to a department and control access. Every change is audited."
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="h-4 w-4" /> Add user
          </Button>
        }
      />
      <Card>
        {isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas/60 text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last sign-in</th>
                  <th className="w-12 px-4" />
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-2">
                        <Skeleton className="h-6" />
                      </td>
                    </tr>
                  ))}
                {data?.map((u) => (
                  <tr key={u.id} className="border-b border-line/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{u.full_name || '—'}</p>
                      <p className="text-xs text-muted">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">{u.role === 'admin' ? <Badge tone="brand">Administrator</Badge> : <Badge>Department user</Badge>}</td>
                    <td className="px-4 py-3 text-sm">{u.departments?.name ?? (u.role === 'admin' ? 'All departments' : '—')}</td>
                    <td className="px-4 py-3">
                      {u.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>}
                      {!u.email_confirmed && <Badge tone="warning" className="ml-1">Invited</Badge>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : 'Never'}</td>
                    <td className="px-4 py-3">
                      <Dropdown>
                        <DropdownTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${u.email}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownContent>
                          <DropdownItem icon={<Pencil className="h-4 w-4" />} onSelect={() => setEditing(u)}>
                            Edit access
                          </DropdownItem>
                          <DropdownItem icon={<KeyRound className="h-4 w-4" />} onSelect={() => setPwUser(u)}>
                            Set temporary password
                          </DropdownItem>
                          <DropdownItem icon={<Mail className="h-4 w-4" />} onSelect={() => reset.mutate(u)}>
                            Send password reset email
                          </DropdownItem>
                          {u.id !== profile?.id && (
                            <DropdownItem icon={<Power className="h-4 w-4" />} onSelect={() => setToggle(u)} className={u.is_active ? 'text-danger' : ''}>
                              {u.is_active ? 'Deactivate' : 'Reactivate'}
                            </DropdownItem>
                          )}
                        </DropdownContent>
                      </Dropdown>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <EditAccessDialog user={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!toggle}
        onOpenChange={(o) => !o && setToggle(null)}
        title={toggle?.is_active ? 'Deactivate user?' : 'Reactivate user?'}
        description={
          toggle?.is_active
            ? `${toggle?.email} will be signed out and blocked from signing in. Their history is kept.`
            : `${toggle?.email} will be able to sign in again.`
        }
        confirmLabel={toggle?.is_active ? 'Deactivate' : 'Reactivate'}
        tone={toggle?.is_active ? 'danger' : 'primary'}
        loading={activeToggle.isPending}
        onConfirm={() => toggle && activeToggle.mutate(toggle)}
      />
      <Modal
        open={!!pwUser}
        onOpenChange={(o) => !o && setPwUser(null)}
        title="Set temporary password"
        description={pwUser?.email}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPwUser(null)}>
              Cancel
            </Button>
            <Button onClick={() => setPassword.mutate()} loading={setPassword.isPending}>
              Set password
            </Button>
          </>
        }
      >
        <Field label="New temporary password" htmlFor="tmp-pw" hint="At least 10 characters with letters and numbers.">
          <Input id="tmp-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
