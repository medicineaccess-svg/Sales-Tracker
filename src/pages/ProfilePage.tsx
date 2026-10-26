import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogOut, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { friendlyError, notify } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { passwordSchema } from './auth/PasswordPages';

const pwSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ProfilePage() {
  const { profile, session, isAdmin, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [saving, setSaving] = useState(false);
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });

  const saveName = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('update_my_profile', { p_full_name: name });
    setSaving(false);
    if (error) return notify.error(friendlyError(error));
    await refreshProfile();
    notify.success('Profile updated');
  };

  const changePassword = async ({ password }: { password: string }) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return notify.error(friendlyError(error, 'Could not change the password.'));
    void supabase.rpc('log_client_event', { p_action: 'auth.password_changed' });
    pw.reset({ password: '', confirm: '' });
    notify.success('Password changed');
  };

  return (
    <div>
      <PageHeader title="Profile" description="Your account details and security." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          <CardBody className="space-y-4">
            <Field label="Email" htmlFor="p-email">
              <Input id="p-email" value={profile?.email ?? ''} disabled />
            </Field>
            <Field label="Full name" htmlFor="p-name">
              <div className="flex gap-2">
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                <Button onClick={saveName} loading={saving} disabled={name === (profile?.full_name ?? '')}>
                  <Save className="h-4 w-4" /> Save
                </Button>
              </div>
            </Field>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-brand" />
              {isAdmin ? <Badge tone="brand">Administrator</Badge> : <Badge>Department user</Badge>}
              <Badge tone="neutral">{isAdmin ? 'All departments' : profile?.departments?.name}</Badge>
            </div>
            <p className="text-xs text-muted">
              Role and department are managed by an administrator and enforced by the database. Last sign-in:{' '}
              {formatDateTime(session?.user.last_sign_in_at)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" description="At least 10 characters, including letters and numbers." />
          <CardBody>
            <form className="space-y-4" noValidate onSubmit={pw.handleSubmit(changePassword)}>
              <Field label="New password" htmlFor="np" error={pw.formState.errors.password?.message}>
                <Input id="np" type="password" autoComplete="new-password" {...pw.register('password')} />
              </Field>
              <Field label="Confirm new password" htmlFor="npc" error={pw.formState.errors.confirm?.message}>
                <Input id="npc" type="password" autoComplete="new-password" {...pw.register('confirm')} />
              </Field>
              <Button type="submit" loading={pw.formState.isSubmitting}>
                Update password
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">Signing out clears all cached sales data from this browser.</p>
          <Button variant="outline" onClick={() => void signOut('manual')}>
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
