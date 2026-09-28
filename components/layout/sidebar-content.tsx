"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Settings, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SIDEBAR_NAV_ITEMS } from "./sidebar-nav-items";
import { usePendingSyncCount } from "@/lib/store/notes-store";
import { useDeviceStore } from "@/hooks/ui/use-device";
import { ChatList } from "@/components/chat/chat-list";
import { InstallNudgeCard } from "./install-nudge-card";
import { UpdateNudgeCard } from "./update-nudge-card";

interface SidebarContentProps {
  collapsed?: boolean;
  onNavigate?: () => void;
  /** Only passed by the desktop `<aside>` — the mobile drawer has no collapsed state of its own, so it never renders this button. */
  onToggleCollapse?: () => void;
}

function NavLink({
  href,
  label,
  icon: Icon,
  badge,
  collapsed,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  collapsed: boolean;
  active: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-full px-3 py-2 text-[13.5px] transition-colors",
        collapsed && "justify-center px-0 py-2.5",
        active
          ? "bg-primary/[0.18] font-semibold text-accent"
          : "text-foreground/70 hover:bg-secondary hover:text-foreground"
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      {!collapsed && (
        <span className="flex flex-1 items-center justify-between gap-2 truncate">
          {label}
          {badge !== undefined && (
            <span className="font-mono text-[10.5px] text-muted-foreground">{badge}</span>
          )}
        </span>
      )}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function SidebarContent({ collapsed = false, onNavigate, onToggleCollapse }: SidebarContentProps) {
  const pathname = usePathname();
  const pendingCount = usePendingSyncCount();
  const isOnline = useDeviceStore((s) => s.isOnline);

  const toggleButton = onToggleCollapse && (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            className={cn(
              "shrink-0 rounded-full text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground",
              // Matches NavLink's collapsed pill exactly (full-width, same
              // padding/icon size) so it reads as one more icon in the same
              // column instead of a smaller, oddly-spaced control of its own.
              collapsed ? "flex w-full items-center justify-center py-2.5" : "p-1.5"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-[18px]" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        }
      />
      <TooltipContent side={collapsed ? "right" : "bottom"}>
        {collapsed ? "Expandir menu" : "Recolher menu"}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider delay={200}>
      <div className="flex h-full flex-col gap-6">
        <div
          className={cn(
            "flex min-h-14 shrink-0 items-center gap-2.5 px-1",
            collapsed && "flex-col justify-center gap-1.5 px-0"
          )}
        >
          <div className="size-[22px] shrink-0 rounded-full bg-primary" />
          {!collapsed && (
            <span className="flex-1 truncate font-heading text-base tracking-tight">Study Notes</span>
          )}
          {toggleButton}
        </div>

        <nav className="flex flex-col gap-1">
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              badge={item.badge}
              collapsed={collapsed}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        {!collapsed && (
          <div className="flex flex-col gap-1.5">
            <span className="px-1 font-mono text-[9.5px] font-medium tracking-[0.09em] text-muted-foreground">
              CONVERSAS RECENTES
            </span>
            <ChatList compact maxItems={3} />
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3">
          {!collapsed && (
            <div className="flex flex-col gap-1.5 rounded-3xl bg-secondary p-3.5">
              <span
                className={cn(
                  "font-mono text-[10px] font-medium tracking-[0.08em]",
                  isOnline ? "text-success" : "text-accent"
                )}
              >
                {isOnline ? "OFFLINE-FIRST" : "SEM CONEXÃO"}
              </span>
              <span className="text-[12px] leading-relaxed text-muted-foreground">
                {pendingCount > 0
                  ? `${pendingCount} alteraç${pendingCount === 1 ? "ão" : "ões"} aguardando sincronização.`
                  : "Suas notas continuam disponíveis sem conexão."}
              </span>
            </div>
          )}
          {!collapsed && <UpdateNudgeCard />}
          {!collapsed && <InstallNudgeCard />}
          <NavLink
            href="/trash"
            label="Lixeira"
            icon={Trash2}
            collapsed={collapsed}
            active={pathname === "/trash" || pathname.startsWith("/trash/")}
            onNavigate={onNavigate}
          />
          <NavLink
            href="/settings"
            label="Configurações"
            icon={Settings}
            collapsed={collapsed}
            active={pathname === "/settings" || pathname.startsWith("/settings/")}
            onNavigate={onNavigate}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
