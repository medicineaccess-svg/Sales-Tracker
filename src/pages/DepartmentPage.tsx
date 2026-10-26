import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Circle, Clock, Globe2, HeartPulse } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { useDepartments } from '@/hooks/useData';

/**
 * Landing page for departments that are not yet operational. No sales figures
 * are shown — the module only becomes data-driven once its own data source and
 * schema are configured.
 */
export function DepartmentPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { isAdmin, profile } = useAuth();
  const { data, isLoading } = useDepartments();
  const dept = data?.find((d) => d.code === code);

  if (!isAdmin && profile?.departments?.code !== code) return <Navigate to="/unauthorized" replace />;
  if (dept?.status === 'active' && code === 'npp') return <Navigate to="/dashboard" replace />;
  if (isLoading) return <Skeleton className="h-64" />;
  if (!dept) return <Navigate to="/not-found" replace />;

  const cfg = dept.config as { spreadsheet_id?: string };
  const steps = [
    { label: 'Department created', done: true },
    { label: 'Google Sheet connected', done: !!cfg.spreadsheet_id },
    { label: 'Department data schema & column mapping defined', done: false },
    { label: 'Dashboard and reports configured', done: false },
    { label: 'Users assigned and module activated', done: dept.status === 'active' },
  ];
  const Icon = code === 'export' ? Globe2 : HeartPulse;

  return (
    <div>
      <PageHeader
        title={`${dept.name} department`}
        description={dept.description ?? undefined}
        actions={<Badge tone="neutral" icon={<Clock className="h-3 w-3" />}>Coming soon</Badge>}
      />
      <Card className="overflow-hidden">
        <div className="grid gap-8 p-8 md:grid-cols-[1fr_1.2fr]">
          <div>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand">
              <Icon className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-navy">This module is not active yet</h2>
            <p className="mt-2 text-sm text-muted">
              {dept.name} sales will appear here once the department's real data source is connected. No placeholder or sample
              figures are shown. Each department keeps its own data structure, sheet connection, dashboard, reports and permissions.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {isAdmin && (
                <Button variant="outline" onClick={() => navigate('/settings')}>
                  Configure department
                </Button>
              )}
              <Button variant="ghost" onClick={() => navigate('/overview')}>
                Back to overview
              </Button>
            </div>
          </div>
          <ol className="space-y-3">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm">
                {s.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-line" />}
                <span className={s.done ? 'text-ink' : 'text-muted'}>{s.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </Card>
    </div>
  );
}
