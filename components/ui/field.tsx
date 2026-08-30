import * as React from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
    label: string;
    children: React.ReactNode;
    required?: boolean;
    error?: string;
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
    ({ label, children, required, error, className, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn("flex flex-col gap-2", className)}
                {...props}
            >
                <label className="text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    {label}
                    {required && <span className="text-destructive ml-1">*</span>}
                </label>
                {children}
                {error && (
                    <p className="text-xs font-medium text-destructive ml-1">
                        {error}
                    </p>
                )}
            </div>
        );
    }
);
Field.displayName = "Field";

export { Field };