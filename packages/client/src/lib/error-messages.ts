import i18n from '../i18n';

function tCommon(key: string, defaultValue: string) {
  return i18n.t(key, { ns: 'common', defaultValue });
}

export function normalizeErrorCode(code: unknown, status?: number): string {
  if (typeof code === 'string' && code.trim().length > 0) return code;

  switch (status) {
    case 400:
      return 'INVALID_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMIT_EXCEEDED';
    default:
      break;
  }

  if (typeof status === 'number' && status >= 500) {
    return 'INTERNAL_ERROR';
  }

  return 'UNKNOWN_ERROR';
}

export function getLocalizedErrorMessage(args: {
  code?: unknown;
  status?: number;
  fallbackMessage?: string;
}): string {
  const normalizedCode = normalizeErrorCode(args.code, args.status);

  const key = `errors.${normalizedCode}`;
  if (i18n.exists(key, { ns: 'common' })) {
    return i18n.t(key, { ns: 'common' });
  }

  const fallback = (args.fallbackMessage || '').trim();
  if (fallback) return fallback;

  return tCommon('errors.UNKNOWN_ERROR', 'Unknown error');
}

export function getFetchExceptionCode(error: unknown): 'REQUEST_ABORTED' | 'NETWORK_ERROR' {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (name === 'AbortError') return 'REQUEST_ABORTED';
  }
  return 'NETWORK_ERROR';
}

export function getFetchExceptionMessage(error: unknown): string {
  const code = getFetchExceptionCode(error);
  return getLocalizedErrorMessage({ code });
}

export function getUnknownErrorMessage(): string {
  return tCommon('errors.UNKNOWN_ERROR', 'Unknown error');
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  return getUnknownErrorMessage();
}

