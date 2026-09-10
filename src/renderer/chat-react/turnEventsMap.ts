import type { ChatStreamEvent } from '@neuronection/assistant-ui/chat-core';
import type { TurnEvent } from '@shared/turns';

export function turnEventToChatStreamEvents(event: TurnEvent): ChatStreamEvent[] {
  if (event.node) {
    const { node, label, outcome } = event.node;
    if (outcome) {
      return [{ event: 'node_finished', node, label, outcome }];
    }
    return [{ event: 'node_started', node, label }];
  }
  switch (event.phase) {
    case 'queued':
      return [{ event: 'flow_started', flow: 'chat' }];
    case 'interrupt':
      return [{ event: 'node_started', node: 'approval', label: 'Approval needed' }];
    case 'thinking':
    case 'tool_call':
    case 'tool_result': {
      if (!event.step) {
        return [];
      }
      if (event.step.phase === 'tool_call' || event.step.phase === 'tool_result') {
        return [
          {
            event: 'tool_call',
            id: event.step.id,
            name: event.step.toolName ?? event.step.label,
            title: event.step.label,
            status: event.step.phase === 'tool_call' ? 'running' : 'done',
            args: event.step.summary,
            result: typeof event.step.detail === 'string' ? event.step.detail : undefined,
            durationMs:
              event.step.endedAt !== undefined ? event.step.endedAt - event.step.startedAt : undefined,
          },
        ];
      }
      return [{ event: 'node_started', node: event.step.id, label: event.step.label }];
    }
    case 'streaming': {
      const out: ChatStreamEvent[] = [];
      if (event.step) {
        out.push({ event: 'node_finished', node: event.step.id, label: event.step.label, outcome: 'done' });
      }
      if (event.delta) {
        out.push({ event: 'delta', text: event.delta });
      }
      return out;
    }
    case 'finished':
      return [{ event: 'flow_finished' }];
    case 'failed':
      return [
        {
          event: 'flow_failed',
          code: 'provider_error',
          message: event.error ?? 'Turn failed',
          retryable: false,
        },
      ];
    case 'cancelled':
      return [
        {
          event: 'flow_failed',
          code: 'cancelled',
          message: 'Turn cancelled',
          retryable: true,
        },
      ];
  }
}
