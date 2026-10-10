let csrf = '';

export function setCsrf(value: string) {
  csrf = value;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  method?: string
): Promise<T> {
  const isRead = body === undefined;
  const httpMethod = method ?? (isRead ? 'GET' : 'POST');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (!isRead) {
    headers['X-CSRF-Token'] = csrf;
    headers['Idempotency-Key'] = crypto.randomUUID();
  }

  const response = await fetch(`/api/v1${path}`, {
    method: httpMethod,
    credentials: 'include',
    headers,
    body: isRead ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let result: ({ error?: { message?: string } } & Record<string, unknown>) | null = null;

  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = null;
  }

  if (!response.ok) {
    const message = result?.error?.message ?? (text.trim() || 'Something went wrong.');
    throw new ApiError(response.status, message);
  }

  return result as unknown as T;
}

