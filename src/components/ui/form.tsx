import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 ' +
  'transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 ' +
  'disabled:cursor-not-allowed disabled:bg-canvas aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...props} />
));
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2', className)} {...props} />,
);
Textarea.displayName = 'Textarea';

export function Label({ htmlFor, children, required }: { htmlFor?: string; children: ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink/80">
      {children}
      {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
    </label>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
