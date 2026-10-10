import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, ShoppingBag, type LucideIcon } from 'lucide-react';
import type { Area, Role, PageResponse, OrderSummary } from '@loomos/shared';
import { can } from '@loomos/shared';
import { Modal } from '../ui/dialog';

export interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  area: Area;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  userRole: Role;
  allNavItems: [string, string, LucideIcon, Area][];
  ordersData?: PageResponse<OrderSummary>;
}

export function GlobalSearchModal({
  open,
  onClose,
  userRole,
  allNavItems,
  ordersData,
}: GlobalSearchModalProps) {
  const [term, setTerm] = useState('');
  const navigate = useNavigate();

  const filteredNav = allNavItems
    .filter(([name, , , area]) => can(userRole, area) && name.toLowerCase().includes(term.toLowerCase()));

  const filteredOrders = ordersData?.data
    .filter((o) => `${o.number} ${o.buyer.name}`.toLowerCase().includes(term.toLowerCase()))
    .slice(0, 5) ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find your next action"
      description="Search pages and buyer orders in your workspace."
    >
      <div className="command-input">
        <Search size={20} />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search orders, machines, inventory…"
        />
      </div>
      <div className="command-results">
        {filteredNav.map(([name, path, Icon]) => (
          <button
            key={path}
            onClick={() => {
              navigate(path);
              onClose();
            }}
          >
            <Icon size={18} />
            {name}
            <ArrowRight size={16} />
          </button>
        ))}
        {filteredOrders.map((o) => (
          <button
            key={o.id}
            onClick={() => {
              navigate(`/orders/${o.id}`);
              onClose();
            }}
          >
            <ShoppingBag size={18} />
            {o.number} · {o.buyer.name}
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
    </Modal>
  );
}
