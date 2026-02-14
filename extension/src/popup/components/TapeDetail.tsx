import React, { useState } from 'react';
import type { TapeRecord } from '@popcorn/shared';
import styles from './TapeDetail.module.css';

interface TapeDetailProps {
  tape: TapeRecord;
  onBack: () => void;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 0) return `${seconds}s ago`;
  return 'Just now';
}

export function TapeDetail({ tape }: TapeDetailProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  const passedSteps = tape.steps.filter((s) => s.passed).length;
  const totalSteps = tape.steps.length;

  // Determine hero media source (priority: thumbnail > first screenshot > null)
  const heroImageUrl =
    tape.thumbnailDataUrl ||
    (tape.screenshots.length > 0 ? tape.screenshots[0].dataUrl : null);

  const hasVideo = Boolean(tape.videoUrl);

  const handleRerunWithRecording = async () => {
    setIsRerunning(true);
    setRerunError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'rerun_with_recording',
        payload: { tapeId: tape.id },
      });

      if (!response?.success) {
        setRerunError(response?.error || 'Re-run failed');
      }
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : 'Re-run failed');
    } finally {
      setIsRerunning(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {/* 1. Hero media */}
        {isPlaying && tape.videoUrl ? (
          <div className={styles.heroMedia}>
            <video
              autoPlay
              controls
              className={styles.videoPlayer}
              src={tape.videoUrl}
              onEnded={() => setIsPlaying(false)}
            >
              Your browser does not support video playback.
            </video>
          </div>
        ) : heroImageUrl ? (
          <div
            className={`${styles.heroMedia} ${hasVideo ? styles.heroClickable : ''}`}
            onClick={hasVideo ? () => setIsPlaying(true) : undefined}
            role={hasVideo ? 'button' : undefined}
            tabIndex={hasVideo ? 0 : undefined}
            onKeyDown={
              hasVideo
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setIsPlaying(true);
                    }
                  }
                : undefined
            }
          >
            <img
              src={heroImageUrl}
              alt={`${tape.demoName} preview`}
              className={styles.heroImage}
            />
            {hasVideo && (
              <div className={styles.playOverlay}>
                <span className={styles.playIcon}>{'\u25B6'}</span>
              </div>
            )}
            <span className={`${styles.statusDot} ${tape.passed ? styles.statusPass : styles.statusFail}`}>
              {tape.passed ? '✓' : '✗'}
            </span>
            {hasVideo && tape.videoUrl && (
              <a
                className={styles.downloadBtn}
                href={tape.videoUrl}
                download={`${tape.demoName}.${tape.videoMetadata?.mimeType?.startsWith('video/mp4') ? 'mp4' : 'webm'}`}
                onClick={(e) => e.stopPropagation()}
                title="Download video"
              >
                {'\u2193'}
              </a>
            )}
          </div>
        ) : null}

        {/* 2. Compact info row: name on left, time on right */}
        <div className={styles.infoRow}>
          <div className={styles.nameGroup}>
            <span className={styles.demoName}>{tape.demoName}</span>
          </div>
          <span className={styles.time}>
            {formatRelativeTime(tape.timestamp)}
          </span>
        </div>

        {/* 3. Stats row */}
        <div className={styles.statsRow}>
          <span className={styles.stat}>
            {passedSteps}/{totalSteps} steps passed
          </span>
          <span className={styles.statDot}>{'\u00B7'}</span>
          <span className={styles.stat}>{formatDuration(tape.duration)}</span>
        </div>

        {/* 4. Re-run button (compact inline) */}
        {!tape.videoUrl && tape.testPlan && (
          <div className={styles.rerunRow}>
            <button
              className={styles.rerunButton}
              onClick={handleRerunWithRecording}
              disabled={isRerunning}
            >
              {isRerunning ? 'Recording...' : <><span className={styles.recDot}>{'\u25CF'}</span>{' Re-run with Video Recording'}</>}
            </button>
            {rerunError && (
              <span className={styles.rerunError}>{rerunError}</span>
            )}
          </div>
        )}

        {/* 5. Summary (inline, truncated — matches HeroCard style) */}
        {tape.summary && (
          <p className={styles.summaryInline}>{tape.summary}</p>
        )}

        {/* 6. Steps */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Steps</h3>
          <div className={styles.steps}>
            {tape.steps.map((step) => (
              <div
                key={step.stepNumber}
                className={`${styles.step} ${step.passed ? styles.stepPassed : styles.stepFailed}`}
              >
                <div className={styles.stepHeader}>
                  <span className={styles.stepIcon}>
                    {step.passed ? '\u2713' : '\u2717'}
                  </span>
                  <span className={styles.stepNumber}>
                    Step {step.stepNumber}
                  </span>
                  <span className={styles.stepAction}>{step.action}</span>
                  <span className={styles.stepDuration}>
                    {formatDuration(step.duration)}
                  </span>
                </div>
                <p className={styles.stepDescription}>{step.description}</p>
                {step.error && (
                  <div className={styles.stepError}>
                    <span className={styles.stepErrorLabel}>Error:</span>
                    <span className={styles.stepErrorMessage}>
                      {step.error}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 7. Criteria results */}
        {tape.criteriaResults && tape.criteriaResults.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Criteria</h3>
            <div className={styles.criteria}>
              {tape.criteriaResults.map((cr, index) => (
                <div
                  key={cr.criterionId || index}
                  className={`${styles.criterion} ${cr.passed ? styles.criterionPassed : styles.criterionFailed}`}
                >
                  <span className={styles.criterionIcon}>
                    {cr.passed ? '\u2713' : '\u2717'}
                  </span>
                  <div className={styles.criterionBody}>
                    <span className={styles.criterionMessage}>{cr.message}</span>
                    {cr.evidence && (
                      <span className={styles.criterionEvidence}>{cr.evidence}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 8. Screenshots grid (if multiple — hero already shows primary image) */}
        {tape.screenshots.length > 1 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Screenshots</h3>
            <div className={styles.screenshots}>
              {tape.screenshots.map((screenshot, index) => (
                <div key={index} className={styles.screenshot}>
                  <img
                    src={screenshot.dataUrl}
                    alt={screenshot.label || `Step ${screenshot.stepNumber}`}
                    className={styles.screenshotImage}
                  />
                  <p className={styles.screenshotLabel}>
                    {screenshot.label || `Step ${screenshot.stepNumber}`}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Video metadata (shown below video player when playing) */}
        {isPlaying && tape.videoMetadata && (
          <p className={styles.videoMeta}>
            {tape.videoMetadata.filename} {'\u00B7'}{' '}
            {formatDuration(tape.videoMetadata.duration * 1000)} {'\u00B7'}{' '}
            {tape.videoMetadata.resolution.width}x
            {tape.videoMetadata.resolution.height}
          </p>
        )}
      </div>
    </div>
  );
}
