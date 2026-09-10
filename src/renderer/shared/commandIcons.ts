import {
  Activity, AppWindow, Bell, Brain, Calculator, Camera, ClipboardCopy, ClipboardCheck, Cpu, Download, Eraser,
  EyeOff, FilePlus, FileSearch, FileText, FileX, Folder, FolderInput, FolderOpen, Globe, LayoutList, List, LogOut,
  Maximize2, Monitor, Pencil, Play, Search, Settings, Skull, SquarePen, Terminal, TextSearch, Volume2, Wrench,
  type LucideIcon,
} from 'lucide-react';

/** Icon-name → component map shared by the palette and the settings Commands tab. */
export const COMMAND_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  'app-window': AppWindow,
  bell: Bell,
  brain: Brain,
  calculator: Calculator,
  camera: Camera,
  'clipboard-check': ClipboardCheck,
  'clipboard-copy': ClipboardCopy,
  cpu: Cpu,
  download: Download,
  eraser: Eraser,
  'eye-off': EyeOff,
  'file-plus': FilePlus,
  'file-search': FileSearch,
  'file-text': FileText,
  'file-x': FileX,
  folder: Folder,
  'folder-input': FolderInput,
  'folder-open': FolderOpen,
  globe: Globe,
  'layout-list': LayoutList,
  'log-out': LogOut,
  list: List,
  'maximize-2': Maximize2,
  monitor: Monitor,
  pencil: Pencil,
  play: Play,
  search: Search,
  settings: Settings,
  skull: Skull,
  'square-pen': SquarePen,
  terminal: Terminal,
  'text-search': TextSearch,
  'volume-2': Volume2,
};

export function commandIcon(name: string | undefined): LucideIcon {
  return (name && COMMAND_ICONS[name]) || Wrench;
}
