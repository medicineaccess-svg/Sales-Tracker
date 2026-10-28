// sheets-sync — imports the NPP / NPM sales sheet into public.npp_sales.
//
// POST body (all optional):
//   { "dry_run": true }                         parse and report only, nothing is written
//   { "values": string[][], "file_name": "…" }  admin upload of the sheet exported as CSV
//   { "upload_id": "<uuid>" }                   import a staged snapshot from npp_sheet_uploads
//                                               (rows there can only be written with the service role)
//
// Auth:
//   * live Google Sheets read  → an active admin's JWT, or header `x-sync-secret` (scheduled runs)
//   * values upload            → an active admin's JWT
//   * upload_id                → possession of an unexpired, unused staged upload id (single use)
//
// The sync is idempotent: rows are matched on a stable source key, unchanged rows are skipped by
// hash, locally edited rows are never overwritten (the sheet version is parked as a conflict),
// columns the current sheet layout does not carry are never blanked, and rows that disappear
// from the sheet are flagged rather than deleted. The source spreadsheet is only ever read.

import { corsHeaders, handleError, HttpError, json, requireAdmin, serviceClient } from '../_shared/http.ts';
import { readSheetValues, resolveSheetTitle, GoogleSheetsError } from '../_shared/google-sheets.ts';
import { parseNppSheet, SheetStructureError, type ParsedNppRow } from '../_shared/npp-parser.ts';

const BATCH_SIZE = 100;
const MAX_ROWS = 20000;
const MAX_COLS = 40;

type Totals = { inserted: number; updated: number; unchanged: number; conflicts: number; adopted: number };

async function applyWithRetry(db: ReturnType<typeof serviceClient>, runId: string, rows: ParsedNppRow[]) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.rpc('npp_sync_apply_v2', { p_run_id: runId, p_rows: rows });
    if (!error) return data as Totals;
    lastErr = error;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw lastErr;
}

/** Validates an uploaded 2-D array of cell strings. */
function validateValues(input: unknown): string[][] {
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, 'values', 'No rows were uploaded');
  if (input.length > MAX_ROWS) throw new HttpError(413, 'values', `Too many rows (max ${MAX_ROWS})`);
  return input.map((row, i) => {
    if (!Array.isArray(row)) throw new HttpError(400, 'values', `Row ${i + 1} is not a list of cells`);
    if (row.length > MAX_COLS) throw new HttpError(400, 'values', `Row ${i + 1} has too many columns`);
    return row.map((c) => (c == null ? '' : String(c).slice(0, 500)));
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: { code: 'method', message: 'POST only' } }, 405);

  const db = serviceClient();
  let runId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    // ---- Configuration -------------------------------------------------
    const { data: dept, error: deptErr } = await db
      .from('departments')
      .select('status, config')
      .eq('code', 'npp')
      .single();
    if (deptErr || !dept) throw new HttpError(500, 'config', 'NPP department configuration is missing');
    if (dept.status !== 'active') throw new HttpError(409, 'inactive', 'The NPP department is not active');
    const cfg = dept.config as { spreadsheet_id?: string; sheet_gid?: number; sheet_title?: string };
    if (!cfg.spreadsheet_id) throw new HttpError(500, 'config', 'No spreadsheet is configured for NPP');

    // ---- Authorisation & source -----------------------------------------
    let trigger: 'manual' | 'scheduled' | 'upload' = 'manual';
    let initiatedBy: string | null = null;
    let values: string[][] | null = null;
    let range = 'upload';
    let uploadId: string | null = null;

    if (typeof body?.upload_id === 'string') {
      const { data: up, error } = await db.rpc('npp_consume_upload', { p_id: body.upload_id });
      if (error || !up) throw new HttpError(404, 'upload', 'Upload not found, expired or already used');
      if (up.spreadsheet_id && up.spreadsheet_id !== cfg.spreadsheet_id) {
        throw new HttpError(409, 'upload', 'The staged upload belongs to a different spreadsheet than the one configured');
      }
      values = validateValues(up.values);
      trigger = 'upload';
      initiatedBy = up.created_by ?? null;
      uploadId = up.id;
      range = `snapshot:${up.id}`;
    } else if (Array.isArray(body?.values)) {
      const caller = await requireAdmin(req, db);
      initiatedBy = caller.user.id;
      values = validateValues(body.values);
      trigger = 'upload';
      if (!dryRun) {
        const { data: up, error } = await db
          .from('npp_sheet_uploads')
          .insert({
            created_by: initiatedBy,
            origin: 'csv_upload',
            spreadsheet_id: cfg.spreadsheet_id,
            sheet_gid: cfg.sheet_gid != null ? String(cfg.sheet_gid) : null,
            file_name: typeof body.file_name === 'string' ? body.file_name.slice(0, 200) : null,
            values,
            consumed_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (error) throw error;
        uploadId = up.id;
        range = `csv:${up.id}`;
      }
    } else {
      const cronSecret = Deno.env.get('SYNC_CRON_SECRET');
      const providedSecret = req.headers.get('x-sync-secret');
      if (cronSecret && providedSecret) {
        if (providedSecret !== cronSecret) throw new HttpError(401, 'bad_secret', 'Invalid sync secret');
        trigger = 'scheduled';
      } else {
        const caller = await requireAdmin(req, db);
        initiatedBy = caller.user.id;
      }
    }

    if (!values) {
      try {
        const title = await resolveSheetTitle(cfg.spreadsheet_id, cfg.sheet_gid, cfg.sheet_title);
        range = `'${title.replace(/'/g, "''")}'!A1:Z20000`;
      } catch (e) {
        if (e instanceof GoogleSheetsError) throw new HttpError(e.status === 503 ? 503 : 502, 'google', e.message);
        throw e;
      }
    }

    if (!dryRun) {
      const { data: id, error } = await db.rpc('npp_sync_start', {
        p_trigger: trigger,
        p_sheet_id: cfg.spreadsheet_id,
        p_range: range,
        p_initiated_by: initiatedBy,
      });
      if (error) {
        if (error.code === '55P03') throw new HttpError(409, 'busy', 'A synchronisation is already running');
        throw error;
      }
      runId = id as string;
      if (uploadId) await db.from('npp_sheet_uploads').update({ sync_run_id: runId }).eq('id', uploadId);
    }

    if (!values) {
      try {
        values = await readSheetValues(cfg.spreadsheet_id, range);
      } catch (e) {
        if (e instanceof GoogleSheetsError) throw new HttpError(e.status === 503 ? 503 : 502, 'google', e.message);
        throw e;
      }
    }

    const parsed = parseNppSheet(values, { spreadsheetId: cfg.spreadsheet_id, sheetGid: cfg.sheet_gid });

    if (dryRun) {
      return json(req, {
        dry_run: true,
        columns: parsed.columns,
        rows_read: parsed.rowsRead,
        valid: parsed.rows.length,
        skipped: parsed.skipped,
        invalid: parsed.invalid,
        flagged: parsed.flagged,
        inr_total: parsed.inrTotal,
      });
    }

    // ---- Apply in batches -------------------------------------------------
    const totals: Totals = { inserted: 0, updated: 0, unchanged: 0, conflicts: 0, adopted: 0 };
    const errors: { row?: number; reason: string }[] = [...parsed.invalid];
    for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
      const batch = parsed.rows.slice(i, i + BATCH_SIZE);
      try {
        const res = await applyWithRetry(db, runId!, batch);
        for (const k of Object.keys(totals) as (keyof Totals)[]) totals[k] += res[k] ?? 0;
      } catch (e) {
        console.error('[sheets-sync] batch failed', { from: batch[0]?.source_row_number, e });
        errors.push({
          row: batch[0]?.source_row_number,
          reason: `Batch of ${batch.length} rows starting at sheet row ${batch[0]?.source_row_number} failed to save`,
        });
      }
    }

    const batchFailed = errors.length > parsed.invalid.length;
    const { data: run, error: finishErr } = await db.rpc('npp_sync_finish', {
      p_run_id: runId,
      p_seen_keys: batchFailed ? null : parsed.rows.map((r) => r.source_key),
      p_rows_read: parsed.rowsRead,
      p_rows_skipped: parsed.skipped,
      p_invalid: errors.length,
      p_flagged: parsed.flagged,
      p_errors: errors.slice(0, 200),
      p_fatal_error: null,
    });
    if (finishErr) throw finishErr;

    // ---- Reconciliation: sheet INR total vs. what the database now holds for this run ----
    const { data: dbRows } = await db
      .from('npp_sales')
      .select('inr_value, pending_source')
      .eq('sync_run_id', runId!)
      .eq('source', 'google_sheets');
    let dbCents = 0n;
    let conflictRows = 0;
    for (const r of dbRows ?? []) {
      if (r.pending_source) conflictRows++;
      if (r.inr_value != null) dbCents += BigInt(Math.round(Number(r.inr_value) * 100));
    }
    const sheetCents = BigInt(parsed.inrTotal.replace('.', ''));
    const reconciliation = {
      sheet_inr_total: parsed.inrTotal,
      database_inr_total: (Number(dbCents) / 100).toFixed(2),
      sheet_rows: parsed.rows.length,
      database_rows: dbRows?.length ?? 0,
      matches: dbCents === sheetCents && (dbRows?.length ?? 0) === parsed.rows.length,
      note: conflictRows
        ? `${conflictRows} locally edited record(s) keep their CRM values until an administrator resolves the conflict.`
        : null,
    };

    return json(req, { run, totals, invalid: errors.length, reconciliation });
  } catch (err) {
    if (runId) {
      const message =
        err instanceof SheetStructureError || err instanceof HttpError ? err.message : 'Synchronisation failed unexpectedly';
      await db.rpc('npp_sync_finish', {
        p_run_id: runId,
        p_seen_keys: null,
        p_rows_read: 0,
        p_rows_skipped: 0,
        p_invalid: 0,
        p_flagged: 0,
        p_errors: [],
        p_fatal_error: message,
      });
    }
    if (err instanceof SheetStructureError) {
      return json(req, { error: { code: 'sheet_structure', message: err.message, missing: err.missingColumns } }, 422);
    }
    return handleError(req, err);
  }
});
