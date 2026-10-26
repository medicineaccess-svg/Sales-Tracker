import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dropdown = DM.Root;
export const DropdownTrigger = DM.Trigger;

export function DropdownContent({
  className,
  align = 'end',
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-48 rounded-xl border border-line bg-card p-1.5 shadow-lift',
          'data-[state=open]:animate-[fadeIn_120ms_ease-out]',
          className,
        )}
        {...props}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function DropdownItem({
  className,
  icon,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DM.Item> & { icon?: ReactNode }) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink outline-none',
        'data-[highlighted]:bg-brand-50 data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      {icon && <span className="text-muted">{icon}</span>}
      {children}
    </DM.Item>
  );
}

export function DropdownCheckItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DM.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-brand-50"
    >
      <span className="flex h-4 w-4 items-center justify-center rounded border border-line">
        <DM.ItemIndicator>
          <Check className="h-3 w-3 text-brand" />
        </DM.ItemIndicator>
      </span>
      {children}
    </DM.CheckboxItem>
  );
}

export const DropdownSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;
export const DropdownLabel = ({ children }: { children: ReactNode }) => (
  <DM.Label className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</DM.Label>
);
