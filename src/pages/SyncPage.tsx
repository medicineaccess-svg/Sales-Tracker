import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, CircleAlert, ExternalLink, Eye, FileSpreadsheet, Info, Loader2, RefreshCw, Upload, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { SalesDetailDrawer } from '@/components/sales/SalesDetailDrawer';
import { useDepartments, useSyncRuns } from '@/hooks/useData';
import { edgeFunctionError, friendlyError, notify } from '@/lib/errors';
import { formatDate, formatDateTime, formatNumber, relativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { parseCsv } from '@/lib/csv';
import type { NppSale, SyncRun } from '@/types/database';

const statusTone: Record<SyncRun['status'], 'success' | 'warning' | 'danger' | 'brand'> = {
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
  running: 'brand',
};

interface Reconciliation {
  sheet_inr_total: string;
  database_inr_total: string;
  sheet_rows: number;
  database_rows: number;
  matches: boolean;
  note: string | null;
}

interface DryRun {
  rows_read: number;
  valid: number;
  skipped: number;
  invalid: { row: number; reason: string }[];
  flagged: number;
}

export function SyncPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const runs = useSyncRuns(25);
  const { data: depts } = useDepartments();
  const npp = depts?.find((d) => d.code === 'npp');
  const cfg = (npp?.config ?? {}) as { spreadsheet_id?: string; sheet_gid?: number; sync_policy?: string };
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);

  const attention = useQuery({
    queryKey: ['npp', 'sync-attention'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('npp_sales')
        .select('id, voucher_no, product_name, sale_date, pending_source, missing_from_source_at')
        .or('pending_source.not.is.null,missing_from_source_at.not.is.null')
        .eq('status', 'active')
        .order('sale_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Pick<NppSale, 'id' | 'voucher_no' | 'product_name' | 'sale_date' | 'pending_source' | 'missing_from_source_at'>[];
    },
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; values: string[][] } | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);

  const invoke = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const body: Record<string, unknown> = { dry_run: dryRun };
      if (upload) {
        body.values = upload.values;
        body.file_name = upload.name;
      }
      const { data, error } = await supabase.functions.invoke('sheets-sync', { body });
      if (error) throw new Error(await edgeFunctionError(error));
      return { dryRun, data };
    },
    onMutate: (dryRun) => {
      setNotConfigured(null);
      if (!dryRun) notify.info(upload ? `Importing ${upload.name}` : 'Google Sheets synchronisation started');
    },
    onSuccess: async ({ dryRun, data }) => {
      if (dryRun) {
        setPreview(data as DryRun);
        return;
      }
      const run = (data as { run: SyncRun }).run;
      setReconciliation((data as { reconciliation?: Reconciliation }).reconciliation ?? null);
      setUpload(null);
      if (run.status === 'succeeded') {
        notify.success(
          `Sync completed: ${run.inserted} new, ${run.updated} updated, ${run.unchanged} unchanged${run.adopted ? `, ${run.adopted} carried over from the previous sheet` : ''}`,
        );
      } else if (run.status === 'partial') {
        notify.warning(`Sync partially completed: ${run.invalid} row(s) could not be imported`);
      }
      if (run.conflicts) notify.warning(`${run.conflicts} record(s) changed in the sheet after CRM edits — review conflicts below`);
      await qc.invalidateQueries();
    },
    onError: async (e) => {
      const msg = (e as Error).message || friendlyError(e);
      if (/not configured/i.test(msg)) setNotConfigured(msg);
      notify.error(`Synchronisation failed: ${msg}`);
      await qc.invalidateQueries({ queryKey: ['sync-runs'] });
    },
  });

  const running = invoke.isPending || runs.data?.some((r) => r.status === 'running');
  const lastOk = runs.data?.find((r) => r.status === 'succeeded' || r.status === 'partial');
  const sheetUrl = cfg.spreadsheet_id
    ? `https://docs.google.com/spreadsheets/d/${cfg.spreadsheet_id}/edit${cfg.sheet_gid ? `#gid=${cfg.sheet_gid}` : ''}`
    : null;

  return (
    <div>
      <PageHeader
        title="Google Sheets Sync"
        description="The NPP Google Sheet is the source for imported records; the CRM database is the permanent store. Re-running a sync never creates duplicates."
        actions={
          isAdmin && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="Upload the sheet exported as CSV"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  if (f.size > 5 * 1024 * 1024) return notify.error('CSV is larger than 5 MB.');
                  try {
                    const values = parseCsv(await f.text());
                    if (values.length < 2) return notify.error('The CSV has no data rows.');
                    setUpload({ name: f.name, values });
                    setPreview(null);
                    notify.info(`${f.name}: ${values.length - 1} row(s) ready. Preview or import it.`);
                  } catch {
                    notify.error('Could not read that file as CSV.');
                  }
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={running}>
                <Upload className="h-4 w-4" /> Upload CSV
              </Button>
              <Button variant="outline" onClick={() => invoke.mutate(true)} disabled={running} loading={invoke.isPending && invoke.variables === true}>
                {!(invoke.isPending && invoke.variables) && <Eye className="h-4 w-4" />} Preview
              </Button>
              <Button onClick={() => invoke.mutate(false)} disabled={running} loading={invoke.isPending && invoke.variables === false}>
                {!(invoke.isPending && invoke.variables === false) && <RefreshCw className="h-4 w-4" />} {upload ? 'Import uploaded CSV' : 'Import from Google Sheets'}
              </Button>
            </>
          )
        }
      />

      <AnimatePresence>
        {running && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 overflow-hidden rounded-xl border border-brand-100 bg-brand-50"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3 px-4 py-3 text-sm text-navy">
              <Loader2 className="h-4 w-4 animate-spin" /> Synchronisation in progress — reading the sheet, validating rows and saving changes in batches…
            </div>
            <div className="h-1 overflow-hidden bg-brand-100">
              <motion.div className="h-full w-1/3 bg-brand" animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {upload && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-navy" role="status">
          <span>
            <strong>{upload.name}</strong> — {upload.values.length - 1} row(s) loaded. Preview and Import now use this file instead of reading Google Sheets. The
            sheet itself is never modified.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setUpload(null)}>
            Use Google Sheets instead
          </Button>
        </div>
      )}

      {reconciliation && (
        <div
          role="status"
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${reconciliation.matches ? 'border-emerald-200 bg-emerald-50 text-success' : 'border-amber-200 bg-amber-50 text-[#6b3f0a]'}`}
        >
          {reconciliation.matches ? <CheckCircle2 className="mr-1 inline h-4 w-4" /> : <CircleAlert className="mr-1 inline h-4 w-4" />}
          Reconciliation: sheet {formatNumber(reconciliation.sheet_rows)} rows / ₹{formatNumber(Number(reconciliation.sheet_inr_total), 2)} · database{' '}
          {formatNumber(reconciliation.database_rows)} rows / ₹{formatNumber(Number(reconciliation.database_inr_total), 2)}
          {reconciliation.matches ? ' — totals match.' : ' — totals differ.'} {reconciliation.note}
        </div>
      )}

      {notConfigured && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-[#6b3f0a]">
          <p className="font-medium">Google Sheets access is not configured yet</p>
          <p className="mt-1 text-xs">
            Add a Google service-account key as the Edge Function secret <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> and share the sheet
            with the service account email as a Viewer. See <code>docs/GOOGLE_SHEETS_SYNC.md</code>. Until then, download the sheet as CSV
            (File → Download → Comma-separated values) and use <strong>Upload CSV</strong>. Previously imported data remains available.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Source" description="Configured in Settings → Departments" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-success" />
              <span className="font-medium">NPP sales sheet</span>
            </div>
            <p className="break-all text-xs text-muted">Spreadsheet ID: {cfg.spreadsheet_id ?? 'not set'}</p>
            {sheetUrl && (
              <a href={sheetUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                Open in Google Sheets <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <div className="rounded-lg bg-canvas p-3 text-xs text-muted">
              <p className="mb-1 flex items-center gap-1 font-medium text-ink">
                <Info className="h-3.5 w-3.5" /> Sync policy
              </p>
              Sheet rows are matched by a stable key (voucher number when the sheet has one, otherwise date + customer + product + manager).
              Changed rows update the CRM unless the record was edited in the CRM — those are held as conflicts for an administrator. Columns
              the sheet does not carry are never blanked. Rows removed from the sheet are flagged, never deleted, and excluded from performance figures.
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Last successful sync" />
          <CardBody>
            {runs.isLoading ? (
              <Skeleton className="h-20" />
            ) : lastOk ? (
              <div className="space-y-1 text-sm">
                <p className="text-2xl font-semibold text-navy">{relativeTime(lastOk.finished_at)}</p>
                <p className="text-xs text-muted">{formatDateTime(lastOk.finished_at)}</p>
                <p className="pt-2 text-xs text-muted">
                  {formatNumber(lastOk.rows_read)} rows read · {lastOk.inserted} inserted · {lastOk.updated} updated · {lastOk.unchanged} unchanged ·{' '}
                  {lastOk.adopted ? `${lastOk.adopted} carried over · ` : ''}
                  {lastOk.flagged} flagged · {lastOk.trigger === 'upload' ? 'from an uploaded snapshot' : `trigger: ${lastOk.trigger}`}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">No completed sync yet.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Needs attention" description="Conflicts and records missing from the sheet" />
          <CardBody className="text-sm">
            {attention.isLoading ? (
              <Skeleton className="h-20" />
            ) : !attention.data?.length ? (
              <p className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" /> Nothing to resolve
              </p>
            ) : (
              <ul className="scroll-thin max-h-40 space-y-1 overflow-y-auto">
                {attention.data.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-brand-50" onClick={() => setOpenRecord(r.id)}>
                      <span className="truncate">
                        {r.voucher_no ?? '—'} · {r.product_name}
                      </span>
                      {r.pending_source ? <Badge tone="danger">Conflict</Badge> : <Badge tone="warning">Missing</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {preview && (
        <Card className="mt-4">
          <CardHeader title="Preview (no changes saved)" actions={<Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Dismiss</Button>} />
          <CardBody className="text-sm">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ['Rows read', preview.rows_read],
                ['Valid sales rows', preview.valid],
                ['Subtotal rows skipped', preview.skipped],
                ['Rows with data flags', preview.flagged],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-canvas p-3">
                  <p className="text-xs text-muted">{k}</p>
                  <p className="text-lg font-semibold text-navy">{formatNumber(v as number)}</p>
                </div>
              ))}
            </div>
            {preview.invalid.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-danger">
                {preview.invalid.map((i) => (
                  <li key={i.row}>
                    Row {i.row}: {i.reason}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="Synchronisation history" description="Every import attempt, including failures" />
        {runs.isError ? (
          <ErrorState message={friendlyError(runs.error)} onRetry={() => runs.refetch()} />
        ) : runs.data && runs.data.length === 0 ? (
          <EmptyState title="No synchronisations yet" />
        ) : (
          <div className="scroll-thin mt-3 overflow-x-auto">
            <table className="data-table w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-y border-line bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
                  {['Started', 'Trigger', 'Status', 'Read', 'Inserted', 'Updated', 'Unchanged', 'Conflicts', 'Flagged', 'Invalid', 'Missing'].map((h, i) => (
                    <th key={h} className={`px-4 py-2.5 font-medium ${i > 2 ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.isLoading &&
                  [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={11} className="px-4 py-2">
                        <Skeleton className="h-5" />
                      </td>
                    </tr>
                  ))}
                {runs.data?.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 align-top">
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {formatDateTime(r.started_at)}
                      {(r.notes || r.errors.length > 0) && (
                        <details className="mt-1 text-xs text-muted">
                          <summary className="cursor-pointer">Details</summary>
                          {r.notes && <p className="mt-1 text-danger">{r.notes}</p>}
                          <ul className="mt-1 space-y-0.5">
                            {r.errors.slice(0, 20).map((e, i) => (
                              <li key={i}>
                                {e.row ? `Row ${e.row}: ` : ''}
                                {e.reason}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-2.5 capitalize">{r.trigger}</td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={statusTone[r.status]}
                        icon={r.status === 'succeeded' ? <CheckCircle2 className="h-3 w-3" /> : r.status === 'failed' ? <XCircle className="h-3 w-3" /> : r.status === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleAlert className="h-3 w-3" />}
                      >
                        {r.status}
                      </Badge>
                    </td>
                    {[r.rows_read, r.inserted, r.updated, r.unchanged, r.conflicts, r.flagged, r.invalid, r.missing_from_source].map((v, i) => (
                      <td key={i} className="tabular px-4 py-2.5 text-right">
                        {formatNumber(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-5 py-3 text-xs text-muted">
          Flagged rows were imported but have data-quality issues (e.g. missing date, currency or shifted columns).{' '}
          <Link to="/sales?needs_review=true" className="font-medium text-brand hover:underline">
            Review flagged records
          </Link>
          {lastOk ? ` · Data as of ${formatDate(lastOk.finished_at)}` : ''}
        </p>
      </Card>

      <SalesDetailDrawer id={openRecord} onClose={() => setOpenRecord(null)} />
    </div>
  );
}
