import type { ApiError } from '../api.ts'
import { t } from '../i18n/index.ts'

export function ErrorMessage({ error }: { error: ApiError }) {
  const errors: Record<string, string> = t.errors
  return <p className="error">{errors[error.code] ?? t.errors.internal}</p>
}
