import type { ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BedDouble,
  Bike,
  Bot,
  Briefcase,
  Calendar,
  Camera,
  Car,
  Cloud,
  CreditCard,
  Database,
  Dog,
  Dumbbell,
  Folder,
  GraduationCap,
  Hammer,
  Headphones,
  HeartPulse,
  Home,
  Image,
  Keyboard,
  Lightbulb,
  Mail,
  MapPin,
  MessageCircle,
  Monitor,
  Music,
  Package,
  Palette,
  PawPrint,
  Plane,
  Plug,
  Printer,
  Server,
  ShoppingCart,
  Smartphone,
  Sun,
  Thermometer,
  Trees,
  Truck,
  Users,
  Utensils,
  Video,
  Wallet,
  Wind,
  Wrench,
  Zap,
} from 'lucide-react';
import { TEXT } from '@shared/constants/text';
import type { ToolAppView } from '@shared/apps';

const ICON_MAP: Record<string, LucideIcon> = {
  home: Home,
  plug: Plug,
  bot: Bot,
  cloud: Cloud,
  sun: Sun,
  zap: Zap,
  monitor: Monitor,
  smartphone: Smartphone,
  keyboard: Keyboard,
  printer: Printer,
  server: Server,
  database: Database,
  folder: Folder,
  image: Image,
  music: Music,
  video: Video,
  camera: Camera,
  headphones: Headphones,
  mail: Mail,
  'message-circle': MessageCircle,
  users: Users,
  calendar: Calendar,
  'map-pin': MapPin,
  briefcase: Briefcase,
  'graduation-cap': GraduationCap,
  'shopping-cart': ShoppingCart,
  'credit-card': CreditCard,
  wallet: Wallet,
  activity: Activity,
  'heart-pulse': HeartPulse,
  dumbbell: Dumbbell,
  utensils: Utensils,
  'bed-double': BedDouble,
  plane: Plane,
  car: Car,
  bike: Bike,
  wrench: Wrench,
  hammer: Hammer,
  package: Package,
  truck: Truck,
  lightbulb: Lightbulb,
  thermometer: Thermometer,
  wind: Wind,
  trees: Trees,
  'paw-print': PawPrint,
  dog: Dog,
  palette: Palette,
};

export const APP_ICON_CHOICES: readonly string[] = Object.keys(ICON_MAP);

export function AppIcon({ view, name }: { view: ToolAppView; name: string }): ReactElement {
  const icon = ICON_MAP[view.app.icon ?? ''];
  if (icon) {
    const IconComponent = icon;
    return (
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--as-primary)]/25 to-[var(--as-primary)]/5 text-[var(--as-primary)]"
      >
        <IconComponent aria-hidden="true" className="size-5" />
      </span>
    );
  }
  return <Monogram name={name} />;
}

function Monogram({ name }: { name: string }): ReactElement {
  return (
    <span
      aria-hidden
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--as-primary)]/25 to-[var(--as-primary)]/5 text-base font-semibold text-[var(--as-primary)]"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export interface IconPickerProps {
  current: string | undefined;
  onPick: (icon: string | undefined) => void;
}

export function IconPicker({ current, onPick }: IconPickerProps): ReactElement {
  return (
    <div role="group" aria-label={TEXT.APPS_ICON_PICKER_LABEL} className="flex flex-wrap items-center gap-1">
      {APP_ICON_CHOICES.map((choice) => {
        const IconComponent = ICON_MAP[choice];
        return (
          <button
            key={choice}
            type="button"
            aria-pressed={choice === current}
            aria-label={choice}
            onClick={() => onPick(choice === current ? undefined : choice)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
              choice === current ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10' : 'border-[var(--as-border)]'
            }`}
          >
            <IconComponent aria-hidden="true" className="size-4" />
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={current === undefined}
        onClick={() => onPick(undefined)}
        className="h-8 rounded-lg border border-[var(--as-border)] px-2 text-xs"
      >
        {TEXT.APPS_ICON_PICKER_CLEAR}
      </button>
    </div>
  );
}
