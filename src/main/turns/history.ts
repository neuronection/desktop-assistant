import { AIMessage, Attachment } from '@shared/types';
import { Message, MessageRole } from '@shared/database-types';

export function toAiMessages(messages: Message[]): AIMessage[] {
  return messages.map((msg): AIMessage => {
    if (msg.role === MessageRole.USER && msg.attachments && msg.attachments.length > 0) {
      let combined = msg.content || '';
      const images: { type: 'image_url'; image_url: { url: string } }[] = [];
      msg.attachments.forEach((att: Attachment) => {
        if (att.type === 'image' || att.type === 'screen-capture') {
          images.push({ type: 'image_url', image_url: { url: att.data } });
        } else if (att.type === 'pdf' && att.extractedText) {
          combined += `\n\n--- Content from ${att.filename} ---\n${att.extractedText}`;
        }
      });
      return { role: msg.role, content: [{ type: 'text', text: combined.trim() }, ...images] } as AIMessage;
    }
    return { role: msg.role, content: msg.content } as AIMessage;
  });
}
