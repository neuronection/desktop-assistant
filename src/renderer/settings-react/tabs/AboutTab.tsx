import type { JSX } from 'react';
import { AboutPanel } from '@neuronection/assistant-ui/about';
import { TEXT } from '@shared/constants/text';
import { SPONSOR_CHANNELS } from '@renderer/shared/funding';

export function AboutTab({ version }: { version: string }): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-3xl pb-6">
      <AboutPanel
        appName="Desktop Assistant"
        familyCurrent="desktop"
        tagline={TEXT.ABOUT_TAGLINE}
        description={TEXT.ABOUT_DESCRIPTION}
        version={version}
        license={{
          name: 'Apache License 2.0',
          href: 'https://www.apache.org/licenses/LICENSE-2.0',
        }}
        linksTitle={TEXT.ABOUT_LINKS_TITLE}
        links={[
          { group: 'Project', href: 'https://neuronection.com', label: 'Website', subtitle: 'neuronection.com' },
          { group: 'Project', href: 'https://github.com/neuronection/desktop-assistant', label: 'GitHub', subtitle: 'neuronection/desktop-assistant' },
          { group: 'Creator', href: 'https://github.com/constLiakos', label: 'GitHub', subtitle: 'Ilias Chatzopoulos' },
          { group: 'Creator', copyValue: 'constliakos@gmail.com', label: 'constliakos@gmail.com', subtitle: 'Click to copy' },
        ]}
        creator={{
          name: 'Ilias Chatzopoulos',
          role: 'Founder & Lead Architect',
          href: 'https://github.com/constLiakos',
        }}
        tech={[
          'Electron',
          'TypeScript',
          'React 19',
          'Tailwind CSS v4',
          'LangChain + LangGraph',
          'Prisma + SQLite',
          'Vitest',
        ]}
        copyright="© 2026 Neuronection"
        theme="dark"
        sponsor={{
          channels: SPONSOR_CHANNELS,
          title: TEXT.FUND_TITLE,
        }}
      />
    </div>
  );
}
