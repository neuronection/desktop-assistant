import type { ConnectorService } from './ConnectorService';

// Composition-root seam: the tool registry is built before the IPC composition
// root, so the calendar tools resolve the ConnectorService lazily at exec time.

let provider: (() => ConnectorService) | null = null;

export function setConnectorServiceProvider(get: () => ConnectorService): void {
  provider = get;
}

export function getConnectorService(): ConnectorService {
  if (!provider) {
    throw new Error('Calendar connectors are not initialized.');
  }
  return provider();
}
