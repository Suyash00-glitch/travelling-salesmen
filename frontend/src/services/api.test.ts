import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, setCsrf, ApiError } from './api.js';

describe('Web App API Service (api.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('instantiates ApiError correctly', () => {
    const err = new ApiError(403, 'Permission denied');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(403);
    expect(err.message).toBe('Permission denied');
  });

  it('performs GET request without body and without CSRF header', async () => {
    const mockData = { id: 'order-1', number: 'SO-101' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockData)),
    });
    globalThis.fetch = fetchMock;

    const result = await api('/orders/order-1');
    expect(result).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/orders/order-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        body: undefined,
      }),
    );
  });

  it('attaches CSRF token and Idempotency key on POST with body', async () => {
    setCsrf('csrf-token-abc');
    const mockResponse = { id: 'created-1' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
    });
    globalThis.fetch = fetchMock;

    const payload = { title: 'Test Order' };
    const result = await api('/orders', payload);
    expect(result).toEqual(mockResponse);

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe('/api/v1/orders');
    expect(callArgs[1].method).toBe('POST');
    expect(callArgs[1].headers['X-CSRF-Token']).toBe('csrf-token-abc');
    expect(callArgs[1].headers['Idempotency-Key']).toBeDefined();
    expect(callArgs[1].body).toBe(JSON.stringify(payload));
  });

  it('throws ApiError with error message on failed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Material shortage' } })),
    });
    globalThis.fetch = fetchMock;

    await expect(api('/production/start', { machineId: 'm1' })).rejects.toThrow(ApiError);
    await expect(api('/production/start', { machineId: 'm1' })).rejects.toThrow('Material shortage');
  });

  it('handles plain text error response gracefully without JSON parse crash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('Too many requests, please slow down.'),
    });
    globalThis.fetch = fetchMock;

    await expect(api('/login', { email: 'test@example.com' })).rejects.toThrow(ApiError);
    await expect(api('/login', { email: 'test@example.com' })).rejects.toThrow('Too many requests, please slow down.');
  });
});
