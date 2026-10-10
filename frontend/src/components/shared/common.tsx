import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  Inbox,
  AlertCircle,
  Loader2,
  Search,
  ArrowDownToLine,
} from 'lucide-react';
import { Button } from '../ui/button';
import { label, cn } from '../../lib/utils';

// Labels that read better than the raw status code.
const statusLabels: Record<string, string> = {
  PENDING_REVIEW: 'Waiting for review',
};

export function Badge({
  value,
  children,
}: {
  value: string;
  children?: ReactNode;
}) {
  const tone = [
    'PASSED',
    'RUNNING',
    'COMPLETED',
    'PAID',
    'ON_TRACK',
    'READY',
    'PRESENT',
    'RECEIVED',
    'RESOLVED',
    'APPROVED',
    'FINISHED',
  ].includes(value)
    ? 'green'
    : ['BREAKDOWN', 'REJECTED', 'URGENT', 'CANCELLED', 'FAILED'].includes(value)
    ? 'red'
    : [
        'PENDING',
        'PENDING_REVIEW',
        'PAUSED',
        'REWORK',
        'BLOCKED',
        'HIGH',
        'PARTIAL',
        'ATTENTION',
        'MAINTENANCE',
        'OPEN',
      ].includes(value)
    ? 'amber'
    : [
        'IN_PRODUCTION',
        'IN_PROGRESS',
        'WEAVING',
        'DYEING',
        'DISPATCHED',
        'ONGOING',
        'SPINNING',
        'QUALITY',
        'DISPATCH',
      ].includes(value)
    ? 'blue'
    : 'gray';

  return (
    <span className={`badge badge-${tone}`}>
      <span />
      {children ?? statusLabels[value] ?? label(value)}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('panel', className)}>
      {title && (
        <div className="panel-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label: caption,
  value,
  unit,
  meta,
  icon,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  meta: ReactNode;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`kpi ${accent ? 'kpi-accent' : ''}`}>
      <div className="kpi-top">
        <span>{caption}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <div className="kpi-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="kpi-meta">{meta}</div>
      <span className="kpi-decoration" />
    </div>
  );
}

export function Progress({
  value,
  label: caption,
}: {
  value: number;
  label?: string;
}) {
  return (
    <div className="progress-wrap">
      <div className="progress-track">
        <div style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      {caption && <span>{caption}</span>}
    </div>
  );
}

export function Empty({
  title = 'Nothing here yet',
  description = 'New records will appear here as your factory gets to work.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={27} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading-page" aria-label="Loading factory data">
      <div className="skeleton skeleton-title" />
      <div className="kpi-grid">
        {[1, 2, 3, 4].map((n) => (
          <div className="skeleton skeleton-card" key={n} />
        ))}
      </div>
      <div className="skeleton skeleton-chart" />
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <div className="empty">
      <AlertCircle size={30} />
      <h3>We couldn’t load this view</h3>
      <p>{error.message}</p>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}

export function Spinner() {
  return <Loader2 className="spin" size={17} />;
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search records…',
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={16} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      <ArrowDownToLine size={15} />
      Export
    </Button>
  );
}
