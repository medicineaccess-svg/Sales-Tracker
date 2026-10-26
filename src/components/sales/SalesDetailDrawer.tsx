import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, FileSpreadsheet, History, Pencil, TriangleAlert } from 'lucide-react';
import { Modal, ConfirmDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { useAuth } from '@/auth/AuthProvider';
import { useAuditLogs, useSale } from '@/hooks/useData';
import { friendlyError, notify } from '@/lib/errors';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { DATA_ISSUE_LABELS, type DataIssue } from '@shared/npp-parser';
import type { NppSale } from '@/types/database';
import { SalesFormDialog } from './SalesFormDialog';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-line/60 py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular min-w-0 break-words text-ink">{children ?? '—'}</dd>
    </div>
  );
}

const dc = (amount: unknown, side: string | null, cur: NppSale['currency']) =>
  amount === null || amount === undefined ? '—' : `${formatMoney(amount as number, cur ?? 'UNSPECIFIED')}${side ? ` ${side}` : ''}`;

export function SalesDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data: r, isLoading } = useSale(id);
  const { data: history } = useAuditLogs({ page: 0, pageSize: 50, entityId: id ?? '__none__' });
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['npp'] });
    await qc.invalidateQueries({ queryKey: ['audit'] });
  };

  const archive = useMutation({
    mutationFn: async (status: 'active' | 'archived') => {
      const { error } = await supabase.from('npp_sales').update({ status }).eq('id', id!);
      if (error) throw error;
      return status;
    },
    onSuccess: async (status) => {
      notify.success(status === 'archived' ? 'Sales record archived' : 'Sales record restored');
      setConfirmArchive(false);
      await invalidate();
    },
    onError: (e) => notify.error(friendlyError(e, 'Could not change the record status.')),
  });

  const resolve = useMutation({
    mutationFn: async (resolution: 'accept_source' | 'keep_crm') => {
      const { error } = await supabase.rpc('npp_resolve_conflict', { p_id: id, p_resolution: resolution });
      if (error) throw error;
    },
    onSuccess: async () => {
      notify.success('Sync conflict resolved');
      await invalidate();
    },
    onError: (e) => notify.error(friendlyError(e)),
  });

  const cur = r?.currency ?? 'UNSPECIFIED';
  const issues = (r?.data_issues ?? []) as DataIssue[];

  return (
    <>
      <Modal
        open={!!id}
        onOpenChange={(o) => !o && onClose()}
        variant="right"
        size="lg"
        title={r ? `Voucher ${r.voucher_no ?? '—'}` : 'Sales record'}
        description={r ? `${r.product_name} · ${formatDate(r.sale_date)}` : undefined}
        footer={
          r && (
            <>
              {isAdmin &&
                (r.status === 'active' ? (
                  <Button variant="outline" onClick={() => setConfirmArchive(true)}>
                    <Archive className="h-4 w-4" /> Archive
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => archive.mutate('active')} loading={archive.isPending}>
                    <ArchiveRestore className="h-4 w-4" /> Restore
                  </Button>
                ))}
              {r.status === 'active' && (
                <Button onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              )}
            </>
          )
        }
      >
        {isLoading || !r ? (
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge tone={r.source === 'google_sheets' ? 'brand' : 'neutral'} icon={<FileSpreadsheet className="h-3 w-3" />}>
                {r.source === 'google_sheets' ? `Google Sheets · row ${r.source_row_number ?? '—'}` : 'Entered in CRM'}
              </Badge>
              {r.status === 'archived' && <Badge tone="danger">Archived</Badge>}
              {r.locally_modified && <Badge tone="warning">Edited in CRM</Badge>}
              {r.missing_from_source_at && <Badge tone="warning">No longer in sheet</Badge>}
              {r.needs_review && <Badge tone="warning">Needs review</Badge>}
            </div>

            {r.pending_source && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium text-danger">
                  <TriangleAlert className="h-4 w-4" /> Sync conflict
                </p>
                <p className="mt-1 text-xs text-ink/80">
                  The Google Sheet changed this record after it was edited in the CRM. The sheet version has been held back.
                </p>
                {isAdmin ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => resolve.mutate('keep_crm')} loading={resolve.isPending}>
                      Keep CRM version
                    </Button>
                    <Button size="sm" onClick={() => resolve.mutate('accept_source')} loading={resolve.isPending}>
                      Accept sheet version
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted">An administrator needs to resolve this conflict.</p>
                )}
              </div>
            )}

            {issues.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="mb-1 text-sm font-medium text-[#7a4a0d]">Data-quality flags</p>
                <ul className="ml-5 list-disc text-xs text-[#7a4a0d]">
                  {issues.map((i) => (
                    <li key={i}>{DATA_ISSUE_LABELS[i] ?? i}</li>
                  ))}
                </ul>
              </div>
            )}

            <dl>
              <Row label="Date">{formatDate(r.sale_date)}</Row>
              <Row label="Particulars">{r.particulars}</Row>
              <Row label="Product">{r.product_name}</Row>
              <Row label="Place of sale">{r.place_of_sale}</Row>
              <Row label="Manager">{r.manager}</Row>
              <Row label="Doctor">{r.doctor_name}</Row>
              <Row label="Hospital">{r.hospital_name}</Row>
              <Row label="Voucher no.">{r.voucher_no}</Row>
              <Row label="Quantity">{r.quantity !== null ? `${formatNumber(r.quantity, 3)} ${r.quantity_unit ?? ''}` : '—'}</Row>
              <Row label="Rate">{r.rate !== null ? `${formatMoney(r.rate, cur)}${r.rate_unit ? ` / ${r.rate_unit}` : ''}` : '—'}</Row>
              <Row label="Value">{formatMoney(r.value, cur)}</Row>
              <Row label="Gross total">{dc(r.gross_total, r.gross_total_dc, r.currency)}</Row>
              <Row label="Export sales">{dc(r.export_sales, r.export_sales_dc, r.currency)}</Row>
              <Row label="Shipping charges">{dc(r.shipping_charges, r.shipping_charges_dc, r.currency)}</Row>
              <Row label="INR value">{formatMoney(r.inr_value, 'INR')}</Row>
              {r.remarks && <Row label="Remarks">{r.remarks}</Row>}
              <Row label="Created">{formatDateTime(r.created_at)}</Row>
              <Row label="Last updated">{formatDateTime(r.updated_at)}</Row>
              {r.last_synced_at && <Row label="Last synced">{formatDateTime(r.last_synced_at)}</Row>}
            </dl>

            {r.source_raw && (
              <details className="rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium text-navy">Original sheet values</summary>
                <dl className="mt-3">
                  {Object.entries(r.source_raw).map(([k, v]) => (
                    <Row key={k} label={k}>
                      <code className="text-xs">{v === '' ? '(blank)' : v}</code>
                    </Row>
                  ))}
                </dl>
              </details>
            )}

            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy">
                <History className="h-4 w-4" /> Audit history
              </h4>
              {!history?.rows.length ? (
                <p className="text-xs text-muted">No changes recorded since import.</p>
              ) : (
                <ol className="space-y-3 border-l border-line pl-4">
                  {history.rows.map((h) => (
                    <li key={h.id} className="text-xs">
                      <p className="font-medium text-ink">{h.summary ?? h.action}</p>
                      <p className="text-muted">
                        {formatDateTime(h.occurred_at)} · {h.actor_email ?? (h.actor_type === 'system' ? 'System sync' : 'Unknown')}
                      </p>
                      {h.changes && (
                        <ul className="mt-1 space-y-0.5 text-muted">
                          {Object.entries(h.changes).map(([field, c]) => (
                            <li key={field}>
                              <span className="font-medium text-ink/80">{field}</span>:{' '}
                              {c.changed ? 'changed' : `${JSON.stringify(c.old)} → ${JSON.stringify(c.new)}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>

      <SalesFormDialog open={editing} onOpenChange={setEditing} record={r} />
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="Archive this sales record?"
        description="Archived records are hidden from dashboards and reports but remain in the database and audit trail. You can restore them later."
        confirmLabel="Archive record"
        loading={archive.isPending}
        onConfirm={() => archive.mutate('archived')}
      />
    </>
  );
}
