import {
  HelpCircle,
  User,
  UserPlus,
  UserX,
  GraduationCap,
  Heart,
  FileText,
  CreditCard,
  Settings,
  XCircle,
  Link2Off,
  Bell,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  Info,
  Mail,
  Lock,
  Eye,
  Search,
  Home,
  Star,
  BookOpen,
  AlertTriangle,
  Phone,
  Globe,
  Package,
  Truck,
  Key,
  type LucideIcon,
} from 'lucide-react';

// Curated icon set for help-center categories. The category's `icon` column
// stores one of these names; admin picks from this list and the help center
// renders the matching glyph. Kept deliberately small and support-flavoured
// (mirrors the icons on the public FAQ page) so the picker stays usable.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  HelpCircle,
  User,
  UserPlus,
  UserX,
  GraduationCap,
  Heart,
  FileText,
  CreditCard,
  Settings,
  XCircle,
  Link2Off,
  Bell,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  Info,
  Mail,
  Lock,
  Eye,
  Search,
  Home,
  Star,
  BookOpen,
  AlertTriangle,
  Phone,
  Globe,
  Package,
  Truck,
  Key,
};

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

/** Render a category icon by name. Falls back to a neutral glyph if unknown/empty. */
export default function CategoryIcon({
  name,
  size = 20,
  className,
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = (name && CATEGORY_ICONS[name]) || HelpCircle;
  return <Icon size={size} className={className} />;
}
