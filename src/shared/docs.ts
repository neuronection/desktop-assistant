/** Local-docs FTS index types (plan 12 §5). */
export interface DocsRootView {
  root: string;
  indexed: boolean;
  files: number;
  chunks: number;
}

export interface DocsSearchHit {
  path: string;
  root: string;
  chunkIndex: number;
  excerpt: string;
}
