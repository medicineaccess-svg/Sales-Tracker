import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarClock, Info, Lock, Save } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useDepartments, useSettings } from '@/hooks/useData';
import { friendlyError, notify } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Department } from '@/types/database';

function DepartmentEditor({ dept, canEdit }: { dept: Department; canEdit: boolean }) {
  const qc = useQueryClient();
  const cfg = dept.config as { spreadsheet_id?: string; sheet_gid?: number | string; sheet_title?: string };
  const [description, setDescription] = useState(dept.description ?? '');
  const [sheetId, setSheetId] = useState(cfg.spreadsheet_id ?? '');
  const [gid, setGid] = useState(cfg.sheet_gid !== undefined ? String(cfg.sheet_gid) : '');
  const [status, setStatus] = useState(dept.status);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = sheetId.trim();
      if (trimmed && !/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) throw new Error('Spreadsheet ID looks invalid — copy it from the sheet URL between /d/ and /edit.');
      if (gid && !/^\d+$/.test(gid)) throw new Error('Worksheet gid must be a number.');
      const config = { ...dept.config, spreadsheet_id: trimmed || undefined, sheet_gid: gid ? Number(gid) : undefined };
      const { error } = await supabase.rpc('admin_update_department', {
        p_code: dept.code,
        p_status: status,
        p_description: description,
        p_config: config,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      notify.success(`${dept.name} configuration saved`);
      await qc.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (e) => notify.error(e instanceof Error && !('code' in e) ? e.message : friendlyError(e)),
  });

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold text-navy">
          <Building2 className="h-4 w-4" /> {dept.name}
        </p>
        {dept.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge>Coming soon</Badge>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Description" htmlFor={`d-${dept.code}`} className="md:col-span-2">
          <Textarea id={`d-${dept.code}`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Google Spreadsheet ID" htmlFor={`s-${dept.code}`}>
          <Input id={`s-${dept.code}`} value={sheetId} onChange={(e) => setSheetId(e.target.value)} disabled={!canEdit} placeholder="1yEn6Nfl…" />
        </Field>
        <Field label="Worksheet gid" htmlFor={`g-${dept.code}`} hint="The number after #gid= in the sheet URL">
          <Input id={`g-${dept.code}`} value={gid} onChange={(e) => setGid(e.target.value)} disabled={!canEdit} inputMode="numeric" />
        </Field>
        <Field
          label="Status"
          htmlFor={`st-${dept.code}`}
          hint={dept.code !== 'npp' ? 'Activation requires a department-specific data schema and mapping (enforced by the database).' : undefined}
        >
          <Select id={`st-${dept.code}`} value={status} onChange={(e) => setStatus(e.target.value as Department['status'])} disabled={!canEdit}>
            <option value="active">Active</option>
            <option value="inactive">Inactive / coming soon</option>
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>Last updated {formatDateTime(dept.updated_at)}</span>
        {canEdit && (
          <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { isAdmin } = useAuth();
  const { data: depts, isLoading } = useDepartments();
  const { data: settings } = useSettings();
  const schedule = settings?.find((s) => s.key === 'sync.schedule')?.value as { enabled?: boolean; cron?: string } | undefined;

  return (
    <div>
      <PageHeader
        title="Settings"
        description={isAdmin ? 'Department configuration, reporting definitions and synchronisation settings.' : 'Application settings (read-only for department users).'}
      />
      {!isAdmin && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">
          <Lock className="h-4 w-4" /> Only administrators can change these settings.
        </div>
      )}

      <Card>
        <CardHeader title="Departments" description="Each department has its own data source, schema, dashboard and permissions." />
        <CardBody className="space-y-4">
          {isLoading && <Skeleton className="h-40" />}
          {depts?.map((d) => <DepartmentEditor key={`${d.id}-${d.updated_at}`} dept={d} canEdit={isAdmin} />)}
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Reporting" />
          <CardBody className="space-y-3 text-sm">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              Financial year: <strong className="ml-1">1 April – 31 March</strong> (Indian FY). Custom date ranges are available in every filter bar.
            </p>
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              INR Value is taken as reported in the source sheet. No exchange rates are applied, and USD / EUR totals are never combined.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Scheduled synchronisation" />
          <CardBody className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-brand" />
              Status: {schedule?.enabled ? <Badge tone="success">Enabled · {schedule.cron} UTC</Badge> : <Badge>Not scheduled</Badge>}
            </p>
            <p className="text-xs text-muted">
              Scheduled runs use Supabase pg_cron to call the <code>sheets-sync</code> function with a secret header. Setup steps are in{' '}
              <code>docs/GOOGLE_SHEETS_SYNC.md</code>. Manual imports are always available on the Google Sheets Sync page.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
