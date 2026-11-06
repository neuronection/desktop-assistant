/** The unsettled stream tail is raw text. Paragraphs must collapse soft line
 * breaks exactly like the final Markdown renderer; open code/math blocks keep
 * their whitespace so streamed code does not reflow. */
export function streamTailKeepsWhitespace(text: string): boolean {
  let fence: string | null = null;
  let math = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (fence !== null) {
      if (trimmed === fence) {
        fence = null;
      }
      continue;
    }
    const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    if (math) {
      if (trimmed.endsWith('$$')) {
        math = false;
      }
      continue;
    }
    if (trimmed.startsWith('$$')) {
      math = !(trimmed.endsWith('$$') && trimmed.length > 4);
    }
  }
  return fence !== null || math;
}
