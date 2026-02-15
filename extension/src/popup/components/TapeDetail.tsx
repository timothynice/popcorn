import React, { useState } from 'react';
import type { TapeRecord } from '@popcorn/shared';
import { ExpandableStep } from './ExpandableStep';
import { Lightbox } from './Lightbox';
import { downloadAllScreenshotsZip } from '../utils/download';
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showCopiedFeedback, setShowCopiedFeedback] = useState(false);

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

  const handleHeroClick = () => {
    if (hasVideo) {
      setIsPlaying(true);
    } else if (tape.screenshots.length > 0) {
      setLightboxIndex(0);
    }
  };

  const handleScreenshotClick = (dataUrl: string) => {
    const index = tape.screenshots.findIndex((s) => s.dataUrl === dataUrl);
    if (index >= 0) {
      setLightboxIndex(index);
    }
  };

  const handleExportScreenshots = () => {
    downloadAllScreenshotsZip(tape.screenshots, tape.demoName);
  };

  const handleExportJSON = () => {
    const data = {
      id: tape.id,
      testPlanId: tape.testPlanId,
      timestamp: tape.timestamp,
      duration: tape.duration,
      passed: tape.passed,
      summary: tape.summary,
      steps: tape.steps,
      criteriaResults: tape.criteriaResults,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tape.testPlanId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopySummary = async () => {
    const passedCount = tape.steps.filter((s) => s.passed).length;
    const failedCount = tape.steps.length - passedCount;

    const text = `# ${tape.testPlanId}\n${tape.summary || ''}\nSteps: ${tape.steps.length} (${passedCount} passed, ${failedCount} failed)\nDuration: ${formatDuration(tape.duration)}`;

    try {
      await navigator.clipboard.writeText(text);
      setShowCopiedFeedback(true);
      setTimeout(() => setShowCopiedFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
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
            className={`${styles.heroMedia} ${styles.heroClickable}`}
            onClick={handleHeroClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleHeroClick();
              }
            }}
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
              {tape.passed ? '\u2713' : '\u2717'}
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

        {/* 6. Export row */}
        <div className={styles.exportRow}>
          <button className={styles.exportButton} onClick={handleExportJSON}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 1.5v7M3 6.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M1.5 10.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Summary JSON
          </button>
          <button className={styles.copyButton} onClick={handleCopySummary} title="Copy summary to clipboard">
            {showCopiedFeedback ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3.5 7.5l2 2 5-5" stroke="var(--accent-green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M9.5 4.5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5.5a1 1 0 001 1h1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
        </div>

        {/* 7. Steps */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Steps</h3>
          <div className={styles.steps}>
            {tape.steps.map((step) => (
              <ExpandableStep
                key={step.stepNumber}
                step={step}
                onScreenshotClick={handleScreenshotClick}
              />
            ))}
          </div>
        </section>

        {/* 8. Criteria results */}
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

        {/* 9. Screenshots grid (if multiple — hero already shows primary image) */}
        {tape.screenshots.length > 1 && (
          <section className={styles.section}>
            <div className={styles.screenshotHeader}>
              <h3 className={styles.sectionTitle}>Screenshots</h3>
              <button
                className={styles.downloadAllBtn}
                onClick={() => downloadAllScreenshotsZip(tape.screenshots, tape.demoName)}
                title="Download all screenshots as ZIP"
              >
                {'\u2193'} All (ZIP)
              </button>
            </div>
            <div className={styles.screenshots}>
              {tape.screenshots.map((screenshot, index) => (
                <div
                  key={index}
                  className={styles.screenshot}
                  onClick={() => setLightboxIndex(index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setLightboxIndex(index);
                    }
                  }}
                >
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

      {/* Lightbox */}
      {lightboxIndex !== null && tape.screenshots.length > 0 && (
        <Lightbox
          screenshots={tape.screenshots}
          currentIndex={lightboxIndex}
          demoName={tape.demoName}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
