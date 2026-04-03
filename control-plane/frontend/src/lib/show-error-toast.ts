import { toast } from 'sonner';
import i18n from '../i18n';
import { ApiError } from '@/api/client';

/**
 * Show a translated error toast for API errors.
 * Checks for errorCode (e.g. PG_23505) and looks up i18n key `data:errors.<code>`.
 * Falls back to the raw error message if no translation is found.
 */
export function showErrorToast(err: Error): void {
  if (err instanceof ApiError && err.errorCode) {
    const key = `data:errors.${err.errorCode}`;
    const params: Record<string, string> = {};
    if (err.column) params.column = err.column;
    if (err.detail) params.detail = err.detail;
    if (err.constraint) params.constraint = err.constraint;
    if (err.table) params.table = err.table;

    const translated = i18n.t(key, { ...params, defaultValue: '' });
    if (translated) {
      toast.error(translated);
      return;
    }
  }

  toast.error(err.message);
}
