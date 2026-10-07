import * as React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  /**
   * `pill` is the app's normal filled, rounded field. `underline` is just a
   * line under the text with no fill or box — for a field that IS the heading
   * of its surface (a note's title), where a box around it would read as a
   * form control rather than as the title.
   */
  variant?: "pill" | "underline";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, hasError, variant = "pill", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        aria-invalid={hasError ? true : undefined}
        className={cn(
          "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-border bg-secondary text-foreground h-11 w-full min-w-0 rounded-full border px-4 text-sm transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring",
          variant === "underline" &&
            "h-10 rounded-none border-0 border-b bg-transparent px-0 placeholder:opacity-50 focus-visible:border-primary",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
