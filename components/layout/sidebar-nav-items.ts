import type { LucideIcon } from "lucide-react";
import { Archive, Book, Gem, LayoutGrid, MessageSquare, Trash2 } from "lucide-react";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { label: "Meu conteúdo", href: "/notes", icon: LayoutGrid },
  { label: "Estudo Pessoal", href: "/jwlibrary", icon: Gem },
  { label: "Bíblia", href: "/bible", icon: Book },
  { label: "Chats", href: "/chats", icon: MessageSquare },
  { label: "Arquivados", href: "/archived", icon: Archive },
  { label: "Lixeira", href: "/trash", icon: Trash2 },
];
