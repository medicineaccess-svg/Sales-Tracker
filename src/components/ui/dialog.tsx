import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 'center' = modal dialog, 'right' = slide-over drawer */
  variant?: 'center' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

export function Modal({ open, onOpenChange, title, description, children, footer, variant = 'center', size = 'md' }: ModalProps) {
  const reduce = useReducedMotion();
  const panelMotion =
    variant === 'right'
      ? { initial: { x: reduce ? 0 : 48, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: reduce ? 0 : 48, opacity: 0 } }
      : {
          initial: { y: reduce ? 0 : 12, scale: reduce ? 1 : 0.98, opacity: 0 },
          animate: { y: 0, scale: 1, opacity: 1 },
          exit: { y: reduce ? 0 : 8, scale: reduce ? 1 : 0.98, opacity: 0 },
        };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-navy-900/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount>
              <motion.div
                {...panelMotion}
                transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                className={cn(
                  'fixed z-50 flex flex-col bg-white shadow-lift focus:outline-none',
                  variant === 'right'
                    ? cn('inset-y-0 right-0 w-full', widths[size])
                    : cn('left-1/2 top-1/2 max-h-[92vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl', widths[size]),
                )}
              >
                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                  <div className="min-w-0">
                    <RadixDialog.Title className="text-base font-semibold text-navy">{title}</RadixDialog.Title>
                    {description ? (
                      <RadixDialog.Description className="mt-0.5 text-sm text-muted">{description}</RadixDialog.Description>
                    ) : (
                      <RadixDialog.Description className="sr-only">Dialog</RadixDialog.Description>
                    )}
                  </div>
                  <RadixDialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="Close">
                      <X className="h-4 w-4" />
                    </Button>
                  </RadixDialog.Close>
                </div>
                <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink/80">{description}</div>
    </Modal>
  );
}
