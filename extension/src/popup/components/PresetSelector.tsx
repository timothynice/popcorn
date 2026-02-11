import React, { useState } from 'react';
import styles from './PresetSelector.module.css';

interface PresetSelectorProps {
  onSelect: (criteria: string[]) => void;
}

interface Preset {
  id: string;
  name: string;
  criteria: string[];
}

const PRESETS: Preset[] = [
  {
    id: 'forms',
    name: 'Forms',
    criteria: [
      'All form inputs have associated labels',
      'Required fields show validation when left empty',
      'Form submits successfully with valid data',
      'Success message displays after valid submission',
      'Error messages display for invalid inputs',
    ],
  },
  {
    id: 'navigation',
    name: 'Navigation',
    criteria: [
      'All navigation links resolve to valid pages',
      'No 404 or error pages encountered during navigation',
      'Breadcrumbs reflect the current page correctly',
      'Page transitions complete without errors',
    ],
  },
  {
    id: 'authentication',
    name: 'Authentication',
    criteria: [
      'Login succeeds with valid credentials and redirects correctly',
      'Session persists when navigating between pages',
      'Logout clears the session and redirects to login',
      'Error message shown for invalid login credentials',
      'Protected pages redirect unauthenticated users to login',
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    criteria: [],
  },
];

export function PresetSelector({ onSelect }: PresetSelectorProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const presetId = e.target.value;
    setSelectedPresetId(presetId);

    const preset = PRESETS.find((p) => p.id === presetId);
    if (preset) {
      onSelect(preset.criteria);
    }
  };

  return (
    <div className={styles.container}>
      <label htmlFor="preset-selector" className={styles.label}>
        Preset
      </label>
      <select
        id="preset-selector"
        value={selectedPresetId}
        onChange={handleChange}
        className={styles.select}
      >
        <option value="">Select a preset...</option>
        {PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
    </div>
  );
}
