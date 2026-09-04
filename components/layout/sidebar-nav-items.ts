import type { LucideIcon } from "lucide-react";
import { Archive, BookMarked, LayoutGrid, MessageSquare, Trash2 } from "lucide-react";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { label: "Meu conteúdo", href: "/notes", icon: LayoutGrid },
  { label: "JW Library", href: "/jwlibrary", icon: BookMarked },
  { label: "Chats", href: "/chats", icon: MessageSquare },
  { label: "Arquivados", href: "/archived", icon: Archive },
  { label: "Lixeira", href: "/trash", icon: Trash2 },
];
