import React from 'react';
import { createRoot } from 'react-dom/client';
import '@renderer/styles/capture-overlay.css';
import { CaptureOverlayApp } from './CaptureOverlayApp';
import { ErrorBoundary } from '@renderer/shared/ErrorBoundary';
import { installErrorReporting } from '@renderer/shared/installErrorReporting';

const container = document.getElementById('capture-overlay-root');
if (!container) {
  console.error('Capture overlay root element not found!');
} else {
  installErrorReporting();
  createRoot(container).render(
    <React.StrictMode>
      <ErrorBoundary>
        <CaptureOverlayApp />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
