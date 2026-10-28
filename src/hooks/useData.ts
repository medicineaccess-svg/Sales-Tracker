import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toRpcFilters, type SalesFilters } from '@/lib/filters';
import type { PerformanceData, SalesManager } from '@/lib/performance';
import type {
  AuditLog,
  DashboardData,
  Department,
  FilterOptions,
  NppSale,
  ReportRow,
  SyncRun,
} from '@/types/database';

export const qk = {
  departments: ['departments'] as const,
  filterOptions: ['npp', 'filter-options'] as const,
  dashboard: (f: object, top: number) => ['npp', 'dashboard', f, top] as const,
  report: (g: string, f: object) => ['npp', 'report', g, f] as const,
  sales: (args: object) => ['npp', 'sales', args] as const,
  sale: (id: string) => ['npp', 'sale', id] as const,
  syncRuns: (limit: number) => ['sync-runs', limit] as const,
  audit: (args: object) => ['audit', args] as const,
  settings: ['settings'] as const,
  performance: (f: object) => ['npp', 'performance', f] as const,
  managers: ['npp', 'sales-managers'] as const,
  targets: (fy: number) => ['npp', 'targets', fy] as const,
};

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export function useDepartments() {
  return useQuery({
    queryKey: qk.departments,
    queryFn: () =>
      unwrap<Department[]>(
        supabase.from('departments').select('id, code, name, status, description, config, sort_order, updated_at').order('sort_order'),
      ),
    staleTime: 5 * 60_000,
  });
}

export function useFilterOptions() {
  return useQuery({
    queryKey: qk.filterOptions,
    queryFn: () => unwrap<FilterOptions>(supabase.rpc('npp_filter_options')),
    staleTime: 5 * 60_000,
  });
}

export function useDashboard(filters: SalesFilters, top = 10) {
  const rpc = toRpcFilters(filters);
  return useQuery({
    queryKey: qk.dashboard(rpc, top),
    queryFn: () => unwrap<DashboardData>(supabase.rpc('npp_dashboard', { p: rpc, p_top: top })),
    placeholderData: keepPreviousData,
  });
}

export type ReportGroup = 'day' | 'month' | 'quarter' | 'financial_year' | 'product' | 'manager' | 'hospital' | 'doctor' | 'place';

export function useReport(group: ReportGroup, filters: SalesFilters, enabled = true) {
  const rpc = toRpcFilters(filters);
  return useQuery({
    queryKey: qk.report(group, rpc),
    queryFn: () => unwrap<ReportRow[]>(supabase.rpc('npp_report', { p_group: group, p: rpc })),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export type SortKey = 'sale_date' | 'value' | 'inr_value' | 'quantity' | 'manager' | 'hospital_name' | 'product_name';

export interface SalesPageArgs {
  filters: SalesFilters;
  sort: SortKey;
  ascending: boolean;
  page: number;
  pageSize: number;
}

/** Server-side paginated, filtered and sorted sales (RLS applies via the invoker function). */
export function useSalesPage(args: SalesPageArgs) {
  const rpc = toRpcFilters(args.filters);
  return useQuery({
    queryKey: qk.sales({ ...args, filters: rpc }),
    queryFn: async () => {
      const from = args.page * args.pageSize;
      const { data, error, count } = await supabase
        .rpc('npp_filtered', { p: rpc }, { count: 'exact' })
        .order(args.sort, { ascending: args.ascending, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, from + args.pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []) as NppSale[], total: count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });
}

/** Fetches every filtered record (for exports). Capped at 20k rows. */
export async function fetchAllFilteredSales(filters: SalesFilters): Promise<NppSale[]> {
  const rpc = toRpcFilters(filters);
  const out: NppSale[] = [];
  const page = 1000;
  for (let from = 0; from < 20_000; from += page) {
    const { data, error } = await supabase
      .rpc('npp_filtered', { p: rpc })
      .order('sale_date', { ascending: true, nullsFirst: false })
      .order('id')
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as NppSale[]));
    if (!data || data.length < page) break;
  }
  return out;
}

export function useSale(id: string | null) {
  return useQuery({
    queryKey: qk.sale(id ?? ''),
    queryFn: () => unwrap<NppSale>(supabase.from('npp_sales').select('*').eq('id', id!).single()),
    enabled: !!id,
  });
}

export function useSyncRuns(limit = 20) {
  return useQuery({
    queryKey: qk.syncRuns(limit),
    queryFn: () =>
      unwrap<SyncRun[]>(
        supabase.from('sync_runs').select('*').eq('department_code', 'npp').order('started_at', { ascending: false }).limit(limit),
      ),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 4000 : false),
  });
}

export interface AuditArgs {
  page: number;
  pageSize: number;
  action?: string;
  entityId?: string;
  from?: string;
  to?: string;
}

export function useAuditLogs(args: AuditArgs) {
  return useQuery({
    queryKey: qk.audit(args),
    queryFn: async () => {
      let q = supabase.from('audit_logs').select('*', { count: 'exact' }).order('occurred_at', { ascending: false });
      if (args.action) q = q.like('action', `${args.action}%`);
      if (args.entityId) q = q.eq('entity_id', args.entityId);
      if (args.from) q = q.gte('occurred_at', `${args.from}T00:00:00`);
      if (args.to) q = q.lte('occurred_at', `${args.to}T23:59:59`);
      const from = args.page * args.pageSize;
      const { data, error, count } = await q.range(from, from + args.pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []) as AuditLog[], total: count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: () =>
      unwrap<{ key: string; value: unknown; is_public: boolean; description: string | null; updated_at: string }[]>(
        supabase.from('app_settings').select('key, value, is_public, description, updated_at').order('key'),
      ),
  });
}

// ---------------------------------------------------------------------------
// Performance (targets, managers, monthly facts)
// ---------------------------------------------------------------------------

/** Monthly facts + targets + master data. Period filters are applied client-side so that
 *  previous-month growth and FY-to-date figures always have the months they need. */
export function usePerformance(filters: Pick<SalesFilters, 'product' | 'place' | 'channel' | 'date_from' | 'date_to'> = {}) {
  const rpc = toRpcFilters(filters);
  return useQuery({
    queryKey: qk.performance(rpc),
    queryFn: () => unwrap<PerformanceData>(supabase.rpc('npp_performance', { p: rpc })),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useSalesManagers() {
  return useQuery({
    queryKey: qk.managers,
    queryFn: () =>
      unwrap<SalesManager[]>(
        supabase
          .from('sales_managers')
          .select('manager_key, display_name, aliases, employee_id, designation, zone, branch, reporting_manager, is_sales_manager, active')
          .order('display_name'),
      ),
  });
}

export interface TargetRow {
  id: string;
  scope: 'manager' | 'zone' | 'company';
  scope_key: string;
  period_month: string;
  target_inr: number | string;
  notes: string | null;
  updated_at: string;
}

export function useTargets(fyStart: number) {
  return useQuery({
    queryKey: qk.targets(fyStart),
    queryFn: () =>
      unwrap<TargetRow[]>(
        supabase
          .from('sales_targets')
          .select('id, scope, scope_key, period_month, target_inr, notes, updated_at')
          .eq('department_code', 'npp')
          .gte('period_month', `${fyStart}-04-01`)
          .lte('period_month', `${fyStart + 1}-03-01`),
      ),
  });
}
