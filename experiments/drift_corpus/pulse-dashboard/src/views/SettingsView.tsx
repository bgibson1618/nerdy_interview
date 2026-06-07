import { useState, type ReactElement } from 'react';
import { config, flags } from '../config';
import type { DateRange } from '../types';

const RANGES: DateRange[] = ['24h', '7d', '30d'];

/** Settings route `/settings` — date range, theme toggle, flag status (PRD R5, R7). */
export function SettingsView(): ReactElement {
  const [range, setRange] = useState<DateRange>(config.defaultDateRange);
  const [dark, setDark] = useState(flags.enableDarkMode);

  return (
    <section>
      <h1>Settings</h1>

      <label>
        Date range
        <select value={range} onChange={(e) => setRange(e.target.value as DateRange)}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      {flags.enableDarkMode && (
        <label>
          Dark mode
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
        </label>
      )}

      <p className="settings__flags">
        Export: {flags.enableExport ? 'on' : 'off'} · Dark mode:{' '}
        {flags.enableDarkMode ? 'on' : 'off'}
      </p>
    </section>
  );
}

