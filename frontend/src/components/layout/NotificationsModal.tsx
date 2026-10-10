import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { Notice } from '@loomos/shared';
import { Modal } from '../ui/dialog';
import { Empty } from '../shared/common';

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
  notices?: Notice[];
}

export function NotificationsModal({ open, onClose, notices }: NotificationsModalProps) {
  const navigate = useNavigate();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Factory inbox"
      description="The right information, at the right time."
    >
      <div className="notification-list">
        {notices?.length ? (
          notices.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                navigate(n.href);
                onClose();
              }}
            >
              <span className={`notice-dot ${n.severity}`} />
              <div>
                <strong>{n.title}</strong>
                <p>{n.description}</p>
              </div>
              <ArrowUpRight size={17} />
            </button>
          ))
        ) : (
          <Empty
            title="You’re all caught up"
            description="No actionable factory alerts right now."
          />
        )}
      </div>
    </Modal>
  );
}
