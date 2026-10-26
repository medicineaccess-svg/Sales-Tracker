import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { notify } from '@/lib/errors';
import { supabaseConfigured } from '@/lib/supabase';
import { AuthShell } from './AuthShell';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const { session, profile, signIn, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const from = (location.state as { from?: string } | null)?.from;
  if (session && profile) return <Navigate to={from ?? (isAdmin ? '/overview' : '/dashboard')} replace />;

  const onSubmit = async (v: Values) => {
    setFormError(null);
    const res = await signIn(v.email, v.password);
    if (!res.ok) {
      setFormError(res.message);
      notify.error('Sign-in failed');
      return;
    }
    notify.success('Signed in successfully');
    navigate(from ?? '/', { replace: true });
  };

  return (
    <AuthShell title="Sign in" subtitle="Use the account provided by your administrator.">
      {!supabaseConfigured && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-[#6b3f0a]">
          The application is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" aria-invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <div className="relative">
            <Input
              id="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              className="pr-10"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {!isSubmitting && <LogIn className="h-4 w-4" />} Sign in
        </Button>
        <div className="text-center">
          <Link to="/forgot-password" className="text-sm font-medium text-brand hover:underline">
            Forgot your password?
          </Link>
        </div>
      </form>
      <p className="mt-10 text-center text-xs text-muted">
        Accounts are created by an administrator. Self-registration is disabled.
      </p>
    </AuthShell>
  );
}
