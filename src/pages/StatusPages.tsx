import { useNavigate } from 'react-router-dom';
import { Compass, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';

export function UnauthorizedPage() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<ShieldAlert className="h-6 w-6" />}
      title="You don't have access to this page"
      description="Your account is limited to your own department. Contact an administrator if you need additional access."
      action={<Button onClick={() => navigate('/')}>Go to my workspace</Button>}
      className="min-h-[60vh]"
    />
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<Compass className="h-6 w-6" />}
      title="Page not found"
      description="The page you were looking for does not exist."
      action={<Button onClick={() => navigate('/')}>Back to the app</Button>}
      className="min-h-[60vh]"
    />
  );
}
