import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CheckCheck } from 'lucide-react';
import type { AppNotification, Notice } from '@loomos/shared';
import { Modal } from '../ui/dialog';
import { Button } from '../ui/button';
import { Empty } from '../shared/common';

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
  // Work waiting for your team right now (built live from the factory data).
  notices?: Notice[];
  // Stored notifications: things that happened, with read / unread state.
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

export function NotificationsModal({ open, onClose, notices, feed, unread, onRead }: NotificationsModalProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'feed' | 'work'>('feed');

  const go = (href: string) => {
    if (href) navigate(href);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Notifications" description="What happened, and what is waiting for you.">
      <div className="notification-tabs tabs">
        <button className={tab === 'feed' ? 'active' : ''} onClick={() => setTab('feed')}>
          Updates {unread > 0 && `(${unread} new)`}
        </button>
        {notices && (
          <button className={tab === 'work' ? 'active' : ''} onClick={() => setTab('work')}>
            Work waiting ({notices.length})
          </button>
        )}
        <span className="spacer" />
        {tab === 'feed' && unread > 0 && (
          <Button size="sm" variant="outline" onClick={() => onRead()}>
            <CheckCheck size={14} /> Mark all read
          </Button>
        )}
      </div>

      <div className="notification-list">
        {tab === 'feed' &&
          (feed?.length ? (
            feed.map((n) => (
              <button
                key={n.id}
                className={n.read ? '' : 'is-unread'}
                onClick={() => {
                  if (!n.read) onRead(n.id);
                  go(n.link);
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
            <Empty title="No notifications yet" description="You will see production, quality and approval updates here." />
          ))}

        {tab === 'work' &&
          (notices?.length ? (
            notices.map((n) => (
              <button key={n.id} onClick={() => go(n.href)}>
                <span className={`notice-dot ${n.severity}`} />
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.description}</p>
                </div>
                <ArrowUpRight size={17} />
              </button>
            ))
          ) : (
            <Empty title="You’re all caught up" description="No work is waiting for your team right now." />
          ))}
      </div>
    </Modal>
  );
}
