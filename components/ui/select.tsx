"use client";
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import {
    Vault,
    VaultContent,
    VaultTrigger,
    VaultTitle,
} from "@/components/ui/vault";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/ui/use-device";
import { motion } from "framer-motion";

type SelectContextType = {
    isMobile: boolean;
    value?: string;
    onValueChange: (value: string) => void;
    open: boolean;
    setOpen: (open: boolean) => void;
    items: Record<string, React.ReactNode>;
};

const SelectContext = React.createContext<SelectContextType | null>(null);

const useSelectContext = () => {
    const context = React.useContext(SelectContext);
    if (!context)
        throw new Error(
            "Os componentes Select devem ser usados dentro de um <Select>"
        );
    return context;
};

const Select = ({
    children,
    value: controlledValue,
    onValueChange,
    defaultValue,
    open: controlledOpen,
    onOpenChange,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) => {
    const isMobile = useIsMobile();
    const [internalValue, setInternalValue] = React.useState(defaultValue || "");
    const [internalOpen, setInternalOpen] = React.useState(false);

    const value = controlledValue !== undefined ? controlledValue : internalValue;
    const open = controlledOpen !== undefined ? controlledOpen : internalOpen;

    const handleValueChange = (v: string) => {
        setInternalValue(v);
        onValueChange?.(v);
    };

    const handleOpenChange = (o: boolean) => {
        setInternalOpen(o);
        onOpenChange?.(o);
    };

    const items = React.useMemo(() => {
        const map: Record<string, React.ReactNode> = {};
        const traverse = (node: React.ReactNode) => {
            React.Children.forEach(node, (child) => {
                if (
                    React.isValidElement<{ value?: string; children?: React.ReactNode }>(
                        child
                    )
                ) {
                    const childProps = child.props;
                    if (
                        childProps &&
                        childProps.value !== undefined &&
                        typeof childProps.value === "string"
                    ) {
                        map[childProps.value] = childProps.children;
                    }
                    if (childProps && childProps.children) {
                        traverse(childProps.children);
                    }
                }
            });
        };
        traverse(children);
        return map;
    }, [children]);

    const contextValue = {
        isMobile,
        value,
        onValueChange: handleValueChange,
        open,
        setOpen: handleOpenChange,
        items,
    };

    if (isMobile) {
        return (
            <SelectContext.Provider value={contextValue}>
                <Vault open={open} onOpenChange={handleOpenChange}>
                    {children}
                </Vault>
            </SelectContext.Provider>
        );
    }

    return (
        <SelectContext.Provider value={contextValue}>
            <SelectPrimitive.Root
                value={value}
                onValueChange={handleValueChange}
                open={open}
                onOpenChange={handleOpenChange}
                {...props}
            >
                {children}
            </SelectPrimitive.Root>
        </SelectContext.Provider>
    );
};

const SelectGroup = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Group>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Group>
>(({ className, ...props }, ref) => {
    const { isMobile } = useSelectContext();
    if (isMobile) {
        return (
            <div
                ref={ref as React.Ref<HTMLDivElement>}
                className={cn("py-2", className)}
                {...(props as React.HTMLAttributes<HTMLDivElement>)}
            />
        );
    }
    return <SelectPrimitive.Group ref={ref} className={className} {...props} />;
});
SelectGroup.displayName = SelectPrimitive.Group.displayName;

const SelectValue = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Value>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Value>
>(({ className, placeholder, ...props }, ref) => {
    const { isMobile, value, items } = useSelectContext();
    if (isMobile) {
        return (
            <span
                ref={ref as React.Ref<HTMLSpanElement>}
                className={cn("truncate flex items-center gap-2", className)}
                {...(props as React.HTMLAttributes<HTMLSpanElement>)}
            >
                {value && items[value] ? items[value] : placeholder}
            </span>
        );
    }
    return (
        <SelectPrimitive.Value
            ref={ref}
            placeholder={placeholder}
            className={className}
            {...props}
        />
    );
});
SelectValue.displayName = SelectPrimitive.Value.displayName;

const SelectTrigger = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
        size?: "sm" | "default";
    }
>(({ className, size = "default", children, ...props }, ref) => {
    const { isMobile } = useSelectContext();

    const commonClasses = cn(
        "input capitalize flex-1",
        "flex w-full items-center justify-between gap-2 rounded-md border-none px-3 py-2 text-sm transition-all outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        "data-[size=default]:h-10 data-[size=sm]:h-8",
        "[&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
        className
    );

    if (isMobile) {
        return (
            <VaultTrigger asChild>
                <button
                    ref={ref as React.Ref<HTMLButtonElement>}
                    className={commonClasses}
                    data-size={size}
                    {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                >
                    {children}
                    <ChevronDownIcon className="size-4 opacity-50 shrink-0" />
                </button>
            </VaultTrigger>
        );
    }

    return (
        <SelectPrimitive.Trigger
            ref={ref}
            className={commonClasses}
            data-size={size}
            {...props}
        >
            {children}
            <SelectPrimitive.Icon asChild>
                <ChevronDownIcon className="size-4 opacity-50" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(
    (
        { className, children, position = "popper", align = "center", ...props },
        ref
    ) => {
        const { isMobile } = useSelectContext();

        if (isMobile) {
            return (
                <VaultContent aria-describedby={undefined}>
                    <VaultTitle className="sr-only">Opções disponíveis</VaultTitle>
                    <div className="mt-2 flex flex-col px-4 pb-8 pt-2 max-h-[70vh] overflow-y-auto">
                        {children}
                    </div>
                </VaultContent>
            );
        }

        return (
            <SelectPrimitive.Portal>
                <SelectPrimitive.Content
                    ref={ref}
                    className={cn(
                        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
                        position === "popper" &&
                        "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
                        className
                    )}
                    position={position}
                    align={align}
                    {...props}
                >
                    <SelectScrollUpButton />
                    <SelectPrimitive.Viewport
                        className={cn(
                            "p-1",
                            position === "popper" &&
                            "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width) scroll-my-1"
                        )}
                    >
                        {children}
                    </SelectPrimitive.Viewport>
                    <SelectScrollDownButton />
                </SelectPrimitive.Content>
            </SelectPrimitive.Portal>
        );
    }
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Label>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => {
    const { isMobile } = useSelectContext();
    if (isMobile) {
        return (
            <div
                ref={ref as React.Ref<HTMLDivElement>}
                className={cn(
                    "text-muted-foreground px-2 py-1.5 text-xs font-semibold",
                    className
                )}
                {...(props as React.HTMLAttributes<HTMLDivElement>)}
            />
        );
    }
    return (
        <SelectPrimitive.Label
            ref={ref}
            className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
            {...props}
        />
    );
});
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, value, ...props }, ref) => {
    const {
        isMobile,
        value: selectedValue,
        onValueChange,
        setOpen,
    } = useSelectContext();

    if (isMobile) {
        const isSelected = selectedValue === value;
        return (
            <motion.button
                ref={ref as React.Ref<HTMLButtonElement>}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                type="button"
                className={cn(
                    "capitalize! relative flex w-full items-center justify-between rounded-md px-3 py-3.5 text-sm outline-none transition-colors mb-0.5",
                    isSelected
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-foreground hover:bg-accent/50",
                    className
                )}
                onClick={() => {
                    if (value) onValueChange(value);
                    setOpen(false);
                }}
                {...(props as Omit<
                    React.ButtonHTMLAttributes<HTMLButtonElement>,
                    "value" | "onAnimationStart" | "onDragStart" | "onDragEnd" | "onDrag"
                >)}
            >
                {children}
                {isSelected && <CheckIcon className="size-4 text-primary shrink-0" />}
            </motion.button>
        );
    }

    return (
        <SelectPrimitive.Item
            ref={ref}
            value={value}
            className={cn(
                "capitalize focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
                className
            )}
            {...props}
        >
            <span className="absolute right-2 flex size-3.5 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                    <CheckIcon className="size-4" />
                </SelectPrimitive.ItemIndicator>
            </span>
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
    );
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
    React.ComponentRef<typeof SelectPrimitive.Separator>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => {
    const { isMobile } = useSelectContext();
    if (isMobile) {
        return (
            <div
                ref={ref as React.Ref<HTMLDivElement>}
                className={cn("bg-border -mx-1 my-1 h-px", className)}
                {...(props as React.HTMLAttributes<HTMLDivElement>)}
            />
        );
    }
    return (
        <SelectPrimitive.Separator
            ref={ref}
            className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
            {...props}
        />
    );
});
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

function SelectScrollUpButton({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
    return (
        <SelectPrimitive.ScrollUpButton
            className={cn(
                "flex cursor-default items-center justify-center py-1",
                className
            )}
            {...props}
        >
            <ChevronUpIcon className="size-4" />
        </SelectPrimitive.ScrollUpButton>
    );
}

function SelectScrollDownButton({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
    return (
        <SelectPrimitive.ScrollDownButton
            className={cn(
                "flex cursor-default items-center justify-center py-1",
                className
            )}
            {...props}
        >
            <ChevronDownIcon className="size-4" />
        </SelectPrimitive.ScrollDownButton>
    );
}

export {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
};