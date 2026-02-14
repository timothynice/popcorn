import React, { useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { ScreenshotCapture } from '@popcorn/shared';
import { downloadDataUrl, downloadAllScreenshotsZip } from '../utils/download';
import styles from './Lightbox.module.css';

interface LightboxProps {
  screenshots: ScreenshotCapture[];
  currentIndex: number;
  demoName: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function Lightbox({ screenshots, currentIndex, demoName, onClose, onNavigate }: LightboxProps) {
  const current = screenshots[currentIndex];
  const hasMultiple = screenshots.length > 1;

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  const goNext = useCallback(() => {
    if (currentIndex < screenshots.length - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, screenshots.length, onNavigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, goPrev, goNext]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleDownloadCurrent = () => {
    const label = current.label || `step-${current.stepNumber}`;
    const ext = current.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    downloadDataUrl(current.dataUrl, `${demoName}-${label}.${ext}`);
  };

  const handleDownloadAll = async () => {
    await downloadAllScreenshotsZip(screenshots, demoName);
  };

  return ReactDOM.createPortal(
    <div className={styles.overlay} onClick={handleOverlayClick} role="dialog" aria-label="Screenshot viewer">
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button className={styles.toolbarButton} onClick={handleDownloadCurrent} title="Download this screenshot">
            {'\u2193'} Save
          </button>
          {hasMultiple && (
            <button className={styles.toolbarButton} onClick={handleDownloadAll} title="Download all as ZIP">
              {'\u2193'} All (ZIP)
            </button>
          )}
        </div>
        <div className={styles.toolbarRight}>
          <button className={`${styles.toolbarButton} ${styles.closeButton}`} onClick={onClose} aria-label="Close" title="Close">
            {'\u00D7'}
          </button>
        </div>
      </div>

      <div className={styles.imageContainer} onClick={handleOverlayClick}>
        {hasMultiple && currentIndex > 0 && (
          <button className={`${styles.navButton} ${styles.navPrev}`} onClick={goPrev} aria-label="Previous screenshot">
            {'\u2039'}
          </button>
        )}
        <img
          src={current.dataUrl}
          alt={current.label || `Step ${current.stepNumber}`}
          className={styles.image}
        />
        {hasMultiple && currentIndex < screenshots.length - 1 && (
          <button className={`${styles.navButton} ${styles.navNext}`} onClick={goNext} aria-label="Next screenshot">
            {'\u203A'}
          </button>
        )}
      </div>

      <div className={styles.caption}>
        <span className={styles.captionText}>
          {current.label || `Step ${current.stepNumber}`}
        </span>
        {hasMultiple && (
          <span className={styles.counter}>
            {currentIndex + 1} / {screenshots.length}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
