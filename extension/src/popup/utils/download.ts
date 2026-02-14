import type { ScreenshotCapture } from '@popcorn/shared';

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    buffer[i] = bytes.charCodeAt(i);
  }
  return new Blob([buffer], { type: mime });
}

export async function downloadAllScreenshotsZip(
  screenshots: ScreenshotCapture[],
  demoName: string,
): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (const screenshot of screenshots) {
    const blob = dataUrlToBlob(screenshot.dataUrl);
    const ext = screenshot.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    const label = screenshot.label || `step-${screenshot.stepNumber}`;
    const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    zip.file(`${safeName}.${ext}`, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${demoName}-screenshots.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
