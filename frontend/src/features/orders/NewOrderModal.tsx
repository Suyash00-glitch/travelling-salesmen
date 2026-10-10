import { useNavigate } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { orderSchema, type OrderInput } from '@loomos/shared';
import { useLookups } from '../../hooks/useFactory';
import { api } from '../../services/api';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Spinner } from '../../components/shared/common';
import { today } from '../../lib/utils';

interface NewOrderModalProps {
  onClose: () => void;
}

export function NewOrderModal({ onClose }: NewOrderModalProps) {
  const lookup = useLookups();
  const client = useQueryClient();
  const navigate = useNavigate();

  const form = useForm<OrderInput>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      buyerId: '',
      deadline: today(),
      priority: 'NORMAL',
      instructions: '',
      items: [{ recipeId: '', fabric: '', color: '', quantity: 1000, price: 200 }],
    },
  });

  const items = useFieldArray({
    control: form.control,
    name: 'items',
  });

  const create = useMutation({
    mutationFn: (body: OrderInput) => api<{ id: string }>('/orders', body),
    onSuccess: (data) => {
      void client.invalidateQueries();
      toast.success('Order created. Ready to plan production.');
      onClose();
      navigate(`/orders/${data.id}`);
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="A new order starts here"
      description="Add the buyer, fabric specifications and delivery commitment."
      wide
    >
      <form onSubmit={form.handleSubmit((data) => create.mutate(data))}>
        <div className="form-grid">
          <label className="field">
            <span>Buyer *</span>
            <select {...form.register('buyerId')}>
              <option value="">Select a buyer</option>
              {lookup.data?.buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Delivery deadline *</span>
            <input type="date" {...form.register('deadline')} />
          </label>
          <label className="field">
            <span>Priority</span>
            <select {...form.register('priority')}>
              <option>NORMAL</option>
              <option>HIGH</option>
              <option>URGENT</option>
            </select>
          </label>
        </div>

        <div className="line-items">
          {items.fields.map((item, index) => (
            <div className="line-item" key={item.id}>
              <div className="line-item-heading">
                <strong>Fabric item {index + 1}</strong>
                {items.fields.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => items.remove(index)}
                    aria-label="Remove fabric item"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Production recipe *</span>
                  <select
                    {...form.register(`items.${index}.recipeId`)}
                    onChange={(e) => {
                      form.setValue(`items.${index}.recipeId`, e.target.value);
                      form.setValue(
                        `items.${index}.fabric`,
                        lookup.data?.recipes.find((r) => r.id === e.target.value)?.name ?? '',
                      );
                    }}
                  >
                    <option value="">Choose a fabric recipe</option>
                    {lookup.data?.recipes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Fabric description *</span>
                  <input {...form.register(`items.${index}.fabric`)} />
                </label>
                <label className="field">
                  <span>Colour *</span>
                  <input
                    {...form.register(`items.${index}.color`)}
                    placeholder="e.g. Sage green"
                  />
                </label>
                <label className="field">
                  <span>Quantity (metres) *</span>
                  <input
                    type="number"
                    step="0.001"
                    {...form.register(`items.${index}.quantity`)}
                  />
                </label>
                <label className="field">
                  <span>Price / metre (₹) *</span>
                  <input
                    type="number"
                    step="0.01"
                    {...form.register(`items.${index}.price`)}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            items.append({ recipeId: '', fabric: '', color: '', quantity: 500, price: 200 })
          }
        >
          <Plus size={14} />
          Add fabric item
        </Button>

        <label className="field mt-4">
          <span>Special instructions</span>
          <textarea
            rows={2}
            {...form.register('instructions')}
            placeholder="Finishing, packaging or buyer requirements…"
          />
        </label>

        {Object.keys(form.formState.errors).length > 0 && (
          <div className="error-banner">
            Complete all required fields with valid quantities, prices, and a delivery date.
          </div>
        )}
        {create.error && <div className="error-banner">{create.error.message}</div>}

        <div className="dialog-footer">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plus size={15} />}
            Create order
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Backwards compatibility alias
export const NewOrder = NewOrderModal;
