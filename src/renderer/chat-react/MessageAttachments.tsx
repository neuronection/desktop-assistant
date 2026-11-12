import type { JSX } from 'react';
import type { ChatAttachmentView } from '@neuronection/assistant-ui/chat-core';
import { FileText } from 'lucide-react';
import { Attachment } from '@shared/types';
import { TEXT } from '@shared/constants/text';

export function attachmentDisplayName(attachment: Attachment): string {
  if (attachment.type === 'pdf') {
    return attachment.filename;
  }
  if (attachment.type === 'screen-capture' && attachment.capture?.label) {
    return attachment.capture.label;
  }
  return attachment.type === 'image' ? TEXT.ATTACHMENT_IMAGE : TEXT.ATTACHMENT_SCREEN_CAPTURE;
}

interface MessageAttachmentsProps {
  attachments: ChatAttachmentView[];
}

export function MessageAttachments(props: MessageAttachmentsProps): JSX.Element | null {
  if (props.attachments.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {props.attachments.map((attachment) =>
        attachment.kind === 'image' && attachment.url ? (
          <button
            key={attachment.id}
            type="button"
            title={TEXT.VIEWER_OPEN}
            aria-label={`${TEXT.VIEWER_OPEN}: ${attachment.name}`}
            className="overflow-hidden rounded-lg border border-[var(--as-border)] transition-colors hover:border-[var(--as-primary)]"
            onClick={() => void window.electronAPI.openImageViewer({ dataUrl: attachment.url ?? '', title: attachment.name })}
          >
            <img src={attachment.url} alt={attachment.name} className="max-h-44 max-w-60 object-cover" />
          </button>
        ) : (
          <span
            key={attachment.id}
            className="flex items-center gap-1 rounded border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-1 text-xs"
          >
            <FileText className="h-3 w-3" aria-hidden />
            <span className="max-w-40 truncate">{attachment.name}</span>
          </span>
        )
      )}
    </div>
  );
}
