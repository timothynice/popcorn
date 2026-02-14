import React from 'react';
import styles from './DemoProgress.module.css';

interface DemoProgressProps {
  currentStep: number;
  totalSteps: number;
  stepDescription: string;
}

export function DemoProgress({ currentStep, totalSteps, stepDescription }: DemoProgressProps) {
  const progress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.label}>Running Demo</span>
        <span className={styles.count}>{currentStep} / {totalSteps}</span>
      </div>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>
      <p className={styles.description}>{stepDescription}</p>
    </div>
  );
}
