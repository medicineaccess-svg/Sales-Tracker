import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { friendlyError, notify } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { AuthShell } from './AuthShell';

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: z.string().trim().email('Enter a valid email address') })),
  });

  const onSubmit = async ({ email }: { email: string }) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Always show the same message so account existence is not revealed
    if (error && !/rate limit/i.test(error.message)) console.warn('reset request failed');
    if (error && /rate limit/i.test(error.message)) {
      notify.warning(friendlyError(error));
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a secure link to choose a new password.">
      {sent ? (
        <div className="rounded-xl border border-line bg-card p-5 text-sm">
          <MailCheck className="mb-2 h-6 w-6 text-success" aria-hidden />
          If an account exists for that address, a reset link is on its way. The link expires after a short time.
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} aria-invalid={!!formState.errors.email} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to sign in
      </Link>
    </AuthShell>
  );
}

const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });

  useEffect(() => {
    // The recovery link signs the user in with a short-lived session (PKCE code in the URL)
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => s.session && setReady(true));
    return () => data.subscription.unsubscribe();
  }, []);

  const onSubmit = async ({ password }: { password: string }) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      notify.error(friendlyError(error, 'Could not update the password. Request a new link.'));
      return;
    }
    void supabase.rpc('log_client_event', { p_action: 'auth.password_changed' });
    notify.success('Password updated. You are now signed in.');
    navigate('/', { replace: true });
  };

  return (
    <AuthShell title="Choose a new password" subtitle="At least 10 characters, including letters and numbers.">
      {!ready ? (
        <p className="text-sm text-muted">
          Validating your reset link… If nothing happens, the link may have expired —{' '}
          <Link to="/forgot-password" className="font-medium text-brand hover:underline">
            request a new one
          </Link>
          .
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="New password" htmlFor="password" error={formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={formState.errors.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
