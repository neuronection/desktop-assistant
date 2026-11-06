#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildSpotifyServer() {
  const server = new McpServer({ name: 'spotify', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('get_now_playing', 'Read the current track.');
  register('search_tracks', 'Search tracks.', { query: z.string() });
  register('list_playlists', 'List playlists.');
  register('play_track', 'Play a track.', { track_id: z.string() });
  register('pause', 'Pause playback.');
  register('resume', 'Resume playback.');
  register('add_to_queue', 'Queue a track.', { track_id: z.string() });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildSpotifyServer().connect(new StdioServerTransport());
}
