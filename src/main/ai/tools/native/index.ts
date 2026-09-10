import { ToolRegistry } from '../registry';
import { screenCaptureTool } from './screen-capture';
import { systemInfoTool } from './system-info';
import { clipboardReadTool } from './clipboard-read';
import { clipboardWriteTool } from './clipboard-write';
import { listAppsTool } from './list-apps';
import { webFetchTool } from './web-fetch';
import { webSearchTool } from './web-search';
import { listDirTool } from './list-dir';
import { readFileTool } from './read-file';
import { openUrlTool } from './open-url';
import { openPathTool } from './open-path';
import { openAppTool } from './open-app';
import { notifyTool } from './notify';
import { fileWriteTool } from './file-write';
import { fileCreateTool } from './file-create';
import { fileMoveTool } from './file-move';
import { volumeSetTool } from './volume-set';
import { brightnessSetTool } from './brightness-set';
import { runShellTool } from './run-shell';
import { powerLockTool, powerSleepTool, powerRestartTool, powerShutdownTool } from './power';
import { fileDeleteTool } from './file-delete';
import { findFilesTool, grepFilesTool } from './file-search';
import { killProcessTool } from './kill-process';
import { memorySaveTool } from './memory-save';
import { memorySearchTool } from './memory-search';
import { memoryListTool } from './memory-list';
import { memoryForgetTool } from './memory-forget';
import { windowListTool, activeWindowTool } from './window-enum';
import { processListTool } from './process-list';
import { mediaControlsTool } from './media-controls';
import { screenshotRecallTool } from './screenshot-recall';

export const NATIVE_TOOL_CATALOG = [
  screenCaptureTool,
  systemInfoTool,
  clipboardReadTool,
  clipboardWriteTool,
  listAppsTool,
  webFetchTool,
  webSearchTool,
  listDirTool,
  readFileTool,
  openUrlTool,
  openPathTool,
  openAppTool,
  notifyTool,
  fileWriteTool,
  fileCreateTool,
  fileMoveTool,
  findFilesTool,
  grepFilesTool,
  volumeSetTool,
  brightnessSetTool,
  runShellTool,
  powerLockTool,
  powerSleepTool,
  powerRestartTool,
  powerShutdownTool,
  fileDeleteTool,
  killProcessTool,
  memorySaveTool,
  memorySearchTool,
  memoryListTool,
  memoryForgetTool,
  windowListTool,
  activeWindowTool,
  processListTool,
  mediaControlsTool,
  screenshotRecallTool,
];

export function buildDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const definition of NATIVE_TOOL_CATALOG) {
    registry.register(definition);
  }
  return registry;
}
