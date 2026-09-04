import type { LucideIcon } from "lucide-react";
import { Archive, Book, Gem, LayoutGrid, MessageSquare } from "lucide-react";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { label: "Início", href: "/notes", icon: LayoutGrid },
  { label: "Chats", href: "/chats", icon: MessageSquare },
  { label: "Arquivados", href: "/archived", icon: Archive },
  { label: "Bíblia", href: "/bible", icon: Book },
  { label: "Estudo Pessoal", href: "/jwlibrary", icon: Gem },
];
