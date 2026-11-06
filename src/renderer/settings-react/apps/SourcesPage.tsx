import type { ReactElement } from "react";
import { ExtensionSourcesSection } from "./ExtensionSourcesSection";
import { PackPageShell } from "./PackPageShell";
import { TEXT } from "@shared/constants/text";

/**
 * The extension-sources page (plan 49 phase 2): the git/local source
 * registry, discovered candidates, consent and update flows — moved off
 * the packs hub so the hub stays a list of cards.
 */
export function SourcesPage({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <PackPageShell
      title={TEXT.MINIAPPS_SOURCES}
      pageLabel={TEXT.MINIAPPS_SOURCES_PAGE_ARIA}
      onBack={onBack}
    >
      <ExtensionSourcesSection />
    </PackPageShell>
  );
}
