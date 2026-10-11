import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { useLookups } from '../../hooks/useFactory';
import { api } from '../../services/api';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Spinner } from '../../components/shared/common';
import { money, number, today } from '../../lib/utils';

interface NewOrderModalProps {
  onClose: () => void;
  // Set for buyers: they order for their own company only.
  buyerId?: string;
}

interface Line {
  recipeId: string;
  color: string;
  quantity: string;
}

// The day after today (factory time), the earliest allowed delivery date.
const tomorrow = () => {
  const d = new Date(`${today()}T12:00:00+05:30`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Ordering is simple on purpose: pick a material, give a colour and quantity, choose a date.
// Prices are fixed per material and shown here, never typed in.
export function NewOrderModal({ onClose, buyerId }: NewOrderModalProps) {
  const lookup = useLookups();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [buyer, setBuyer] = useState(buyerId ?? '');
  const [deadline, setDeadline] = useState(tomorrow());
  const [priority, setPriority] = useState('NORMAL');
  const [instructions, setInstructions] = useState('');
  const [lines, setLines] = useState<Line[]>([{ recipeId: '', color: '', quantity: '' }]);
  const [error, setError] = useState('');

  const recipes = lookup.data?.recipes ?? [];
  const recipeOf = (id: string) => recipes.find((r) => r.id === id);
  const lineTotal = (l: Line) => Number(recipeOf(l.recipeId)?.pricePerMetre ?? 0) * (Number(l.quantity) || 0);
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/orders', {
        buyerId: buyer,
        deadline,
        priority,
        instructions,
        items: lines.map((l) => ({ recipeId: l.recipeId, color: l.color, quantity: Number(l.quantity) })),
      }),
    onSuccess: (data) => {
      void client.invalidateQueries();
      toast.success(buyerId ? 'Order sent. The factory will review it.' : 'Order placed and planned for production.');
      onClose();
      navigate(`/orders/${data.id}`);
    },
    onError: (e) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!buyer) return setError('Choose the buyer.');
    if (deadline <= today()) return setError('The delivery date must be after today.');
    for (const l of lines) {
      if (!l.recipeId) return setError('Choose a material for every line.');
      if (!l.color.trim()) return setError('Enter a colour for every line.');
      if (!(Number(l.quantity) > 0)) return setError('Quantity must be more than zero.');
    }
    create.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={buyerId ? 'Place an order' : 'New customer order'}
      description={buyerId ? 'Choose the material, colour, quantity and delivery date.' : 'Prices are fixed per material.'}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          {!buyerId && (
            <label className="field">
              <span>Buyer *</span>
              <select value={buyer} onChange={(e) => setBuyer(e.target.value)}>
                <option value="">Select a buyer</option>
                {lookup.data?.buyers.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Delivery date *</span>
            <input type="date" value={deadline} min={tomorrow()} onChange={(e) => setDeadline(e.target.value)} />
            <small>Earliest: {tomorrow()}</small>
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </label>
        </div>

        <div className="line-items">
          {lines.map((line, index) => {
            const recipe = recipeOf(line.recipeId);
            return (
              <div className="line-item" key={index}>
                <div className="line-item-heading">
                  <strong>Item {index + 1}</strong>
                  {lines.length > 1 && (
                    <button type="button" className="icon-button" onClick={() => setLines(lines.filter((_, i) => i !== index))} aria-label="Remove item">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <div className="form-grid">
                  <label className="field">
                    <span>Material *</span>
                    <select value={line.recipeId} onChange={(e) => setLine(index, { recipeId: e.target.value })}>
                      <option value="">Choose a material</option>
                      {recipes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · {money(r.pricePerMetre)}/m
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Colour *</span>
                    <input value={line.color} onChange={(e) => setLine(index, { color: e.target.value })} placeholder="e.g. Sage green" />
                  </label>
                  <label className="field">
                    <span>Quantity (metres) *</span>
                    <input type="number" min={1} step="1" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
                  </label>
                  <div className="field">
                    <span>Price</span>
                    <strong style={{ fontSize: 15, padding: '10px 0' }}>
                      {recipe ? `${money(recipe.pricePerMetre)} / m · ${money(lineTotal(line))}` : '—'}
                    </strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0' }}>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, { recipeId: '', color: '', quantity: '' }])}>
            <Plus size={14} />
            Add another item
          </Button>
          <strong style={{ fontSize: 16 }}>Order total: {money(total)}</strong>
        </div>

        <label className="field">
          <span>Special instructions</span>
          <textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Finishing, packaging or delivery notes" />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <div className="dialog-footer">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plus size={15} />}
            {buyerId ? `Send order (${number(lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0))} m)` : 'Create order'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
