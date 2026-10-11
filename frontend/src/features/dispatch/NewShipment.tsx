import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Truck, PackageCheck } from 'lucide-react';
import type { OrderSummary, RollSummary, PageResponse } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { api } from '../../services/api';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Empty, Spinner } from '../../components/shared/common';
import { number } from '../../lib/utils';

export function NewShipment({ onClose }: { onClose: () => void }) {
  const orders = useData<PageResponse<OrderSummary>>('/orders?pageSize=100');
  const rolls = useData<PageResponse<RollSummary>>('/rolls?pageSize=100');
  const [orderId, setOrderId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [transport, setTransport] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const client = useQueryClient();

  // Rolls made for this order, plus finished stock of a fabric the order asked for.
  const order = orders.data?.data.find((o) => o.id === orderId);
  const orderRecipes = order?.items.map((i) => i.recipeId) ?? [];
  const available =
    rolls.data?.data.filter(
      (r) =>
        r.quality === 'PASSED' &&
        !r.activeShipmentId &&
        (r.production.order
          ? r.production.order.id === orderId
          : orderRecipes.includes(r.production.recipeId)),
    ) ?? [];

  const mutation = useMutation({
    mutationFn: () => api('/shipments', { orderId, rollIds: selected, transport, driverName, driverPhone }),
    onSuccess: () => {
      void client.invalidateQueries();
      toast.success('Dispatch created. Verify each roll before confirming.');
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Prepare a dispatch"
      description="Only available, quality-approved rolls can be selected."
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Buyer order *</span>
            <select
              required
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
                setSelected([]);
              }}
            >
              <option value="">Select an order</option>
              {orders.data?.data
                .filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number} · {o.buyer.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Truck number *</span>
            <input
              required
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="e.g. PB-10-GT-4521"
            />
          </label>
          <label className="field">
            <span>Driver name</span>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. Gurpreet Singh" />
          </label>
          <label className="field">
            <span>Driver phone</span>
            <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="+91 …" />
          </label>
        </div>

        <div className="roll-selection">
          {available.map((r) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, r.id] : s.filter((id) => id !== r.id),
                  )
                }
              />
              <span className="roll-icon">
                <PackageCheck size={20} />
              </span>
              <div>
                <strong>{r.code}</strong>
                <small>
                  {r.production.fabric} · {r.production.color}
                  {!r.production.order && ' · from stock'}
                </small>
              </div>
              <b>{number(r.length)} m</b>
            </label>
          ))}
          {!available.length && (
            <Empty
              title={orderId ? 'No available rolls for this order' : 'Choose a buyer order'}
              description="Passed, unreserved rolls will appear here."
            />
          )}
        </div>

        <div className="selection-total">
          {selected.length} rolls selected
          <strong>
            {number(
              available
                .filter((r) => selected.includes(r.id))
                .reduce((s, r) => s + Number(r.length), 0),
            )}{' '}
            m
          </strong>
        </div>

        {mutation.error && (
          <div className="error-banner">{mutation.error.message}</div>
        )}

        <div className="dialog-footer">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!selected.length || mutation.isPending}>
            {mutation.isPending ? <Spinner /> : <Truck size={16} />}
            Create dispatch
          </Button>
        </div>
      </form>
    </Modal>
  );
}
