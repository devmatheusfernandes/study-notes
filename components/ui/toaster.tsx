"use client";
import { useEffect, useState } from "react";
import {
    CircleCheckIcon,
    InfoIcon,
    Loader2Icon,
    OctagonXIcon,
    TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps, toast as sonnerToast } from "sonner";
import { useDevice, useIsMobile } from "@/hooks/ui/use-device";
import {
    Vault,
    VaultContent,
    VaultHeader,
    VaultTitle,
    VaultDescription,
    VaultIcon,
} from "@/components/ui/vault";

type NotificationType = "success" | "error" | "info" | "warning" | "loading";

interface NotificationData {
    type: NotificationType;
    title: string;
    description?: string;
    id?: string | number;
}

const notificationEmitter = new EventTarget();

const generateId = () => Math.random().toString(36).substring(2, 9);

export const notify = {
    loading: (title: string, description?: string, id?: string | number) =>
        notificationEmitter.dispatchEvent(
            new CustomEvent<NotificationData>("notify", {
                detail: { type: "loading", title, description, id },
            })
        ),
    success: (title: string, description?: string, id?: string | number) =>
        notificationEmitter.dispatchEvent(
            new CustomEvent<NotificationData>("notify", {
                detail: { type: "success", title, description, id },
            })
        ),
    error: (title: string, description?: string, id?: string | number) =>
        notificationEmitter.dispatchEvent(
            new CustomEvent<NotificationData>("notify", {
                detail: { type: "error", title, description, id },
            })
        ),
    info: (title: string, description?: string, id?: string | number) =>
        notificationEmitter.dispatchEvent(
            new CustomEvent<NotificationData>("notify", {
                detail: { type: "info", title, description, id },
            })
        ),
    warning: (title: string, description?: string, id?: string | number) =>
        notificationEmitter.dispatchEvent(
            new CustomEvent<NotificationData>("notify", {
                detail: { type: "warning", title, description, id },
            })
        ),

    promise: <T,>(
        promise: Promise<T> | (() => Promise<T>),
        opts: {
            loading: string;
            success: string | ((data: T) => string);
            error: string | ((error: unknown) => string);
        }
    ) => {
        const id = generateId();

        notify.loading(opts.loading, undefined, id);

        const p = typeof promise === "function" ? promise() : promise;

        p.then((result) => {
            try {
                const message = typeof opts.success === "function" ? opts.success(result) : opts.success;
                notify.success(message, undefined, id);
            } catch (err) {
                const message = typeof opts.error === "function" ? opts.error(err) : opts.error;
                notify.error(message, undefined, id);
            }
        }).catch((err) => {
            const message = typeof opts.error === "function" ? opts.error(err) : opts.error;
            notify.error(message, undefined, id);
        });

        return p;
    },
    sonner: sonnerToast,
};

const Toaster = ({ ...props }: ToasterProps) => {
    const { theme } = useTheme();
    const { isStandalone } = useDevice();
    const isMobile = useIsMobile();

    const [vaultData, setVaultData] = useState<NotificationData | null>(null);
    const [isVaultOpen, setIsVaultOpen] = useState(false);

    useEffect(() => {
        const handleNotify = (e: Event) => {
            const { type, title, description, id } = (e as CustomEvent<NotificationData>).detail;

            if (isStandalone) {
                setVaultData({ type, title, description, id });
                setIsVaultOpen(true);
            } else {
                switch (type) {
                    case "loading":
                        sonnerToast.loading(title, { description, id });
                        break;
                    case "success":
                        sonnerToast.success(title, { description, id });
                        break;
                    case "error":
                        sonnerToast.error(title, { description, id });
                        break;
                    case "warning":
                        sonnerToast.warning(title, { description, id });
                        break;
                    case "info":
                    default:
                        sonnerToast.info(title, { description, id });
                        break;
                }
            }
        };

        notificationEmitter.addEventListener("notify", handleNotify);
        return () => notificationEmitter.removeEventListener("notify", handleNotify);
    }, [isStandalone]);

    const sonnerPosition = isMobile ? "bottom-center" : "top-right";

    return (
        <>
            <Sonner
                theme={theme as ToasterProps["theme"]}
                className="toaster group"
                position={sonnerPosition}
                icons={{
                    success: <CircleCheckIcon className="size-4" />,
                    info: <InfoIcon className="size-4" />,
                    warning: <TriangleAlertIcon className="size-4" />,
                    error: <OctagonXIcon className="size-4" />,
                    loading: <Loader2Icon className="size-4 animate-spin" />,
                }}
                toastOptions={{
                    style: {
                        background: "var(--primary)",
                        color: "white",
                        border: "1px solid var(--primary)",
                        borderRadius: "var(--radius)",
                    },
                    classNames: {
                        description: "!text-white",
                    },
                }}
                {...props}
            />

            <Vault open={isVaultOpen} onOpenChange={setIsVaultOpen}>
                <VaultContent>
                    <VaultHeader showCloseButton={vaultData?.type !== "loading"}>
                        {vaultData && (
                            <>
                                {vaultData.type === "loading" ? (
                                    <Loader2Icon className="size-10 animate-spin text-primary mx-auto mb-4" />
                                ) : (
                                    <VaultIcon type={vaultData.type as "success" | "error" | "info" | "warning"} />
                                )}

                                <VaultTitle>{vaultData.title}</VaultTitle>

                                {vaultData.description && (
                                    <VaultDescription>{vaultData.description}</VaultDescription>
                                )}
                            </>
                        )}
                    </VaultHeader>
                </VaultContent>
            </Vault>
        </>
    );
};

export { Toaster };