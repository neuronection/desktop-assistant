import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import { TEXT, interpolate } from '@shared/constants/text';

/**
 * Shared shell for Integrations detail pages (plan 49 phase 1): back
 * navigation, a focused page heading and a labelled region. Focus moves
 * to the heading on mount and back to the originating card's Configure
 * button happens in MiniAppsSection on return.
 */
export function PackPageShell({
  title,
  pageLabel,
  onBack,
  children,
}: {
  title: string;
  pageLabel: string;
  onBack: () => void;
  children: ReactNode;
}): ReactElement {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div role="region" aria-label={interpolate(pageLabel, { title })} className="space-y-5">
      <div className="space-y-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {TEXT.SETTINGS_BACK}
        </Button>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
