import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Lookups, Notice } from '@loomos/shared';
import { toast } from 'sonner';
import { api } from '../services/api';

export function useData<T>(path: string, enabled = true) {
  return useQuery({
    queryKey: [path],
    queryFn: () => api<T>(path),
    enabled,
  });
}

export const useLookups = () => useData<Lookups>('/lookups');

export function useAction() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ path, body = {} }: { path: string; body?: unknown }) =>
      api(path, body),
    onSuccess: () => {
      void client.invalidateQueries();
      toast.success('Factory workspace updated');
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });
}

// Keeps every open screen in sync: when anyone changes something, the server
// sends a small event and we refresh all loaded data.
export function useLiveUpdates() {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/v1/events', { withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // the browser retries automatically

    source.onmessage = () => {
      // Several changes often arrive together; refresh once.
      clearTimeout(timer);
      timer = setTimeout(() => void client.invalidateQueries(), 250);
    };

    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [client]);

  return connected;
}

// Pops a toast when new work lands in this user's inbox (e.g. "ready for weaving").
export function useInboxToasts(notices: Notice[] | undefined) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!notices) return;
    if (seen.current) {
      for (const n of notices) {
        if (!seen.current.has(n.id)) toast.info(n.title, { description: n.description });
      }
    }
    seen.current = new Set(notices.map((n) => n.id));
  }, [notices]);
}
