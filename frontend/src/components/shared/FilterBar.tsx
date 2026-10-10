import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../ui/button';

// A row of simple dropdown and date filters. Values live in the page URL
// (e.g. /batches?status=REWORK&buyerId=…) so a filtered view can be bookmarked or shared.

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDef {
  name: string;
  label: string;
  // Dropdown filters have options; date filters use type "date".
  options?: FilterOption[];
  type?: 'select' | 'date';
}

export function useFilters(names: string[]) {
  const [params, setParams] = useSearchParams();
  const values: Record<string, string> = {};
  for (const name of names) values[name] = params.get(name) ?? '';

  const setValue = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  const clear = () => {
    const next = new URLSearchParams(params);
    names.forEach((n) => next.delete(n));
    setParams(next, { replace: true });
  };

  // "a=1&b=2" with only the filters that are set, ready to add to an API path.
  const query = names
    .filter((n) => values[n])
    .map((n) => `${n}=${encodeURIComponent(values[n])}`)
    .join('&');

  return { values, setValue, clear, query, active: names.filter((n) => values[n]).length };
}

export function FilterBar({
  filters,
  values,
  onChange,
  onClear,
  active,
  visible = 4,
}: {
  filters: FilterDef[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onClear: () => void;
  active: number;
  // How many filters to show before "More filters". Hidden filters that are set stay visible.
  visible?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = filters.filter((f, i) => showAll || i < visible || values[f.name]);
  const hidden = filters.length - shown.length;

  return (
    <div className="filter-bar">
      {shown.map((f) => (
        <label key={f.name} className="filter-field">
          <span>{f.label}</span>
          {f.type === 'date' ? (
            <input type="date" value={values[f.name] ?? ''} onChange={(e) => onChange(f.name, e.target.value)} />
          ) : (
            <select value={values[f.name] ?? ''} onChange={(e) => onChange(f.name, e.target.value)}>
              <option value="">All</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </label>
      ))}
      {(hidden > 0 || showAll) && filters.length > visible && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)} className="filter-clear">
          <SlidersHorizontal size={14} />
          {showAll ? 'Fewer filters' : `More filters (${hidden})`}
        </Button>
      )}
      {active > 0 && (
        <Button variant="outline" size="sm" onClick={onClear} className="filter-clear">
          <X size={14} />
          Clear {active} filter{active > 1 ? 's' : ''}
        </Button>
      )}
    </div>
  );
}
