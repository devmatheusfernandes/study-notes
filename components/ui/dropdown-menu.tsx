"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import {
    Vault,
    VaultContent,
    VaultTitle,
    VaultTrigger,
} from "@/components/ui/vault";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/ui/use-device";

type DropdownMenuContextType = {
    isMobile: boolean;
    open: boolean;
    setOpen: (open: boolean) => void;
};

const DropdownMenuContext = React.createContext<DropdownMenuContextType | null>(
    null
);

const useDropdownMenuContext = () => {
    const context = React.useContext(DropdownMenuContext);
    if (!context)
        throw new Error(
            "Os componentes DropdownMenu devem ser usados dentro de um <DropdownMenu>"
        );
    return context;
};

type MobileRadioGroupContextType = {
    value: string;
    setValue: (value: string) => void;
};

const MobileRadioGroupContext =
    React.createContext<MobileRadioGroupContextType | null>(null);

const useMobileRadioGroupContext = () =>
    React.useContext(MobileRadioGroupContext);

type MobileSubMenuContextType = {
    open: boolean;
    setOpen: (open: boolean) => void;
};

const MobileSubMenuContext =
    React.createContext<MobileSubMenuContextType | null>(null);

const useMobileSubMenuContext = () => React.useContext(MobileSubMenuContext);

function DropdownMenu({
    open: controlledOpen,
    defaultOpen,
    onOpenChange,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
    const isMobile = useIsMobile();
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);

    const open = controlledOpen !== undefined ? controlledOpen : internalOpen;

    const handleOpenChange = React.useCallback(
        (nextOpen: boolean) => {
            setInternalOpen(nextOpen);
            onOpenChange?.(nextOpen);
        },
        [onOpenChange]
    );

    const contextValue = React.useMemo(
        () => ({ isMobile, open, setOpen: handleOpenChange }),
        [isMobile, open, handleOpenChange]
    );

    if (isMobile) {
        return (
            <DropdownMenuContext.Provider value={contextValue}>
                <Vault open={open} onOpenChange={handleOpenChange}>
                    {props.children}
                </Vault>
            </DropdownMenuContext.Provider>
        );
    }

    return (
        <DropdownMenuContext.Provider value={contextValue}>
            <DropdownMenuPrimitive.Root
                data-slot="dropdown-menu"
                open={open}
                onOpenChange={handleOpenChange}
                {...props}
            />
        </DropdownMenuContext.Provider>
    );
}

function DropdownMenuPortal({
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
    const { isMobile } = useDropdownMenuContext();
    if (isMobile) return <>{props.children}</>;
    return (
        <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
    );
}

function DropdownMenuTrigger({
    asChild,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
    const { isMobile } = useDropdownMenuContext();
    if (isMobile) {
        if (asChild) return <VaultTrigger asChild>{children}</VaultTrigger>;
        return (
            <VaultTrigger asChild>
                <button
                    type="button"
                    {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                >
                    {children}
                </button>
            </VaultTrigger>
        );
    }
    return (
        <DropdownMenuPrimitive.Trigger
            data-slot="dropdown-menu-trigger"
            asChild={asChild}
            {...props}
        >
            {children}
        </DropdownMenuPrimitive.Trigger>
    );
}

function DropdownMenuContent({
    className,
    children,
    sideOffset = 4,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
    const { isMobile } = useDropdownMenuContext();

    if (isMobile) {
        return (
            <VaultContent aria-describedby={undefined} className="items-center flex flex-col">
                <VaultTitle className="sr-only">Opções disponíveis</VaultTitle>
                <div
                    data-slot="dropdown-menu-content"
                    className={cn(
                        "mt-2 flex flex-col px-4 pb-8 pt-2 max-h-[80vh] overflow-y-auto w-full",
                        className
                    )}
                    {...(props as React.HTMLAttributes<HTMLDivElement>)}
                >
                    <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-1">
                        {children}
                    </div>
                </div>
            </VaultContent>
        );
    }

    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                data-slot="dropdown-menu-content"
                sideOffset={sideOffset}
                className={cn(
                    "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
                    className
                )}
                {...props}
            >
                {children}
            </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
    );
}

function DropdownMenuGroup({
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
    const { isMobile } = useDropdownMenuContext();
    if (isMobile)
        return (
            <div
                data-slot="dropdown-menu-group"
                className="flex flex-col gap-1"
                {...(props as React.HTMLAttributes<HTMLDivElement>)}
            >
                {children}
            </div>
        );
    return (
        <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props}>
            {children}
        </DropdownMenuPrimitive.Group>
    );
}

function DropdownMenuItem({
    className,
    inset,
    variant = "default",
    children,
    disabled,
    onClick,
    onSelect,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
    variant?: "default" | "destructive";
}) {
    const { isMobile, setOpen } = useDropdownMenuContext();
    if (isMobile) {
        return (
            <button
                type="button"
                data-slot="dropdown-menu-item"
                data-inset={inset}
                data-variant={variant}
                aria-disabled={disabled}
                disabled={disabled}
                className={cn(
                    "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:text-destructive! [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-lg px-3 py-3 text-sm outline-hidden select-none disabled:pointer-events-none disabled:opacity-50 data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 hover:bg-accent/50 transition-colors",
                    className
                )}
                onClick={(event) => {
                    const mappedEvent = event as unknown as React.MouseEvent<HTMLDivElement> & Event;

                    onClick?.(mappedEvent);
                    onSelect?.(mappedEvent);
                    if (!event.defaultPrevented) setOpen(false);
                }}
                {...(props as Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect" | "onClick">)}
            >
                {children}
            </button>
        );
    }
    return (
        <DropdownMenuPrimitive.Item
            data-slot="dropdown-menu-item"
            data-inset={inset}
            data-variant={variant}
            disabled={disabled}
            onClick={onClick}
            onSelect={onSelect}
            className={cn(
                "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:text-destructive! [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className
            )}
            {...props}
        >
            {children}
        </DropdownMenuPrimitive.Item>
    );
}

function DropdownMenuCheckboxItem({
    className,
    children,
    checked,
    disabled,
    onCheckedChange,
    onClick,
    onSelect,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
    const { isMobile, setOpen } = useDropdownMenuContext();
    if (isMobile) {
        return (
            <button
                type="button"
                data-slot="dropdown-menu-checkbox-item"
                aria-disabled={disabled}
                disabled={disabled}
                className={cn(
                    "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-lg py-3 pr-3 pl-9 text-sm outline-hidden select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 hover:bg-accent/50 transition-colors",
                    className
                )}
                onClick={(event) => {
                    const mappedEvent = event as unknown as React.MouseEvent<HTMLDivElement> & Event;

                    onClick?.(mappedEvent);
                    if (!disabled) {
                        const nextChecked = checked === true ? false : true;
                        onCheckedChange?.(nextChecked);
                    }
                    onSelect?.(mappedEvent);
                    if (!event.defaultPrevented) setOpen(false);
                }}
                {...(props as Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect" | "onClick">)}
            >
                <span className="pointer-events-none absolute left-3 flex size-3.5 items-center justify-center">
                    {checked === true && <CheckIcon className="size-4" />}
                </span>
                {children}
            </button>
        );
    }
    return (
        <DropdownMenuPrimitive.CheckboxItem
            data-slot="dropdown-menu-checkbox-item"
            className={cn(
                "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className
            )}
            checked={checked}
            disabled={disabled}
            onClick={onClick}
            onCheckedChange={onCheckedChange}
            onSelect={onSelect}
            {...props}
        >
            <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <CheckIcon className="size-4" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownMenuPrimitive.CheckboxItem>
    );
}

function DropdownMenuRadioGroup({
    value: controlledValue,
    defaultValue,
    onValueChange,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
    const { isMobile } = useDropdownMenuContext();
    const [internalValue, setInternalValue] = React.useState<string>(() =>
        typeof defaultValue === "string" ? defaultValue : ""
    );

    const value =
        typeof controlledValue === "string" ? controlledValue : internalValue;

    const setValue = (nextValue: string) => {
        setInternalValue(nextValue);
        onValueChange?.(nextValue);
    };

    if (isMobile) {
        return (
            <MobileRadioGroupContext.Provider value={{ value, setValue }}>
                <div
                    data-slot="dropdown-menu-radio-group"
                    className="flex flex-col gap-1"
                    {...(props as React.HTMLAttributes<HTMLDivElement>)}
                >
                    {children}
                </div>
            </MobileRadioGroupContext.Provider>
        );
    }
    return (
        <DropdownMenuPrimitive.RadioGroup
            data-slot="dropdown-menu-radio-group"
            value={controlledValue}
            defaultValue={defaultValue}
            onValueChange={onValueChange}
            {...props}
        />
    );
}

function DropdownMenuRadioItem({
    className,
    children,
    value,
    disabled,
    onClick,
    onSelect,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
    const { isMobile, setOpen } = useDropdownMenuContext();
    const group = useMobileRadioGroupContext();
    if (isMobile) {
        const normalizedValue = typeof value === "string" ? value : String(value);
        const isSelected = group ? group.value === normalizedValue : false;
        return (
            <button
                type="button"
                data-slot="dropdown-menu-radio-item"
                aria-disabled={disabled}
                disabled={disabled}
                className={cn(
                    "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-lg py-3 pr-3 pl-9 text-sm outline-hidden select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 hover:bg-accent/50 transition-colors",
                    className
                )}
                onClick={(event) => {
                    const mappedEvent = event as unknown as React.MouseEvent<HTMLDivElement> & Event;

                    onClick?.(mappedEvent);
                    if (!disabled) group?.setValue(normalizedValue);
                    onSelect?.(mappedEvent);
                    if (!event.defaultPrevented) setOpen(false);
                }}
                {...(props as Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect" | "onClick" | "value">)}
            >
                <span className="pointer-events-none absolute left-3 flex size-3.5 items-center justify-center">
                    {isSelected && <CircleIcon className="size-2 fill-current" />}
                </span>
                {children}
            </button>
        );
    }
    return (
        <DropdownMenuPrimitive.RadioItem
            data-slot="dropdown-menu-radio-item"
            value={value}
            disabled={disabled}
            onClick={onClick}
            onSelect={onSelect}
            className={cn(
                "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className
            )}
            {...props}
        >
            <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <CircleIcon className="size-2 fill-current" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownMenuPrimitive.RadioItem>
    );
}

function DropdownMenuLabel({
    className,
    inset,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
}) {
    const { isMobile } = useDropdownMenuContext();
    if (isMobile) {
        return (
            <div
                data-slot="dropdown-menu-label"
                data-inset={inset}
                className={cn(
                    "px-3 py-2 text-sm font-semibold text-foreground/70 data-inset:pl-8",
                    className
                )}
                {...(props as React.HTMLAttributes<HTMLDivElement>)}
            >
                {children}
            </div>
        );
    }
    return (
        <DropdownMenuPrimitive.Label
            data-slot="dropdown-menu-label"
            data-inset={inset}
            className={cn(
                "px-2 py-1.5 text-sm font-medium data-inset:pl-8",
                className
            )}
            {...props}
        >
            {children}
        </DropdownMenuPrimitive.Label>
    );
}

function DropdownMenuSeparator({
    className,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
    const { isMobile } = useDropdownMenuContext();
    if (isMobile) {
        return (
            <div
                data-slot="dropdown-menu-separator"
                className={cn("bg-border/60 -mx-1 my-2 h-px", className)}
                {...(props as React.HTMLAttributes<HTMLDivElement>)}
            />
        );
    }
    return (
        <DropdownMenuPrimitive.Separator
            data-slot="dropdown-menu-separator"
            className={cn("bg-border -mx-1 my-1 h-px", className)}
            {...props}
        />
    );
}

function DropdownMenuShortcut({
    className,
    ...props
}: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="dropdown-menu-shortcut"
            className={cn(
                "text-muted-foreground ml-auto text-xs tracking-widest",
                className
            )}
            {...props}
        />
    );
}

function DropdownMenuSub({
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
    const { isMobile } = useDropdownMenuContext();
    const [open, setOpen] = React.useState(false);
    if (isMobile) {
        return (
            <MobileSubMenuContext.Provider value={{ open, setOpen }}>
                <div
                    data-slot="dropdown-menu-sub"
                    className="flex flex-col"
                    {...(props as React.HTMLAttributes<HTMLDivElement>)}
                >
                    {children}
                </div>
            </MobileSubMenuContext.Provider>
        );
    }
    return (
        <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props}>
            {children}
        </DropdownMenuPrimitive.Sub>
    );
}

function DropdownMenuSubTrigger({
    className,
    inset,
    children,
    disabled,
    onClick,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
}) {
    const { isMobile } = useDropdownMenuContext();
    const sub = useMobileSubMenuContext();

    if (isMobile) {
        return (
            <button
                type="button"
                data-slot="dropdown-menu-sub-trigger"
                data-inset={inset}
                aria-disabled={disabled}
                disabled={disabled}
                className={cn(
                    "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent/50 data-[state=open]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex w-full cursor-default items-center gap-2 rounded-lg px-3 py-3 text-sm outline-hidden select-none disabled:pointer-events-none disabled:opacity-50 data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 transition-colors",
                    className
                )}
                data-state={sub?.open ? "open" : "closed"}
                onClick={(event) => {
                    onClick?.(event as unknown as React.MouseEvent<HTMLDivElement>);
                    if (!disabled) sub?.setOpen(!sub.open);
                }}
                {...(props as Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">)}
            >
                {children}
                <ChevronRightIcon
                    className={cn(
                        "ml-auto size-4 transition-transform duration-200",
                        sub?.open && "rotate-90"
                    )}
                />
            </button>
        );
    }

    return (
        <DropdownMenuPrimitive.SubTrigger
            data-slot="dropdown-menu-sub-trigger"
            data-inset={inset}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className
            )}
            {...props}
        >
            {children}
            <ChevronRightIcon className="ml-auto size-4" />
        </DropdownMenuPrimitive.SubTrigger>
    );
}

function DropdownMenuSubContent({
    className,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
    const { isMobile } = useDropdownMenuContext();
    const sub = useMobileSubMenuContext();

    if (isMobile) {
        // Solução: AnimatePresence e Framer Motion para o Accordion Suave
        return (
            <AnimatePresence initial={false}>
                {sub?.open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                    >
                        <div
                            data-slot="dropdown-menu-sub-content"
                            className={cn(
                                "ml-[18px] mt-1 flex flex-col gap-1 border-l-2 border-border pl-4",
                                className
                            )}
                            {...(props as React.HTMLAttributes<HTMLDivElement>)}
                        >
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        );
    }

    return (
        <DropdownMenuPrimitive.SubContent
            data-slot="dropdown-menu-sub-content"
            className={cn(
                "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg",
                className
            )}
            {...props}
        >
            {children}
        </DropdownMenuPrimitive.SubContent>
    );
}

export {
    DropdownMenu,
    DropdownMenuPortal,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
};