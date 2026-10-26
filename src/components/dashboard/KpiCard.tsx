import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/feedback';

/** Counts up from the previous value to `value` using real data; static when reduced motion is on. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const prev = useRef(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  // Screen readers get the final value only, not every frame.
  return (
    <>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

/** KPI tile with a subtle 3D tilt on hover (disabled for reduced-motion users). */
export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  loading,
  index = 0,
  className,
  numeric,
  format,
  highlight,
}: {
  label: string;
  value?: ReactNode;
  /** When provided with `format`, the value animates as a counter. */
  numeric?: number | null;
  format?: (n: number) => string;
  /** Emphasise this tile with the brand orange. */
  highlight?: boolean;
  sub?: ReactNode;
  icon: LucideIcon;
  loading?: boolean;
  index?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [4, -4]), { stiffness: 250, damping: 20 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-5, 5]), { stiffness: 250, damping: 20 });

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      style={reduce ? undefined : { rotateX, rotateY, transformPerspective: 900 }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-card p-5 shadow-card transition-shadow duration-300 hover:shadow-lift',
        highlight ? 'border-accent/40' : 'border-line/70',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-accent-100 to-transparent opacity-80" />
      <div
        className={cn(
          'pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full transition-transform duration-500 group-hover:scale-125',
          highlight ? 'bg-accent-50' : 'bg-brand-50',
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110',
            highlight ? 'bg-accent text-accent-ink' : 'bg-sidebar text-white',
          )}
        >
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
      </div>
      <div className="relative mt-2">
        {loading ? (
          <>
            <Skeleton className="h-7 w-32" />
            <Skeleton className="mt-2 h-3.5 w-40" />
          </>
        ) : (
          <>
            <div className="tabular text-2xl font-bold tracking-tight text-navy">
              {numeric != null && format ? <AnimatedNumber value={numeric} format={format} /> : (value ?? '—')}
            </div>
            {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
          </>
        )}
      </div>
    </motion.div>
  );
}
