import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { DocsDialog } from '@neuronection/assistant-ui/integration-docs-dialog';
import type { IntegrationDocsNode } from '@neuronection/assistant-ui/integration-docs-dialog';
import { MarkdownSurface } from '@neuronection/assistant-ui/chat-markdown';
import { TEXT } from '@shared/constants/text';
import type { PackDocPageResult, PackDocsResult } from '@shared/app-pack';

/**
 * Pack documentation (plan 34 wave 8): the kit's DocsDialog owns the tree
 * chrome; the fetch + render ride the app-owned content slot (health's
 * IntegrationDocsDialog is the family shape). The main process serves only
 * tree-listed pages of the pack's VALIDATED docs tree — the renderer
 * names a pack id and a file, nothing more. The landing rule picks the
 * opening page; the audience tag (when present) renders as a badge.
 */

type DocsTree = {
  version: number;
  categories: {
    category: string;
    title?: string;
    items: {
      id: string;
      file?: string;
      title?: string;
      index?: boolean;
      audience?: 'user' | 'dev';
    }[];
  }[];
  i18n?: { defaultLocale?: string; locales?: Record<string, Record<string, string>> };
};

function docsNodes(tree: DocsTree | null): IntegrationDocsNode[] {
  const i18n = tree?.i18n;
  const label = (key: string, inline: string | undefined, slug: string): string => {
    const localeMap = (code?: string | null) => (code ? i18n?.locales?.[code]?.[key] : undefined);
    return (
      localeMap('en') ??
      localeMap(i18n?.defaultLocale) ??
      inline ??
      slug.replace(/(^|-)([a-z])/g, (_, sep: string, ch: string) => (sep ? ` ${ch.toUpperCase()}` : ch.toUpperCase()))
    );
  };
  return (tree?.categories ?? []).map((category) => ({
    id: `category:${category.category}`,
    title: label(`category.${category.category}`, category.title, category.category),
    children: category.items.map((item) => ({
      id: item.file ?? item.id,
      title: label(`item.${item.id}`, item.title, item.id),
    })),
  }));
}

function landingDocFile(tree: DocsTree | null): string | null {
  const items = (tree?.categories ?? []).flatMap((category) => category.items);
  const flagged = items.find((item) => item.index);
  return (flagged ?? items[0])?.file ?? null;
}

function audienceOfFile(tree: DocsTree | null, file: string | null): 'user' | 'dev' | null {
  for (const category of tree?.categories ?? []) {
    for (const item of category.items) {
      if (item.file && item.file === file) {
        return item.audience === 'dev' ? 'dev' : item.audience === 'user' ? 'user' : null;
      }
    }
  }
  return null;
}

export function PackDocsDialog({ packId, onClose }: { packId: string; onClose: () => void }): ReactElement {
  const [tree, setTree] = useState<DocsTree | null | undefined>(undefined);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [contentStatus, setContentStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getMiniAppDocs(packId)
      .then((result: PackDocsResult) => {
        if (cancelled) return;
        if (!result.ok) {
          setContentStatus('error');
          setErrorDetail(result.error);
          return;
        }
        setTree(result.tree as unknown as DocsTree);
        setCurrentFile(result.landing || landingDocFile(result.tree as unknown as DocsTree));
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setContentStatus('error');
        setErrorDetail(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [packId]);

  useEffect(() => {
    if (!currentFile || currentFile.startsWith('category:')) return;
    let cancelled = false;
    setContentStatus('loading');
    window.electronAPI
      .getMiniAppDocPage(packId, currentFile)
      .then((result: PackDocPageResult) => {
        if (cancelled) return;
        if (!result.ok) {
          setContentStatus('error');
          setErrorDetail(result.error);
          return;
        }
        setMarkdown(result.markdown);
        setContentStatus('ready');
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setContentStatus('error');
        setErrorDetail(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [packId, currentFile]);

  const nodes = docsNodes(tree ?? null);
  const audience = audienceOfFile(tree ?? null, currentFile);

  return (
    <DocsDialog
      open
      onOpenChange={(open) => !open && onClose()}
      docs={nodes}
      selectedId={currentFile}
      onSelect={(nodeId) => {
        if (!nodeId.startsWith('category:')) setCurrentFile(nodeId);
      }}
      status={contentStatus}
      errorDetail={errorDetail}
      renderContent={() => (
        <div className="max-w-none text-sm leading-relaxed">
          {audience ? (
            <span
              data-testid="pack-docs-audience"
              className="mb-3 inline-block rounded-full border border-[var(--as-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--as-muted-foreground)]"
            >
              {audience === 'dev' ? TEXT.MINIAPPS_DOCS_AUDIENCE_DEV : TEXT.MINIAPPS_DOCS_AUDIENCE_USER}
            </span>
          ) : null}
          <MarkdownSurface value={markdown} />
        </div>
      )}
      labels={{
        title: TEXT.MINIAPPS_DOCS_TITLE,
        closeLabel: TEXT.CLOSE_BUTTON,
        treeLabel: TEXT.MINIAPPS_DOCS_TREE_LABEL,
        emptyLabel: TEXT.MINIAPPS_DOCS_EMPTY,
        loadingLabel: TEXT.MINIAPPS_DOCS_LOADING,
        errorLabel: TEXT.MINIAPPS_DOCS_ERROR,
      }}
    />
  );
}
