import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Lock, Plus, Save } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { MetricSwitch } from '@/components/dashboard/charts';
import { fmtInr, monthLabel, PerfNav } from '@/components/performance/PerfUi';
import { useFilterOptions, useSalesManagers, useTargets, type TargetRow } from '@/hooks/useData';
import { friendlyError, notify } from '@/lib/errors';
import { fyLabel, fyMonths, fyStartYear, todayIso, type SalesManager } from '@/lib/performance';
import { supabase } from '@/lib/supabase';

type Scope = 'manager' | 'zone' | 'company';
type Grid = Record<string, Record<string, string>>; // scope_key → month → input text

const parseInr = (s: string): number | null | 'invalid' => {
  const t = s.replace(/[₹,\s]/g, '');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'invalid';
  return Number(t);
};

function TargetGrid({
  scope,
  rows,
  fy,
  targets,
  canEdit,
}: {
  scope: Scope;
  rows: { key: string; label: string; hint?: string }[];
  fy: number;
  targets: TargetRow[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const months = fyMonths(fy);
  const initial = useMemo(() => {
    const g: Grid = {};
    for (const r of rows) g[r.key] = {};
    for (const t of targets) if (t.scope === scope && g[t.scope_key]) g[t.scope_key][t.period_month] = String(Number(t.target_inr));
    return g;
  }, [rows, targets, scope]);
  const [grid, setGrid] = useState<Grid>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setGrid(initial), [initial]);

  const dirty = rows.some((r) => months.some((m) => (grid[r.key]?.[m] ?? '') !== (initial[r.key]?.[m] ?? '')));
  const invalid = rows.some((r) => months.some((m) => parseInr(grid[r.key]?.[m] ?? '') === 'invalid'));

  const set = (k: string, m: string, v: string) => setGrid((g) => ({ ...g, [k]: { ...g[k], [m]: v } }));
  const copyFirst = (k: string) => {
    const first = months.map((m) => grid[k]?.[m] ?? '').find((v) => v !== '');
    if (!first) return notify.info('Enter at least one month first.');
    setGrid((g) => ({ ...g, [k]: Object.fromEntries(months.map((m) => [m, g[k]?.[m] || first])) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const upserts: { department_code: string; scope: Scope; scope_key: string; period_month: string; target_inr: number }[] = [];
      const deletes: string[] = [];
      for (const r of rows) {
        for (const m of months) {
          const now = grid[r.key]?.[m] ?? '';
          const was = initial[r.key]?.[m] ?? '';
          if (now === was) continue;
          const v = parseInr(now);
          if (v === 'invalid') throw new Error('invalid');
          if (v === null) {
            const id = targets.find((t) => t.scope === scope && t.scope_key === r.key && t.period_month === m)?.id;
            if (id) deletes.push(id);
          } else upserts.push({ department_code: 'npp', scope, scope_key: r.key, period_month: m, target_inr: v });
        }
      }
      if (upserts.length) {
        const { error } = await supabase.from('sales_targets').upsert(upserts, { onConflict: 'department_code,scope,scope_key,period_month' });
        if (error) throw error;
      }
      if (deletes.length) {
        const { error } = await supabase.from('sales_targets').delete().in('id', deletes);
        if (error) throw error;
      }
      notify.success(`Saved ${upserts.length + deletes.length} target change(s).`);
      await qc.invalidateQueries({ queryKey: ['npp'] });
    } catch (e) {
      notify.error((e as Error).message === 'invalid' ? 'Targets must be numbers in rupees (up to 2 decimals).' : friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={scope === 'manager' ? 'Manager targets' : scope === 'zone' ? 'Zone targets' : 'Company target'}
        description={
          scope === 'zone'
            ? 'Optional. When a zone has no target for a month, the sum of its managers’ targets is used. Enter a zone target to cover the whole zone including HO sales.'
            : scope === 'company'
              ? 'Optional. When empty, the company target is the sum of zone targets (never added on top of them).'
              : 'Monthly targets in ₹. Leave a month empty when no target applies — it will show “Target Not Set”.'
        }
        actions={
          canEdit ? (
            <Button size="sm" onClick={save} loading={saving} disabled={!dirty || invalid}>
              <Save className="h-3.5 w-3.5" aria-hidden /> Save changes
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Read-only — administrators edit targets
            </span>
          )
        }
      />
      <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
        <table className="w-full min-w-[1200px] text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-1.5 py-2 font-medium">{scope === 'manager' ? 'Manager' : scope === 'zone' ? 'Zone' : ''}</th>
              {months.map((m) => (
                <th key={m} className="px-1 py-2 text-right font-medium">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="px-1.5 py-2 text-right font-medium">FY total (entered)</th>
              {canEdit && <th className="sr-only">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const vals = months.map((m) => parseInr(grid[r.key]?.[m] ?? ''));
              const total = vals.reduce<number>((s, v) => (typeof v === 'number' ? s + v : s), 0);
              const entered = vals.filter((v) => typeof v === 'number').length;
              return (
                <tr key={r.key} className="border-b border-line/60">
                  <td className="whitespace-nowrap px-1.5 py-1.5 font-medium text-ink">
                    {r.label}
                    {r.hint && <span className="block text-[11px] font-normal text-muted">{r.hint}</span>}
                  </td>
                  {months.map((m, i) => (
                    <td key={m} className="px-0.5 py-1">
                      {canEdit ? (
                        <Input
                          inputMode="decimal"
                          aria-label={`${r.label} target ${monthLabel(m, true)}`}
                          aria-invalid={vals[i] === 'invalid' || undefined}
                          className="h-8 min-w-[84px] px-2 text-right text-xs"
                          value={grid[r.key]?.[m] ?? ''}
                          onChange={(e) => set(r.key, m, e.target.value)}
                        />
                      ) : (
                        <span className="tabular block text-right">{typeof vals[i] === 'number' ? fmtInr(vals[i] as number) : '—'}</span>
                      )}
                    </td>
                  ))}
                  <td className="tabular whitespace-nowrap px-1.5 py-1.5 text-right font-semibold">
                    {entered ? fmtInr(total) : '—'}
                    <span className="block text-[11px] font-normal text-muted">{entered}/12 months</span>
                  </td>
                  {canEdit && (
                    <td className="px-1 py-1">
                      <Button variant="ghost" size="icon" title="Copy the first entered month to every empty month" aria-label={`Copy first value to empty months for ${r.label}`} onClick={() => copyFirst(r.key)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Annual figures are always the sum of the months entered here. The copy button fills empty months with the first value you
          entered — it never divides an annual amount.
        </p>
      </div>
    </Card>
  );
}

function ManagerMaster({ managers, canEdit, zones }: { managers: SalesManager[]; canEdit: boolean; zones: string[] }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(managers);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => setRows(managers), [managers]);

  const patch = (k: string, p: Partial<SalesManager>) => setRows((rs) => rs.map((r) => (r.manager_key === k ? { ...r, ...p } : r)));
  const save = async (r: SalesManager) => {
    setBusy(r.manager_key);
    const { error } = await supabase
      .from('sales_managers')
      .update({
        display_name: r.display_name.trim(),
        zone: r.zone || null,
        branch: r.branch?.trim() || null,
        employee_id: r.employee_id?.trim() || null,
        designation: r.designation?.trim() || null,
        reporting_manager: r.reporting_manager?.trim() || null,
        aliases: r.aliases.map((a) => a.trim().toLowerCase()).filter(Boolean),
        is_sales_manager: r.is_sales_manager,
        active: r.active,
      })
      .eq('manager_key', r.manager_key);
    setBusy(null);
    if (error) return notify.error(friendlyError(error));
    notify.success(`${r.display_name} saved.`);
    qc.invalidateQueries({ queryKey: ['npp'] });
  };
  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    setBusy('new');
    const { error } = await supabase.from('sales_managers').insert({ manager_key: key, display_name: name, aliases: [], is_sales_manager: true, active: true });
    setBusy(null);
    if (error) return notify.error(friendlyError(error));
    setNewName('');
    notify.success(`${name} added. Use the same spelling as the sheet's "Ikris Manager Involved" column (or add an alias).`);
    qc.invalidateQueries({ queryKey: ['npp'] });
  };

  const cell = 'h-8 px-2 text-xs';
  return (
    <Card>
      <CardHeader
        title="Sales-manager master data"
        description="Zone and aliases decide how sheet rows map to managers. Branch, employee ID and designation are not in the sheet — record them here."
      />
      <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
        <table className="w-full min-w-[1100px] text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-1.5 py-2 font-medium">Name</th>
              <th className="px-1.5 py-2 font-medium">Aliases (comma separated)</th>
              <th className="px-1.5 py-2 font-medium">Zone</th>
              <th className="px-1.5 py-2 font-medium">Branch</th>
              <th className="px-1.5 py-2 font-medium">Employee ID</th>
              <th className="px-1.5 py-2 font-medium">Designation</th>
              <th className="px-1.5 py-2 font-medium">Reports to</th>
              <th className="px-1.5 py-2 font-medium">Sales manager</th>
              <th className="px-1.5 py-2 font-medium">Active</th>
              {canEdit && <th className="sr-only">Save</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.manager_key} className="border-b border-line/60">
                {canEdit ? (
                  <>
                    <td className="px-1 py-1"><Input className={cell} value={r.display_name} onChange={(e) => patch(r.manager_key, { display_name: e.target.value })} aria-label="Name" /></td>
                    <td className="px-1 py-1"><Input className={cell} value={r.aliases.join(', ')} onChange={(e) => patch(r.manager_key, { aliases: e.target.value.split(',') })} aria-label="Aliases" /></td>
                    <td className="px-1 py-1">
                      <Select className={cell} value={r.zone ?? ''} onChange={(e) => patch(r.manager_key, { zone: e.target.value || null })} aria-label="Zone">
                        <option value="">—</option>
                        {zones.map((z) => <option key={z}>{z}</option>)}
                      </Select>
                    </td>
                    <td className="px-1 py-1"><Input className={cell} value={r.branch ?? ''} onChange={(e) => patch(r.manager_key, { branch: e.target.value })} aria-label="Branch" /></td>
                    <td className="px-1 py-1"><Input className={cell} value={r.employee_id ?? ''} onChange={(e) => patch(r.manager_key, { employee_id: e.target.value })} aria-label="Employee ID" /></td>
                    <td className="px-1 py-1"><Input className={cell} value={r.designation ?? ''} onChange={(e) => patch(r.manager_key, { designation: e.target.value })} aria-label="Designation" /></td>
                    <td className="px-1 py-1"><Input className={cell} value={r.reporting_manager ?? ''} onChange={(e) => patch(r.manager_key, { reporting_manager: e.target.value })} aria-label="Reports to" /></td>
                    <td className="px-1 py-1 text-center"><input type="checkbox" checked={r.is_sales_manager} onChange={(e) => patch(r.manager_key, { is_sales_manager: e.target.checked })} aria-label="Is a sales manager" /></td>
                    <td className="px-1 py-1 text-center"><input type="checkbox" checked={r.active} onChange={(e) => patch(r.manager_key, { active: e.target.checked })} aria-label="Active" /></td>
                    <td className="px-1 py-1">
                      <Button size="sm" variant="outline" loading={busy === r.manager_key} onClick={() => save(r)}>Save</Button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-1.5 py-1.5 font-medium">{r.display_name}</td>
                    <td className="px-1.5 py-1.5">{r.aliases.join(', ') || '—'}</td>
                    <td className="px-1.5 py-1.5">{r.zone ?? '—'}</td>
                    <td className="px-1.5 py-1.5">{r.branch ?? '—'}</td>
                    <td className="px-1.5 py-1.5">{r.employee_id ?? '—'}</td>
                    <td className="px-1.5 py-1.5">{r.designation ?? '—'}</td>
                    <td className="px-1.5 py-1.5">{r.reporting_manager ?? '—'}</td>
                    <td className="px-1.5 py-1.5">{r.is_sales_manager ? 'Yes' : 'No (company channel)'}</td>
                    <td className="px-1.5 py-1.5">{r.active ? 'Yes' : 'No'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input className="h-9 w-64 text-sm" placeholder="New manager name (as in the sheet)" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} />
            <Button size="sm" variant="outline" onClick={add} loading={busy === 'new'} disabled={!newName.trim()}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add manager
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function TargetsPage() {
  const { isAdmin } = useAuth();
  const [fy, setFy] = useState(() => fyStartYear(todayIso()));
  const [tab, setTab] = useState<'manager' | 'zone' | 'company' | 'master'>('manager');
  const targets = useTargets(fy);
  const managers = useSalesManagers();

  const { data: opts } = useFilterOptions();
  const zones = useMemo(() => {
    const s = new Set<string>(opts?.zones ?? []);
    for (const m of managers.data ?? []) if (m.zone) s.add(m.zone);
    for (const t of targets.data ?? []) if (t.scope === 'zone') s.add(t.scope_key);
    return [...s].sort();
  }, [opts, managers.data, targets.data]);
  const managerRows = useMemo(
    () =>
      (managers.data ?? [])
        .filter((m) => m.is_sales_manager && m.active)
        .map((m) => ({ key: m.manager_key, label: m.display_name, hint: m.zone ?? 'No zone' })),
    [managers.data],
  );
  const zoneRows = useMemo(() => zones.map((z) => ({ key: z, label: z })), [zones]);
  const companyRows = useMemo(() => [{ key: 'company', label: 'Company' }], []);
  const cur = fyStartYear(todayIso());

  return (
    <div>
      <PageHeader
        title="Targets & managers"
        description="Monthly targets drive achievement, remaining and status. Only administrators can change them; every change is audited."
      />
      <PerfNav />
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Financial year</span>
          <Select className="h-9 w-40 text-xs" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {[cur + 1, cur, cur - 1, cur - 2].map((y) => (
              <option key={y} value={y}>
                {fyLabel(y)}
              </option>
            ))}
          </Select>
        </label>
        <MetricSwitch
          label="Section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'manager', label: 'Managers' },
            { value: 'zone', label: 'Zones' },
            { value: 'company', label: 'Company' },
            { value: 'master', label: 'Manager master data' },
          ]}
        />
      </div>
      {targets.error || managers.error ? (
        <Card>
          <ErrorState message={friendlyError(targets.error ?? managers.error)} onRetry={() => (targets.refetch(), managers.refetch())} />
        </Card>
      ) : targets.isLoading || managers.isLoading ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : tab === 'master' ? (
        <ManagerMaster managers={managers.data ?? []} canEdit={isAdmin} zones={zones} />
      ) : (
        <TargetGrid
          key={`${tab}-${fy}`}
          scope={tab}
          rows={tab === 'manager' ? managerRows : tab === 'zone' ? zoneRows : companyRows}
          fy={fy}
          targets={targets.data ?? []}
          canEdit={isAdmin}
        />
      )}
      {!isAdmin && (
        <Card className="mt-4">
          <CardBody className="text-xs text-muted">Targets are read-only for your account. The database rejects target changes from non-administrators.</CardBody>
        </Card>
      )}
    </div>
  );
}
