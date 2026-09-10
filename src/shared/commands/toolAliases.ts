/**
 * Canonical slash aliases per native tool — the single source for the
 * command catalog aliases (CommandService) and inspector examples
 * (DesktopApp). Preset packs (plan 14 §5) may layer more on top.
 */
export const TOOL_SLASH_ALIASES: Record<string, string[]> = {
  screen_capture: ['screenshot'],
  run_shell: ['shell'],
  open_url: ['url'],
  open_path: ['path'],
  open_app: ['app'],
  web_search: ['web', 'search'],
  find_files: ['find'],
  grep_files: ['grep'],
  memory_save: ['remember'],
  system_info: ['sysinfo'],
};

/** Sample argument hint used for inspector examples. */
const TOOL_EXAMPLE_ARGS: Record<string, string> = {
  run_shell: 'ls -la',
  open_url: 'https://example.com',
  open_path: '~/Documents',
  open_app: 'firefox',
  web_search: 'langchain.js streaming',
  find_files: '*.md',
  grep_files: 'TODO',
};

export function slashExampleFor(toolName: string): string | null {
  const aliases = TOOL_SLASH_ALIASES[toolName];
  if (!aliases || aliases.length === 0) {
    return null;
  }
  const args = TOOL_EXAMPLE_ARGS[toolName] ?? '';
  return args ? `/${aliases[0]} ${args}` : `/${aliases[0]}`;
}
