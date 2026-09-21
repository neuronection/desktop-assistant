import type { DigestProvider, DigestRow } from '../context-digests';

/**
 * Home Assistant context provider (plan 23 S3/S5 reference): one live
 * context/states call becomes an entity digest. Matches the bundled
 * preset's read-only context tool by suffix so domain-prefixed
 * namespacing (`mcp__homeassistant__*_HassGetLiveContext`) still finds
 * it.
 */
export const homeAssistantDigestProvider: DigestProvider = {
  toolCandidates: ['HassGetLiveContext', 'GetLiveContext', 'HassGetStates', 'HassGetState', 'HassSearch'],
  render(payload: unknown): DigestRow[] | null {
    const parsed = parsePayload(payload);
    if (!parsed) {
      return null;
    }
    const states = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { states?: unknown }).states) ? ((parsed as { states: unknown[] }).states) : null;
    if (!states) {
      return null;
    }
    const rows: DigestRow[] = [];
    for (const state of states) {
      if (!state || typeof state !== 'object') {
        continue;
      }
      const record = state as Record<string, unknown>;
      const id = typeof record.entity_id === 'string' ? record.entity_id : typeof record.id === 'string' ? record.id : '';
      if (!id) {
        continue;
      }
      const attributes = (record.attributes ?? {}) as Record<string, unknown>;
      const label =
        firstString(record.friendly_name) ??
        firstString(attributes.friendly_name) ??
        firstString(record.name) ??
        id;
      // Canonical registry wording (the strings the HA intent matcher
      // resolves against) rides with the row so the engine echoes it,
      // never free text: area/device names do not survive translation.
      const area = typeof record.area_name === 'string' && record.area_name.trim() ? record.area_name.trim() : undefined;
      rows.push({ id, label: area && area !== label ? `${label} · area: ${area}` : label });
    }
    return rows.length > 0 ? rows : null;
  },
};

function parsePayload(payload: unknown): unknown {
  if (typeof payload !== 'string') {
    return payload;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
