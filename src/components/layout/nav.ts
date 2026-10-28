import {
  BarChart3,
  Building2,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LineChart,
  Settings,
  Target,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to?: string; // undefined → action (Department selector)
  icon: LucideIcon;
  adminOnly?: boolean;
  action?: 'departments';
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', to: '/overview', icon: LayoutDashboard },
  { label: 'Sales Dashboard', to: '/dashboard', icon: BarChart3 },
  { label: 'Performance', to: '/performance', icon: Target },
  { label: 'Department', icon: Building2, action: 'departments' },
  { label: 'NPP Sales', to: '/sales', icon: ClipboardList },
  { label: 'Google Sheets Sync', to: '/sync', icon: FileSpreadsheet },
  { label: 'Sales Reports', to: '/reports', icon: FileText },
  { label: 'Analytics', to: '/analytics', icon: LineChart },
  { label: 'Audit Logs', to: '/audit', icon: ShieldCheck },
  { label: 'User Management', to: '/users', icon: Users, adminOnly: true },
  { label: 'Settings', to: '/settings', icon: Settings },
  { label: 'Profile', to: '/profile', icon: User },
];

export const PAGE_TITLES: Record<string, string> = {
  '/overview': 'Overview',
  '/dashboard': 'Sales Dashboard',
  '/departments': 'Departments',
  '/performance': 'Performance',
  '/sales': 'NPP Sales',
  '/sync': 'Google Sheets Sync',
  '/reports': 'Sales Reports',
  '/analytics': 'Analytics',
  '/audit': 'Audit Logs',
  '/users': 'User Management',
  '/settings': 'Settings',
  '/profile': 'Profile',
};
