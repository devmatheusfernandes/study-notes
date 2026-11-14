"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, Laptop, Monitor, Pencil, Smartphone, Tablet, Trash2, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toaster";
import {
  listDeviceInventories,
  removeDeviceInventory,
  type DeviceInventory,
  type DevicePlatform,
} from "@/app/(app)/offline-devices-actions";
import { formatBytes } from "@/lib/format-bytes";
import { OFFLINE_INVENTORY_CHANGED_EVENT } from "@/lib/offline/inventory-events";
import { getDeviceId, getDeviceName, publishInventory, setDeviceName } from "@/lib/offline/device-inventory";

const ICONS: Record<DevicePlatform, LucideIcon> = { phone: Smartphone, tablet: Tablet, desktop: Monitor };
const COLLAPSED_ITEMS = 5;

function formatSeen(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString("pt-BR")} às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * What each of the user's devices has saved for offline reading. A device's
 * downloads live only in its own browser storage, so every device reports a
 * small inventory (titles and sizes, see device-inventory.ts) and this card
 * lists them side by side — the phone has the Bible and these publications, the
 * desktop has those.
 */
export function OfflineDevicesCard() {
  const [devices, setDevices] = useState<DeviceInventory[] | null>(null);
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingForget, setPendingForget] = useState<DeviceInventory | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Report this device first, so its own row is current when the list is read.
    try {
      await publishInventory();
    } catch {
      // Offline — the last report (if any) is shown.
    }
    try {
      const result = await listDeviceInventories();
      if (result.devices) setDevices(result.devices);
      else setDevices((previous) => previous ?? []);
    } catch {
      setDevices((previous) => previous ?? []);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setThisDeviceId(getDeviceId());
      void load();
    });
    const onChange = () => void load();
    window.addEventListener(OFFLINE_INVENTORY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OFFLINE_INVENTORY_CHANGED_EVENT, onChange);
  }, [load]);

  async function saveName() {
    if (renaming === null) return;
    setDeviceName(renaming);
    setRenaming(null);
    await load();
  }

  async function confirmForget() {
    if (!pendingForget) return;
    const result = await removeDeviceInventory(pendingForget.deviceId);
    if (result.error) notify.error(result.error);
    else notify.success("Aparelho esquecido");
    await load();
  }

  // This device first, then by most recently seen (the server already orders by that).
  const ordered = [...(devices ?? [])].sort(
    (a, b) => Number(b.deviceId === thisDeviceId) - Number(a.deviceId === thisDeviceId)
  );

  return (
    <>
      <section className="flex w-full flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Laptop className="size-4 text-accent" />
            <h2 className="font-heading text-base">Por aparelho</h2>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            O que cada aparelho em que você usa o app tem salvo para ler sem internet. Cada aparelho se atualiza quando
            o app é aberto nele.
          </p>
        </div>

        {devices === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : ordered.length === 0 ? (
          <p className="rounded-2xl border border-border/50 bg-secondary/50 p-4 text-[13px] text-muted-foreground">
            Nenhum aparelho registrado ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ordered.map((device) => {
              const isThis = device.deviceId === thisDeviceId;
              const Icon = ICONS[device.platform];
              const total = device.items.reduce((sum, item) => sum + item.bytes, 0);
              const isExpanded = expanded.has(device.deviceId);
              const shown = isExpanded ? device.items : device.items.slice(0, COLLAPSED_ITEMS);
              const hidden = device.items.length - shown.length;

              return (
                <li key={device.deviceId} className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-secondary/50 p-4">
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {isThis && renaming !== null ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={renaming}
                            onChange={(e) => setRenaming(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveName();
                              if (e.key === "Escape") setRenaming(null);
                            }}
                            aria-label="Nome do aparelho"
                            maxLength={60}
                            autoFocus
                            className="h-9"
                          />
                          <Button variant="ghost" size="sm" aria-label="Salvar nome" className="px-2" onClick={() => void saveName()}>
                            <Check className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-[14px] font-medium">{device.name}</span>
                          {isThis && (
                            <Badge variant="outline" className="h-auto rounded-full font-mono text-[10px]">
                              ESTE APARELHO
                            </Badge>
                          )}
                          <Badge variant="outline" className="h-auto rounded-full font-mono text-[10px]">
                            {device.isPwa ? "APP INSTALADO" : "NAVEGADOR"}
                          </Badge>
                        </div>
                      )}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {device.items.length === 0
                          ? "Nada baixado"
                          : `${device.items.length} ${device.items.length === 1 ? "item" : "itens"} · ${formatBytes(total)}`}
                        {" · "}
                        {isThis ? "agora" : `visto em ${formatSeen(device.updatedAt)}`}
                      </span>
                    </div>

                    {isThis && renaming === null && (
                      <button
                        type="button"
                        onClick={() => setRenaming(getDeviceName())}
                        aria-label="Renomear este aparelho"
                        className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </button>
                    )}
                    {!isThis && (
                      <button
                        type="button"
                        onClick={() => setPendingForget(device)}
                        aria-label={`Esquecer ${device.name}`}
                        className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>

                  {device.items.length > 0 && (
                    <ul className="flex flex-col gap-1.5 border-t border-border/50 pt-3">
                      {shown.map((item, index) => (
                        <li key={`${item.kind}-${item.noteId ?? index}`} className="flex items-center gap-2 text-[13px]">
                          {item.kind === "bible" && <BookOpen className="size-3.5 shrink-0 text-accent" />}
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatBytes(item.bytes)}</span>
                        </li>
                      ))}
                      {(hidden > 0 || isExpanded) && device.items.length > COLLAPSED_ITEMS && (
                        <li>
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((previous) => {
                                const next = new Set(previous);
                                if (next.has(device.deviceId)) next.delete(device.deviceId);
                                else next.add(device.deviceId);
                                return next;
                              })
                            }
                            className="text-[12px] text-accent hover:underline"
                          >
                            {isExpanded ? "Mostrar menos" : `Mostrar mais ${hidden}`}
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmVault
        open={pendingForget !== null}
        onOpenChange={(open) => {
          if (!open) setPendingForget(null);
        }}
        title="Esquecer este aparelho?"
        description="Some da lista, mas nada é apagado nele. Se o app for aberto lá de novo, ele aparece outra vez."
        confirmLabel="Esquecer"
        onConfirm={() => void confirmForget()}
      />
    </>
  );
}
