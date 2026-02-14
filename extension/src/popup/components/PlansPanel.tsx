import React, { useState, useEffect } from 'react';
import type { TestPlan } from '@popcorn/shared';
import styles from './PlansPanel.module.css';

interface PlansPanelProps {
  onBack: () => void;
  hookConnected: boolean;
  onRunPlan: (plan: TestPlan) => void;
}

export function PlansPanel({ onBack, hookConnected, onRunPlan }: PlansPanelProps) {
  const [plans, setPlans] = useState<string[]>([]);
  const [selectedPlanName, setSelectedPlanName] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<TestPlan | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (hookConnected) {
      setLoadingList(true);
      setListError(null);
      chrome.runtime.sendMessage({ type: 'get_plans' })
        .then((response) => {
          if (response?.success && response.plans) {
            setPlans(response.plans);
          } else {
            setListError(response?.error || 'Failed to load plans');
          }
        })
        .catch((err) => {
          setListError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setLoadingList(false);
        });
    }
  }, [hookConnected]);

  const handleSelectPlan = (planName: string) => {
    setSelectedPlanName(planName);
    setLoadingDetail(true);
    setDetailError(null);
    setSelectedPlan(null);

    chrome.runtime.sendMessage({ type: 'get_plan', payload: { planName } })
      .then((response) => {
        if (response?.success && response.plan) {
          setSelectedPlan(response.plan);
        } else {
          setDetailError(response?.error || 'Failed to load plan');
        }
      })
      .catch((err) => {
        setDetailError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoadingDetail(false);
      });
  };

  const handleRunPlan = () => {
    if (selectedPlan) {
      onRunPlan(selectedPlan);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack} aria-label="Back to feed">
          {'\u2190'} Back
        </button>
        <h2 className={styles.title}>Test Plans</h2>
      </div>

      {!hookConnected ? (
        <div className={styles.content}>
          <p className={styles.notConnected}>Hook not connected</p>
        </div>
      ) : (
        <div className={styles.masterDetail}>
          <div className={styles.listPanel}>
            {loadingList && <p className={styles.loading}>Loading...</p>}
            {listError && <p className={styles.error}>{listError}</p>}
            {!loadingList && !listError && plans.length === 0 && (
              <p className={styles.empty}>No test plans found</p>
            )}
            {!loadingList && !listError && plans.length > 0 && (
              <div className={styles.planList}>
                {plans.map((planName) => (
                  <button
                    key={planName}
                    className={`${styles.planItem} ${selectedPlanName === planName ? styles.selected : ''}`}
                    onClick={() => handleSelectPlan(planName)}
                  >
                    {planName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.detailPanel}>
            {!selectedPlanName && (
              <p className={styles.noSelection}>Select a plan to view details</p>
            )}
            {loadingDetail && (
              <p className={styles.loading}>Loading plan...</p>
            )}
            {detailError && (
              <p className={styles.error}>{detailError}</p>
            )}
            {selectedPlan && !loadingDetail && (
              <div className={styles.planDetail}>
                <h3 className={styles.planName}>{selectedPlan.planName}</h3>
                {selectedPlan.description && (
                  <p className={styles.planDescription}>{selectedPlan.description}</p>
                )}
                <div className={styles.planMeta}>
                  <span className={styles.metaItem}>
                    {selectedPlan.steps.length} step{selectedPlan.steps.length !== 1 ? 's' : ''}
                  </span>
                  {selectedPlan.tags && selectedPlan.tags.length > 0 && (
                    <div className={styles.tags}>
                      {selectedPlan.tags.map((tag, idx) => (
                        <span key={idx} className={styles.tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.stepsList}>
                  <h4 className={styles.stepsTitle}>Steps:</h4>
                  {selectedPlan.steps.map((step) => (
                    <div key={step.stepNumber} className={styles.stepItem}>
                      <span className={styles.stepNumber}>{step.stepNumber}.</span>
                      <div className={styles.stepContent}>
                        <span className={styles.stepAction}>{step.action}</span>
                        <span className={styles.stepDescription}>{step.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button className={styles.runButton} onClick={handleRunPlan}>
                  Run Plan
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
