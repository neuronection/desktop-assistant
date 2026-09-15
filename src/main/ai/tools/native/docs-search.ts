import { z } from 'zod';
import type { NativeToolDefinition } from '../types';
import { getDocsIndexService } from '@main/services/DocsIndexService';

const schema = z.object({
  query: z.string().min(1).describe('Words to search for in the indexed document folders.'),
});

type DocsSearchArgs = z.infer<typeof schema>;

export const docsSearchTool: NativeToolDefinition<DocsSearchArgs> = {
  name: 'docs_search',
  description:
    'Full-text search over the document folders the user opted into indexing (markdown, text and PDF files). Returns matching excerpts with their file paths. Use for questions about the user\'s local documents.',
  schema,
  risk: 'read-only',
  category: 'files',
  timeoutMs: 10_000,
  resultCharCap: 4_000,
  summarize: (args) => `Search docs: ${args.query}`,
  async exec(args) {
    const service = getDocsIndexService();
    const hits = await service.search(args.query);
    if (hits.length === 0) {
      return 'No matching passages found in the indexed folders.';
    }
    const lines = hits.map((hit) => `${hit.path} (chunk ${hit.chunkIndex + 1})\n  ${hit.excerpt.replace(/\s+/g, ' ').trim()}`);
    return `Found ${hits.length} matching passage(s):\n\n${lines.join('\n\n')}`;
  },
};
