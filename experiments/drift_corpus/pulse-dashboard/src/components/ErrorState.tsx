import type { ReactElement } from 'react';

/**
 * Inline error state with a retry control (PRD R9). Rendered by a view when its
 * own fetch fails, so other views are unaffected.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <div className="error-state" role="alert">
      <p>Something went wrong: {message}</p>
      <button onClick={onRetry}>Retry</button>
    </div>
  );
}

