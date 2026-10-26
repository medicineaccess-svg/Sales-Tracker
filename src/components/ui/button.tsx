import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ' +
    'transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out ' +
    'hover:-translate-y-px active:translate-y-0 active:scale-[0.97] ' +
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand motion-reduce:transform-none',
  {
    variants: {
      variant: {
        // Brand orange with dark ink text (8.9:1 contrast)
        primary: 'bg-accent text-accent-ink shadow-sm hover:bg-accent-600 hover:shadow-accent',
        secondary: 'bg-brand text-white shadow-sm hover:bg-sidebar-600 hover:shadow-lift',
        outline: 'border border-line bg-card text-ink shadow-sm hover:border-accent/60 hover:bg-accent-50',
        ghost: 'text-ink hover:bg-accent-50',
        danger: 'bg-danger text-white shadow-sm hover:brightness-110',
        link: 'px-0 text-brand underline-offset-4 hover:translate-y-0 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4',
        lg: 'h-11 px-5 text-base',
        icon: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  /** Briefly show a success state (e.g. after a save completes). */
  success?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, success, disabled, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), success && 'bg-success text-white', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {success && !loading && <Check className="h-4 w-4" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
