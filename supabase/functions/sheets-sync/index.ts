// sheets-sync — imports the NPP Google Sheet into public.npp_sales.
//
// POST body: { "dry_run"?: boolean }
// Auth: an active admin's JWT, or (for scheduled runs) header `x-sync-secret: <SYNC_CRON_SECRET>`.
//
// The sync is idempotent: rows are matched on a stable source key (normalised
// voucher number), unchanged rows are skipped by hash, locally edited rows are
// never overwritten (the sheet version is parked as a conflict), and rows that
// disappear from the sheet are flagged rather than deleted.

import { corsHeaders, handleError, HttpError, json, requireAdmin, serviceClient } from '../_shared/http.ts';
import { readSheetValues, resolveSheetTitle, GoogleSheetsError } from '../_shared/google-sheets.ts';
import { parseNppSheet, SheetStructureError, type ParsedNppRow } from '../_shared/npp-parser.ts';

const BATCH_SIZE = 100;

async function applyWithRetry(db: ReturnType<typeof serviceClient>, runId: string, rows: ParsedNppRow[]) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.rpc('npp_sync_apply', { p_run_id: runId, p_rows: rows });
    if (!error) return data;
    lastErr = error;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw lastErr;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: { code: 'method', message: 'POST only' } }, 405);

  const db = serviceClient();
  let runId: string | null = null;

  try {
    // ---- Authorisation -------------------------------------------------
    let trigger: 'manual' | 'scheduled' = 'manual';
    let initiatedBy: string | null = null;
    const cronSecret = Deno.env.get('SYNC_CRON_SECRET');
    const providedSecret = req.headers.get('x-sync-secret');
    if (cronSecret && providedSecret) {
      if (providedSecret !== cronSecret) throw new HttpError(401, 'bad_secret', 'Invalid sync secret');
      trigger = 'scheduled';
    } else {
      const caller = await requireAdmin(req, db);
      initiatedBy = caller.user.id;
    }

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

    // ---- Read & parse ----------------------------------------------------
    const title = await resolveSheetTitle(cfg.spreadsheet_id, cfg.sheet_gid, cfg.sheet_title);
    const range = `'${title.replace(/'/g, "''")}'!A1:Z10000`;

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
    }

    let values: string[][];
    try {
      values = await readSheetValues(cfg.spreadsheet_id, range);
    } catch (e) {
      if (e instanceof GoogleSheetsError) throw new HttpError(e.status === 503 ? 503 : 502, 'google', e.message);
      throw e;
    }

    const parsed = parseNppSheet(values, { spreadsheetId: cfg.spreadsheet_id, sheetGid: cfg.sheet_gid });

    if (dryRun) {
      return json(req, {
        dry_run: true,
        rows_read: parsed.rowsRead,
        valid: parsed.rows.length,
        skipped: parsed.skipped,
        invalid: parsed.invalid,
        flagged: parsed.flagged,
      });
    }

    // ---- Apply in batches -------------------------------------------------
    const totals = { inserted: 0, updated: 0, unchanged: 0, conflicts: 0 };
    const errors: { row?: number; reason: string }[] = [...parsed.invalid];
    for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
      const batch = parsed.rows.slice(i, i + BATCH_SIZE);
      try {
        const res = (await applyWithRetry(db, runId!, batch)) as typeof totals;
        totals.inserted += res.inserted;
        totals.updated += res.updated;
        totals.unchanged += res.unchanged;
        totals.conflicts += res.conflicts;
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
      // If any batch failed we cannot know which rows are truly missing → skip the missing check.
      p_seen_keys: batchFailed ? null : parsed.rows.map((r) => r.source_key),
      p_rows_read: parsed.rowsRead,
      p_rows_skipped: parsed.skipped,
      p_invalid: errors.length,
      p_flagged: parsed.flagged,
      p_errors: errors.slice(0, 200),
      p_fatal_error: null,
    });
    if (finishErr) throw finishErr;

    return json(req, { run, totals, invalid: errors.length });
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
