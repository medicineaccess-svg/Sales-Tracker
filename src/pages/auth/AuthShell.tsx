import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BarChart3, ShieldCheck, Workflow } from 'lucide-react';
import { Logo } from '@/components/ui/logo';

/** Split-screen brand layout shared by the login and password pages. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-navy via-navy-700 to-brand lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Subtle animated background shapes */}
        {!reduce && (
          <>
            <motion.div
              className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-white/5"
              animate={{ y: [0, 24, 0], x: [0, 12, 0] }}
              transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute -bottom-32 right-[-80px] h-[28rem] w-[28rem] rounded-full bg-white/[0.04]"
              animate={{ y: [0, -20, 0] }}
              transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute right-24 top-40 h-40 w-40 rotate-12 rounded-3xl border border-white/10"
              animate={{ rotate: [12, 20, 12] }}
              transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
            />
          </>
        )}
        <Logo variant="light" className="relative h-11" />
        <div className="relative max-w-md text-white">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Sales intelligence for every department.</h1>
          <p className="mt-3 text-white/70">
            Track Named Patient Program sales, reconcile with Google Sheets, and report with confidence — securely.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/85">
            {[
              { icon: BarChart3, text: 'Live dashboards built on the permanent sales database' },
              { icon: Workflow, text: 'Idempotent Google Sheets synchronisation with audit history' },
              { icon: ShieldCheck, text: 'Department-level access enforced by the database' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">© {new Date().getFullYear()} Ikris Pharma Network</p>
      </div>
      <div className="flex items-center justify-center bg-canvas px-4 py-10 sm:px-8">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 lg:hidden">
            <Logo className="h-10" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-navy">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </motion.div>
      </div>
    </div>
  );
}
