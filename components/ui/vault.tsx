"use client";
import * as React from "react";
import { useDevice } from "@/hooks/ui/use-device";
import { Drawer } from "vaul";
import { twMerge } from "tailwind-merge";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { motion, HTMLMotionProps } from "framer-motion";
import { vaultIcons } from "./vault-icons";
import { Input } from "./input";

interface VaultContextProps {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
}

const VaultContext = React.createContext<VaultContextProps | undefined>(
    undefined,
);

const Vault = ({
    children,
    open: controlledOpen,
    onOpenChange,
    defaultOpen,
    ...props
}: React.ComponentProps<typeof Drawer.Root>) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
        defaultOpen ?? false,
    );

    const isOpen = controlledOpen ?? uncontrolledOpen;

    const handleOpenChange = (open: boolean) => {
        if (controlledOpen === undefined) {
            setUncontrolledOpen(open);
        }
        onOpenChange?.(open);
    };

    return (
        <Drawer.Root open={isOpen} onOpenChange={handleOpenChange} {...props}>
            <VaultContext.Provider value={{ isOpen, setIsOpen: handleOpenChange }}>
                {children}
            </VaultContext.Provider>
        </Drawer.Root>
    );
};

const VaultTrigger = React.forwardRef<
    React.ComponentRef<typeof Drawer.Trigger>,
    React.ComponentPropsWithoutRef<typeof Drawer.Trigger>
>(({ onClick, ...props }, ref) => {
    return (
        <Drawer.Trigger
            ref={ref}
            onClick={(e) => {
                if (e.currentTarget instanceof HTMLElement) {
                    e.currentTarget.blur();
                }
                onClick?.(e);
            }}
            {...props}
        />
    );
});
VaultTrigger.displayName = "VaultTrigger";
const VaultPortal = Drawer.Portal;

const VaultOverlay = React.forwardRef<
    React.ComponentRef<typeof Drawer.Overlay>,
    React.ComponentPropsWithoutRef<typeof Drawer.Overlay>
>(({ className, ...props }, ref) => {
    return (
        <Drawer.Overlay
            ref={ref}
            className={twMerge(
                "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
                className,
            )}
            {...props}
        />
    );
});
VaultOverlay.displayName = "VaultOverlay";

interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
    children: React.ReactNode;
}

const VisuallyHidden = React.forwardRef<HTMLSpanElement, VisuallyHiddenProps>(
    ({ className, ...props }, ref) => {
        return (
            <span
                ref={ref}
                className={twMerge(
                    "absolute left-[-10000px] top-auto w-px h-px overflow-hidden",
                    className
                )}
                {...props}
            />
        );
    }
);
VisuallyHidden.displayName = "VisuallyHidden";

const VaultContent = React.forwardRef<
    React.ComponentRef<typeof Drawer.Content>,
    React.ComponentPropsWithoutRef<typeof Drawer.Content> & {
        showHandle?: boolean;
        noPadding?: boolean;
    }
>(({ className, children, showHandle = true, noPadding = false, onOpenAutoFocus, ...props }, ref) => {
    const { isStandalone } = useDevice();

    return (
        <Drawer.Portal container={typeof document !== 'undefined' ? document.getElementById('vault-root') : null}>
            <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
            <Drawer.Content
                ref={ref}
                aria-describedby={undefined}
                aria-label={props["aria-label"] ?? "Vault"}
                tabIndex={-1}
                onOpenAutoFocus={(e) => {
                    if (onOpenAutoFocus) {
                        onOpenAutoFocus(e);
                        return;
                    }

                    e.preventDefault();

                    const container = e.currentTarget as HTMLElement;
                    const firstInput = container.querySelector(
                        'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])'
                    ) as HTMLElement;

                    if (firstInput) {
                        firstInput.focus();
                    } else {
                        container.focus();
                    }
                }}
                className={twMerge(
                    "fixed z-50 flex flex-col bg-background backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 outline-none",

                    isStandalone
                        ? "bottom-2 inset-x-2 w-auto rounded-2xl after:hidden! mt-24"
                        : "bottom-0 inset-x-0 w-full rounded-t-[20px] mt-24",

                    "sm:bottom-6 sm:inset-x-0 sm:mx-auto sm:w-full sm:max-w-lg sm:rounded-2xl sm:after:hidden! sm:mt-0 max-h-[90vh]",

                    className,
                )}
                {...props}
            >
                <VisuallyHidden>
                    <Drawer.Title>{props["aria-label"] ?? "Vault"}</Drawer.Title>
                </VisuallyHidden>
                {showHandle && (
                    <div className="mx-auto mt-4 mb-2 h-1.5 w-14 shrink-0 rounded-full bg-primary/50" />
                )}

                <div className={cn(
                    "overflow-y-auto no-scrollbar",
                    !noPadding && "px-6 pb-6 pt-2"
                )}>
                    {children}
                </div>
            </Drawer.Content>
        </Drawer.Portal>
    );
});
VaultContent.displayName = "VaultContent";

const VaultHeader = React.forwardRef<
    React.ComponentRef<typeof motion.div>,
    React.HTMLAttributes<HTMLDivElement> & {
        showCloseButton?: boolean;
    } & HTMLMotionProps<"div">
>(({ className, showCloseButton = true, children, ...props }, ref) => {
    return (
        <motion.div
            ref={ref}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.2 }}
            className={twMerge(
                "flex items-center justify-between pb-1",
                !showCloseButton && "justify-center",
                className,
            )}
            {...props}
        >
            <div
                className={`flex flex-col space-y-2 ${showCloseButton ? "flex-1" : "text-center"}`}
            >
                {children}
            </div>
        </motion.div>
    );
});
VaultHeader.displayName = "VaultHeader";

const VaultTitle = React.forwardRef<
    React.ComponentRef<typeof Drawer.Title>,
    React.ComponentPropsWithoutRef<typeof Drawer.Title>
>(({ className, ...props }, ref) => {
    return (
        <Drawer.Title
            ref={ref}
            className={twMerge(
                "text-xl font-bold text-center leading-tight tracking-tight text-gray-900 dark:text-gray-100",
                className,
            )}
            {...props}
        />
    );
});
VaultTitle.displayName = "VaultTitle";

const VaultDescription = React.forwardRef<
    React.ComponentRef<typeof motion.div>,
    React.ComponentPropsWithoutRef<typeof Drawer.Description> &
    HTMLMotionProps<"div">
>(({ className, children, ...props }, ref) => {
    return (
        <motion.div
            ref={ref}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.2 }}
            {...props}
        >
            <Drawer.Description
                className={twMerge(
                    "text-center text-sm text-gray-600 dark:text-gray-400 leading-relaxed",
                    className,
                )}
            >
                {children}
            </Drawer.Description>
        </motion.div>
    );
});
VaultDescription.displayName = "VaultDescription";

const VaultFooter = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & HTMLMotionProps<"div">) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.2 }}
            className={twMerge(
                "flex lg:flex-row md:flex-row flex-col justify-center gap-3 pt-4 border-t border-gray-200/50 dark:border-gray-700/50",
                className,
            )}
            {...props}
        />
    );
};
VaultFooter.displayName = "VaultFooter";

const VaultIcon = ({
    className,
    type = "info",
    src,
    alt = "",
    children,
    ...props
}: {
    className?: string;
    type?:
    | "info"
    | "warning"
    | "error"
    | "success"
    | "delete"
    | "confirm"
    | "close"
    | "settings"
    | "user"
    | "edit"
    | "download"
    | "upload"
    | "search"
    | "notification"
    | "heart"
    | "star"
    | "calendar"
    | "lock"
    | "unlock"
    | "home"
    | "document";
    src?: string;
    alt?: string;
    children?: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement> &
    HTMLMotionProps<"div">) => {
    const iconContent =
        children ||
        (src ? (
            <Image
                src={src}
                alt={alt}
                width={48}
                height={48}
                className="w-12 h-12 object-cover rounded-full"
                onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                    const target = e.currentTarget;
                    target.style.display = "none";
                    const fallbackIcon = target.nextElementSibling as HTMLElement | null;
                    if (fallbackIcon) {
                        fallbackIcon.style.display = "flex";
                    }
                }}
            />
        ) : (
            vaultIcons[type]
        ));

    return (
        <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.3, type: "spring" }}
            className={twMerge("flex justify-center items-center mb-3", className)}
            {...props}
        >
            {src ? (
                <div className="relative">
                    <Image
                        src={src}
                        alt={alt}
                        width={48}
                        height={48}
                        className="w-12 h-12 object-cover rounded-full"
                        onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                            const target = e.currentTarget;
                            target.style.display = "none";
                            const fallback = target.parentElement?.querySelector(
                                ".fallback-icon",
                            ) as HTMLElement | null;
                            if (fallback) {
                                fallback.style.display = "flex";
                            }
                        }}
                    />
                    <div className="fallback-icon hidden justify-center items-center w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full">
                        {vaultIcons[type]}
                    </div>
                </div>
            ) : (
                <div className="flex justify-center items-center w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full">
                    {iconContent}
                </div>
            )}
        </motion.div>
    );
};
VaultIcon.displayName = "VaultIcon";

// Vault Body Component
const VaultBody = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & HTMLMotionProps<"div">) => {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.2 }}
            className={twMerge("space-y-4 py-2", className)}
            {...props}
        />
    );
};
VaultBody.displayName = "VaultBody";

// Vault Form Component
const VaultForm = React.forwardRef<
    React.ComponentRef<typeof motion.form>,
    React.FormHTMLAttributes<HTMLFormElement> & HTMLMotionProps<"form">
>(({ className, ...props }, ref) => {
    return (
        <motion.form
            ref={ref}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.2 }}
            className={twMerge("space-y-4", className)}
            {...props}
        />
    );
});
VaultForm.displayName = "VaultForm";

const VaultField = ({
    label,
    required,
    error,
    children,
    className,
    ...props
}: {
    label?: string;
    required?: boolean;
    error?: string;
    children: React.ReactNode;
    className?: string;
} & React.HTMLAttributes<HTMLDivElement> &
    HTMLMotionProps<"div">) => {
    return (
        <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, duration: 0.2 }}
            className={twMerge("space-y-2", className)}
            {...props}
        >
            {label && (
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                </label>
            )}
            {children}
            {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
        </motion.div>
    );
};
VaultField.displayName = "VaultField";

const VaultInput = React.forwardRef<
    HTMLInputElement,
    React.ComponentPropsWithoutRef<typeof Input> & {
        error?: boolean;
        containerProps?: HTMLMotionProps<"div">;
    }
>(({ className, containerProps, ...props }, ref) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.2 }}
            {...containerProps}
        >
            <Input
                ref={ref}
                className={twMerge(
                    "h-10 px-4 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 rounded-md",
                    className,
                )}
                {...props}
            />
        </motion.div>
    );
});
VaultInput.displayName = "VaultInput";

const VaultPrimaryButton = React.forwardRef<
    React.ComponentRef<typeof motion.button>,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
        variant?: "default" | "destructive" | "secondary";
    } & HTMLMotionProps<"button">
>(({ className, variant = "default", ...props }, ref) => {
    const variantStyles = {
        default:
            "bg-primary hover:bg-primary-hover dark:bg-primary dark:hover:bg-primary-hover",
        destructive:
            "bg-destructive hover:bg-destructive-hover dark:bg-destructive dark:hover:bg-destructive-hover",
        secondary:
            "bg-secondary hover:bg-secondary-hover dark:bg-secondary dark:hover:bg-secondary-hover",
    };

    return (
        <motion.button
            ref={ref}
            whileHover={{ scale: 1.005 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            className={twMerge(
                `min-w-fit flex flex-1 items-center justify-center flex-row gap-2 px-7 py-3 lg:text-lg md:text-base text-sm font-semibold text-white rounded-md 
        transition-all duration-150 focus:outline-none 
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantStyles[variant]}`,
                className,
            )}
            {...props}
        />
    );
});
VaultPrimaryButton.displayName = "VaultPrimaryButton";

const VaultSecondaryButton = React.forwardRef<
    React.ComponentRef<typeof motion.button>,
    React.ButtonHTMLAttributes<HTMLButtonElement> & HTMLMotionProps<"button">
>(({ className, ...props }, ref) => {
    return (
        <motion.button
            ref={ref}
            whileHover={{ scale: 1.005 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            className={twMerge(
                `flex items-center justify-center gap-2 flex-row min-w-fit px-6 py-3 lg:text-lg md:text-base text-sm font-semibold 
        text-gray-700 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-200
        bg-slate-300/50 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
        rounded-md transition-all duration-150
        border border-gray-200/50 dark:border-gray-600/50 
        hover:border-gray-300/70 dark:hover:border-gray-500/70
        disabled:opacity-50 disabled:cursor-not-allowed`,
                className,
            )}
            {...props}
        />
    );
});
VaultSecondaryButton.displayName = "VaultSecondaryButton";

export {
    Vault,
    VaultTrigger,
    VaultPortal,
    VaultOverlay,
    VaultContent,
    VaultHeader,
    VaultTitle,
    VaultDescription,
    VaultBody,
    VaultForm,
    VaultField,
    VaultInput,
    VaultFooter,
    VaultIcon,
    VaultPrimaryButton,
    VaultSecondaryButton,
};

