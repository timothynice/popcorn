import { useState, useEffect } from 'react';

export type ExtensionStatus = 'idle' | 'recording' | 'processing' | 'error';

export interface ExtensionState {
  status: ExtensionStatus;
  connected: boolean;
  error: string | null;
  hookConnected: boolean;
}

export function useExtensionState() {
  const [status, setStatus] = useState<ExtensionStatus>('idle');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hookConnected, setHookConnected] = useState(false);

  useEffect(() => {
    // Check initial connection status
    chrome.runtime
      .sendMessage({ type: 'get_status' })
      .then((response) => {
        if (response?.status) {
          setStatus(response.status);
          setConnected(true);
          setError(null);
        }
      })
      .catch((err) => {
        setConnected(false);
        setError(err instanceof Error ? err.message : 'Connection failed');
      });

    chrome.runtime.sendMessage({ type: 'get_hook_status' })
      .then((response) => {
        if (response?.hookConnected !== undefined) {
          setHookConnected(response.hookConnected);
        }
      })
      .catch(() => {});

    // Listen for status updates from background script
    const messageListener = (
      message: any,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: any) => void,
    ) => {
      if (message.type === 'status_update') {
        setStatus(message.payload.status);
        setConnected(true);
        setError(message.payload.error || null);
      } else if (message.type === 'hook_status') {
        setHookConnected(message.payload.connected);
      } else if (message.type === 'start_demo') {
        setStatus('recording');
        setError(null);
      } else if (message.type === 'demo_result') {
        setStatus('idle');
        setError(null);
      } else if (message.type === 'hook_error' || message.type === 'demo_error') {
        setStatus('error');
        setError(message.payload.message);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Ping to check connection periodically
    const connectionCheckInterval = setInterval(() => {
      chrome.runtime
        .sendMessage({ type: 'ping' })
        .then(() => {
          setConnected(true);
        })
        .catch(() => {
          setConnected(false);
          setError('Extension disconnected');
        });
    }, 5000);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      clearInterval(connectionCheckInterval);
    };
  }, []);

  return {
    status,
    connected,
    error,
    hookConnected,
  };
}
