import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolResultView } from '@shared/turns';

const getMock = vi.fn<() => Promise<ToolResultView | null>>();

vi.mock('@main/services/ToolResultService', () => ({
  getToolResultService: () => ({ get: getMock }),
}));

import { screenshotRecallTool } from '@main/ai/tools/native/screenshot-recall';

const VIEW: ToolResultView = {
  callId: 'tool_call_1',
  tool: 'screen_capture',
  status: 'ok',
  text: 'Screenshot captured of the primary display.',
  images: ['data:image/jpeg;base64,QUJD'],
};

beforeEach(() => {
  getMock.mockReset();
});

describe('recall_screenshot', () => {
  it('returns text + image blocks for a stored result', async () => {
    getMock.mockResolvedValue(VIEW);
    await expect(screenshotRecallTool.exec({ stepId: 'tool_call_1' }, {})).resolves.toEqual([
      { type: 'text', text: VIEW.text },
      { type: 'image', url: VIEW.images[0] },
    ]);
  });

  it('reports unknown or expired ids', async () => {
    getMock.mockResolvedValue(null);
    await expect(screenshotRecallTool.exec({ stepId: 'gone' }, {})).resolves.toBe(
      "Error: no stored result for 'gone' (unknown or expired — check the recallable-screenshots list)."
    );
  });

  it('reports results without images', async () => {
    getMock.mockResolvedValue({ ...VIEW, text: '', images: [] });
    await expect(screenshotRecallTool.exec({ stepId: 'tool_call_1' }, {})).resolves.toBe(
      'The stored result exists but carries no image.'
    );
  });

  it('is registered as a read-only desktop tool', () => {
    expect(screenshotRecallTool.name).toBe('recall_screenshot');
    expect(screenshotRecallTool.risk).toBe('read-only');
    expect(screenshotRecallTool.category).toBe('desktop');
  });
});
