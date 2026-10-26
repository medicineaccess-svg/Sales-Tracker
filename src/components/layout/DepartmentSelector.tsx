import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Globe2, HeartPulse, Lock, Pill } from 'lucide-react';
import { Modal } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { useAuth } from '@/auth/AuthProvider';
import { useDepartments } from '@/hooks/useData';
import { cn } from '@/lib/utils';

const ICONS: Record<string, typeof Pill> = { npp: Pill, export: Globe2, rare_disease: HeartPulse };

export function DepartmentSelector({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading } = useDepartments();
  const { isAdmin, profile, departmentCode, setDepartmentCode } = useAuth();
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  const choose = (code: string, active: boolean, allowed: boolean) => {
    if (!allowed) return;
    setDepartmentCode(code);
    onOpenChange(false);
    navigate(active && code === 'npp' ? '/dashboard' : `/departments/${code}`);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Select department" description="Choose the department workspace to open." size="lg">
      <div className="grid gap-4 sm:grid-cols-3">
        {isLoading &&
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        {data?.map((d, i) => {
          const Icon = ICONS[d.code] ?? Pill;
          const active = d.status === 'active';
          const allowed = isAdmin || profile?.departments?.code === d.code;
          const current = departmentCode === d.code;
          return (
            <motion.button
              key={d.id}
              type="button"
              onClick={() => choose(d.code, active, allowed)}
              disabled={!allowed}
              initial={reduce ? false : { opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: i * 0.06, type: 'spring', stiffness: 320, damping: 26 }}
              whileHover={allowed && !reduce ? { y: -4, rotateX: 2, rotateY: -2 } : undefined}
              style={{ transformPerspective: 800 }}
              className={cn(
                'group relative flex h-full flex-col rounded-2xl border p-5 text-left transition-shadow',
                active ? 'border-brand/30 bg-gradient-to-br from-card to-brand-50 hover:border-accent/60 hover:shadow-lift' : 'border-line bg-surface/60',
                current && 'ring-2 ring-accent ring-offset-2 ring-offset-card',
                !allowed && 'cursor-not-allowed opacity-60',
              )}
              aria-label={`${d.name} — ${active ? 'Active' : 'Coming soon'}`}
            >
              <div className="mb-4 flex items-center justify-between">
                <span
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-xl',
                    active ? 'bg-sidebar text-white transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110' : 'bg-card text-muted',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                {current ? <Badge tone="accent">Current</Badge> : active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Coming soon</Badge>}
              </div>
              <p className="text-base font-semibold text-navy">{d.name}</p>
              <p className="mt-1 flex-1 text-sm text-muted">{d.description}</p>
              <span className={cn('mt-4 inline-flex items-center gap-1 text-xs font-semibold', active && allowed ? 'text-accent-700' : 'text-muted')}>
                {!allowed ? (
                  <>
                    <Lock className="h-3.5 w-3.5" aria-hidden /> No access
                  </>
                ) : active ? (
                  <>
                    Open workspace <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </>
                ) : (
                  <>View module status</>
                )}
              </span>
            </motion.button>
          );
        })}
      </div>
    </Modal>
  );
}
