import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { useAuditLogs } from '@/hooks/useData';
import { friendlyError } from '@/lib/errors';
import { formatDateTime, formatNumber } from '@/lib/format';

const ACTION_GROUPS = [
  { value: '', label: 'All activity' },
  { value: 'sales', label: 'Sales records' },
  { value: 'sync', label: 'Google Sheets sync' },
  { value: 'auth', label: 'Sign-in / sign-out' },
  { value: 'user', label: 'User management' },
  { value: 'department', label: 'Department configuration' },
  { value: 'settings', label: 'Settings' },
  { value: 'report', label: 'Report exports' },
];

const tone = (action: string) =>
  action.includes('failed') || action.includes('conflict') || action.includes('archived')
    ? 'warning'
    : action.startsWith('user') || action.startsWith('settings') || action.startsWith('department')
      ? 'brand'
      : 'neutral';

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const action = params.get('action') ?? '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const pageSize = 50;
  const { data, isLoading, isError, error, refetch } = useAuditLogs({ page, pageSize, action: action || undefined, from: from || undefined, to: to || undefined });
  useEffect(() => setPage(0), [action, from, to]);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="An append-only record of sign-ins, data changes, imports, exports and administrative actions. Entries cannot be edited or deleted. Patient names are never written to the log."
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <label className="w-56">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Activity</span>
            <Select
              value={action}
              onChange={(e) => {
                const p = new URLSearchParams(params);
                if (e.target.value) p.set('action', e.target.value);
                else p.delete('action');
                setParams(p, { replace: true });
              }}
              className="h-9 text-xs"
            >
              {ACTION_GROUPS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">From</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">To</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" />
          </label>
          <span className="ml-auto text-xs text-muted">{data ? `${formatNumber(data.total)} entries` : ''}</span>
        </div>

        {isError ? (
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="w-8 px-3" />
                  <th className="px-3 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Actor</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 font-medium">Summary</th>
                  <th className="px-3 py-2.5 font-medium">Dept.</th>
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-3 py-2">
                        <Skeleton className="h-5" />
                      </td>
                    </tr>
                  ))}
                {data?.rows.map((l) => {
                  const hasDetail = !!l.changes || Object.keys(l.metadata ?? {}).length > 0;
                  const isOpen = open === l.id;
                  return (
                    <Fragment key={l.id}>
                      <tr className="border-b border-line/60">
                        <td className="px-3">
                          {hasDetail && (
                            <button type="button" onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen} aria-label="Show details" className="rounded p-1 text-muted hover:bg-brand-50">
                              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDateTime(l.occurred_at)}</td>
                        <td className="px-3 py-2.5 text-xs">{l.actor_email ?? (l.actor_type === 'system' ? 'System' : '—')}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={tone(l.action)}>{l.action}</Badge>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{l.summary}</td>
                        <td className="px-3 py-2.5 text-xs uppercase text-muted">{l.department_code ?? '—'}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line/60 bg-canvas/40">
                          <td />
                          <td colSpan={5} className="px-3 py-3">
                            <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-card p-3 text-[11px] text-ink/80">
                              {JSON.stringify({ changes: l.changes ?? undefined, metadata: l.metadata, entity: l.entity_type ? `${l.entity_type}:${l.entity_id}` : undefined }, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {data && !data.rows.length && <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No audit entries for this view" />}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3 text-xs text-muted">
          Page {page + 1} of {totalPages}
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </Card>
    </div>
  );
}
