import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CheckCheck } from 'lucide-react';
import type { AppNotification } from '@loomos/shared';
import { Modal } from '../ui/dialog';
import { Button } from '../ui/button';
import { Empty } from '../shared/common';

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
  feed?: AppNotification[];
  unread: number;
  onRead: (id?: string) => void;
}

const severity: Record<string, string> = {
  MACHINE: 'danger',
  QUALITY: 'warning',
  REWORK: 'warning',
  ISSUE: 'danger',
  DELAY: 'danger',
  USER: 'warning',
};

const timeAgo = (value: string) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// The one place notifications are read. Each row links to the record it is about.
export function NotificationsModal({ open, onClose, feed, unread, onRead }: NotificationsModalProps) {
  const navigate = useNavigate();

  return (
    <Modal open={open} onClose={onClose} title="Notifications" description={unread ? `${unread} unread` : 'You are up to date.'}>
      {unread > 0 && (
        <div className="notification-tabs">
          <span className="spacer" />
          <Button size="sm" variant="outline" onClick={() => onRead()}>
            <CheckCheck size={14} /> Mark all read
          </Button>
        </div>
      )}
      <div className="notification-list">
        {feed?.length ? (
          feed.map((n) => (
            <button
              key={n.id}
              className={n.read ? '' : 'is-unread'}
              onClick={() => {
                if (!n.read) onRead(n.id);
                if (n.link) navigate(n.link);
                onClose();
              }}
            >
              <span className={`notice-dot ${severity[n.category] ?? 'success'}`} />
              <div>
                <strong>{n.title}</strong>
                <p>{n.message} · {timeAgo(n.createdAt)}</p>
              </div>
              <ArrowUpRight size={17} />
            </button>
          ))
        ) : (
          <Empty title="No notifications yet" description="Tasks, hand-overs, breakdowns and approvals will appear here." />
        )}
      </div>
    </Modal>
  );
}
