import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT = 10_000;

export type MediaAction = 'play' | 'pause' | 'play_pause' | 'stop' | 'next' | 'previous' | 'seek';

export interface CommandSpec {
  file: string;
  args: string[];
}

/**
 * Per-OS matrix — pure. `null` means the platform has no supported
 * path yet (Windows SMTC needs a native helper) and the caller must
 * degrade gracefully.
 */
export function buildMediaInvocation(action: MediaAction, platform: NodeJS.Platform, seconds?: number): CommandSpec | null {
  if (platform === 'linux') {
    switch (action) {
      case 'play':
        return { file: 'playerctl', args: ['play'] };
      case 'pause':
        return { file: 'playerctl', args: ['pause'] };
      case 'play_pause':
        return { file: 'playerctl', args: ['play-pause'] };
      case 'stop':
        return { file: 'playerctl', args: ['stop'] };
      case 'next':
        return { file: 'playerctl', args: ['next'] };
      case 'previous':
        return { file: 'playerctl', args: ['previous'] };
      case 'seek':
        return { file: 'playerctl', args: ['position', String(seconds ?? 0)] };
    }
  }
  if (platform === 'darwin') {
    const seekPrefix = ['set player position to', String(seconds ?? 0)];
    const command =
      action === 'seek' ? seekPrefix.join(' ') : action === 'play_pause' ? 'playpause' : action;
    return {
      file: 'osascript',
      args: [
        '-e',
        [
          'tell application "System Events"',
          'set names to name of application processes',
          'end tell',
          'if names contains "Spotify" then',
          `tell application "Spotify" to ${command}`,
          'else if names contains "Music" then',
          `tell application "Music" to ${command}`,
          'else',
          'error "No supported player is running"',
          'end if',
        ].join('\n'),
      ],
    };
  }
  return null;
}

const schema = z
  .object({
    action: z
      .enum(['play', 'pause', 'play_pause', 'stop', 'next', 'previous', 'seek'])
      .describe('Media control to apply to the current player.'),
    seconds: z
      .number()
      .min(0)
      .max(86_400)
      .optional()
      .describe('Absolute position in seconds (seek only).'),
  })
  .refine((args) => args.action !== 'seek' || args.seconds !== undefined, {
    message: 'seek requires seconds.',
  });

const LABELS: Record<MediaAction, string> = {
  play: 'Play',
  pause: 'Pause',
  play_pause: 'Play/pause toggle',
  stop: 'Stop',
  next: 'Next track',
  previous: 'Previous track',
  seek: 'Seek',
};

export const mediaControlsTool: NativeToolDefinition<{ action: MediaAction; seconds?: number }> = {
  name: 'media_controls',
  description:
    'Control media playback (play, pause, play_pause, stop, next, previous, seek) for the system media player. State-changing: asks unless approved or auto-run by policy.',
  schema,
  risk: 'state-changing',
  category: 'desktop',
  timeoutMs: CMD_TIMEOUT + 2_000,
  resultCharCap: 300,
  summarize: (args) =>
    args.action === 'seek' ? `Seek to ${args.seconds}s` : `Media: ${LABELS[args.action].toLowerCase()}`,
  async exec(args) {
    const spec = buildMediaInvocation(args.action, process.platform, args.seconds);
    if (!spec) {
      return 'Not available on this system yet (Windows media control needs SMTC support).';
    }
    try {
      await execFileAsync(spec.file, spec.args, { timeout: CMD_TIMEOUT });
      return `${LABELS[args.action]} — done.`;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return `Not available on this system (needs ${spec.file}).`;
      }
      return `Error: media ${LABELS[args.action].toLowerCase()} failed (${((error as Error).message ?? String(error)).slice(0, 200)}).`;
    }
  },
};
