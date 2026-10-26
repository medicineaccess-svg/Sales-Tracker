// Hand-maintained types mirroring supabase/migrations. Regenerate with
// `supabase gen types typescript` if you prefer generated types.

export type Role = 'admin' | 'department_user';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'INR';
export type CurrencyBucket = Currency | 'UNSPECIFIED';
export type DrCr = 'Dr' | 'Cr';

export interface Department {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  description: string | null;
  config: Record<string, unknown>;
  sort_order: number;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  department_id: string | null;
  is_active: boolean;
  departments?: { code: string; name: string } | null;
}

export interface NppSale {
  id: string;
  source: 'google_sheets' | 'manual';
  source_key: string | null;
  source_sheet_id: string | null;
  source_row_number: number | null;
  source_raw: Record<string, string> | null;
  last_synced_at: string | null;
  missing_from_source_at: string | null;
  locally_modified: boolean;
  pending_source: Record<string, unknown> | null;
  sale_date: string | null;
  particulars: string;
  product_name: string;
  place_of_sale: string | null;
  manager: string | null;
  doctor_name: string | null;
  hospital_name: string | null;
  voucher_no: string | null;
  quantity: number | string | null;
  quantity_unit: string | null;
  currency: Currency | null;
  rate: number | string | null;
  rate_unit: string | null;
  value: number | string | null;
  gross_total: number | string | null;
  gross_total_dc: DrCr | null;
  export_sales: number | string | null;
  export_sales_dc: DrCr | null;
  shipping_charges: number | string | null;
  shipping_charges_dc: DrCr | null;
  inr_value: number | string | null;
  remarks: string | null;
  data_issues: string[];
  needs_review: boolean;
  status: 'active' | 'archived';
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncRun {
  id: string;
  department_code: string;
  trigger: 'initial' | 'manual' | 'scheduled';
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  started_at: string;
  finished_at: string | null;
  rows_read: number;
  rows_skipped: number;
  inserted: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  invalid: number;
  flagged: number;
  missing_from_source: number;
  errors: { row?: number; reason: string }[];
  notes: string | null;
  initiated_by: string | null;
}

export interface AuditLog {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_type: 'user' | 'system';
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  department_code: string | null;
  summary: string | null;
  changes: Record<string, { old?: unknown; new?: unknown; changed?: boolean }> | null;
  metadata: Record<string, unknown>;
}

export interface CurrencyTotals {
  currency: CurrencyBucket;
  records: number;
  value: number;
  records_with_value: number;
  avg_value: number | null;
  shipping: number;
  inr_value: number;
}

export interface GroupTotals {
  key: string;
  records: number;
  inr_value: number;
  value_usd: number;
  value_eur: number;
  value_unspecified: number;
}

export interface DashboardData {
  totals: {
    records: number;
    inr_value: number;
    records_with_inr: number;
    hospitals: number;
    doctors: number;
    products: number;
    undated: number;
    needs_review: number;
    conflicts: number;
    missing_from_source: number;
    first_date: string | null;
    last_date: string | null;
  };
  by_currency: CurrencyTotals[];
  quantity_by_unit: { unit: string; quantity: number; records: number }[];
  monthly: { month: string; currency: CurrencyBucket; records: number; value: number; inr_value: number; shipping: number }[];
  by_product: GroupTotals[];
  by_manager: GroupTotals[];
  by_hospital: GroupTotals[];
  by_doctor: GroupTotals[];
  by_place: GroupTotals[];
}

export interface ReportRow {
  group_key: string;
  sort_key: string;
  currency: CurrencyBucket;
  records: number;
  quantity: number | null;
  value: number;
  shipping: number;
  inr_value: number;
}

export interface FilterOptions {
  products: string[];
  managers: string[];
  hospitals: string[];
  doctors: string[];
  places: string[];
  financial_years: string[];
  currencies: CurrencyBucket[];
}
