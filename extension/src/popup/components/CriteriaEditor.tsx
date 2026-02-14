import React from 'react';
import styles from './CriteriaEditor.module.css';

interface CriteriaEditorProps {
  criteria: string[];
  onChange: (criteria: string[]) => void;
  readOnly?: boolean;
}

export function CriteriaEditor({ criteria, onChange, readOnly = false }: CriteriaEditorProps) {
  const handleCriterionChange = (index: number, value: string) => {
    const updated = [...criteria];
    updated[index] = value;
    onChange(updated);
  };

  const handleAddCriterion = () => {
    onChange([...criteria, '']);
  };

  const handleRemoveCriterion = (index: number) => {
    onChange(criteria.filter((_, i) => i !== index));
  };

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {criteria.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyMessage}>No criteria defined yet.</p>
            {!readOnly && (
              <p className={styles.emptyHint}>
                Add criteria to define what should be tested.
              </p>
            )}
          </div>
        )}
        {criteria.map((criterion, index) => (
          <div key={index} className={styles.criterionRow}>
            <span className={styles.bulletNumber}>{index + 1}.</span>
            {readOnly ? (
              <div className={styles.criterionText}>{criterion}</div>
            ) : (
              <input
                type="text"
                value={criterion}
                onChange={(e) => handleCriterionChange(index, e.target.value)}
                className={styles.criterionInput}
                placeholder="e.g. Page loads without errors"
              />
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => handleRemoveCriterion(index)}
                className={styles.removeButton}
                aria-label="Remove rule"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={handleAddCriterion}
          className={styles.addButton}
        >
          + Add rule
        </button>
      )}
    </div>
  );
}
