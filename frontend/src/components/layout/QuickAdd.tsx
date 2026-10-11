import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, ShoppingBag, Workflow, Package, ClipboardList, FileText, Wallet, Building2, Truck, Factory, Users, Clock, Layers, UserPlus } from 'lucide-react';
import { hasPermission, standardRoles, type CurrentUser, type OrderSummary, type Role } from '@loomos/shared';
import { useLookups } from '../../hooks/useFactory';
import { ActionForm, type FormSpec } from '../shared/ActionForm';
import { NewOrderModal } from '../../features/orders/NewOrderModal';
import { standaloneBatchForm } from '../../features/production/productionForms';
import {
  billForm, buyerForm, expenseForm, machineForm, materialForm, purchaseForm, receiptForm, shiftForm, supplierForm, userForm, workerForm,
} from '../../features/forms/quickForms';

interface Item { key: string; group: string; label: string; hint: string; icon: ReactNode; allowed: boolean; spec?: () => FormSpec }

// "+ New" in the top bar: everything the signed-in person is allowed to add, from any page.
export function QuickAdd({ user, orders }: { user: CurrentUser; orders: OrderSummary[] }) {
  const lookups = useLookups();
  const [open, setOpen] = useState(false);
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [order, setOrder] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const can = (resource: string, action: string) => hasPermission(user, resource, action);
  const l = lookups.data;
  const items: Item[] = [
    { key: 'order', group: 'Work', label: 'Order', hint: 'For a buyer, at the fixed price', icon: <ShoppingBag size={16} />, allowed: user.role !== 'BUYER' && can('orders', 'create') },
    { key: 'batch', group: 'Work', label: 'Production batch', hint: 'For stock, samples or replacement', icon: <Workflow size={16} />, allowed: can('production', 'create'), spec: () => standaloneBatchForm(l) },
    { key: 'receipt', group: 'Work', label: 'Yarn receipt', hint: 'Yarn arriving at the gate', icon: <Package size={16} />, allowed: can('inventory', 'manage'), spec: () => receiptForm(l, orders) },
    { key: 'purchase', group: 'Work', label: 'Purchase order', hint: 'Order yarn from a supplier', icon: <ClipboardList size={16} />, allowed: can('procurement', 'create'), spec: () => purchaseForm(l) },
    { key: 'bill', group: 'Money', label: 'Bill to pay', hint: 'Dyes, spares, power, transport', icon: <FileText size={16} />, allowed: can('finance', 'manage'), spec: () => billForm(l) },
    { key: 'expense', group: 'Money', label: 'Expense', hint: 'Rent, office, small cash', icon: <Wallet size={16} />, allowed: can('finance', 'manage'), spec: () => expenseForm() },
    { key: 'buyer', group: 'Set-up', label: 'Buyer', hint: 'A customer company', icon: <Building2 size={16} />, allowed: can('orders', 'approve'), spec: () => buyerForm() },
    { key: 'supplier', group: 'Set-up', label: 'Supplier', hint: 'Anyone who sends a bill', icon: <Truck size={16} />, allowed: can('procurement', 'manage') || can('inventory', 'manage'), spec: () => supplierForm() },
    { key: 'machine', group: 'Set-up', label: 'Machine', hint: 'Spinning frame, loom or dyeing machine', icon: <Factory size={16} />, allowed: can('machines', 'create') || can('settings', 'manage'), spec: () => machineForm(l) },
    { key: 'worker', group: 'Set-up', label: 'Worker', hint: 'Floor or office staff', icon: <Users size={16} />, allowed: can('settings', 'manage'), spec: () => workerForm(l) },
    { key: 'shift', group: 'Set-up', label: 'Shift', hint: 'Start time and length', icon: <Clock size={16} />, allowed: can('settings', 'manage'), spec: () => shiftForm() },
    { key: 'fabric', group: 'Set-up', label: 'Fabric & price', hint: 'What buyers can order', icon: <Layers size={16} />, allowed: can('settings', 'manage'), spec: () => materialForm() },
    { key: 'user', group: 'Set-up', label: 'User login', hint: 'Give someone access', icon: <UserPlus size={16} />, allowed: can('users', 'manage'), spec: () => userForm(l, standardRoles.filter((r) => r !== 'SUPER_ADMIN') as Role[]) },
  ].filter((i) => i.allowed);

  if (!items.length) return null;
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <div className="quick-add" ref={ref}>
      <button className="button button-primary button-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <Plus size={15} /> <span>New</span>
      </button>
      {open && (
        <div className="quick-add-menu" role="menu">
          {groups.map((g) => (
            <div key={g} style={{ display: 'contents' }}>
              <span>{g.toUpperCase()}</span>
              {items.filter((i) => i.group === g).map((i) => (
                <button
                  key={i.key}
                  role="menuitem"
                  disabled={!l && i.key !== 'order'}
                  onClick={() => {
                    setOpen(false);
                    if (i.key === 'order') setOrder(true);
                    else if (i.spec) setSpec(i.spec());
                  }}
                >
                  {i.icon}
                  <div><div>{i.label}</div><small>{i.hint}</small></div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
      {order && <NewOrderModal onClose={() => setOrder(false)} />}
    </div>
  );
}
