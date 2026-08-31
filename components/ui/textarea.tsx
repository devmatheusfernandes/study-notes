import * as React from "react";
import { cn } from "@/lib/utils";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, hasError, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        aria-invalid={hasError ? true : undefined}
        className={cn(
          // Mantivemos o field-sizing-content e o min-h-16 originais do textarea para ele crescer corretamente,
          // mas aplicamos todas as cores, bordas, radius e seleções do Input.
          "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-border bg-secondary text-foreground flex field-sizing-content min-h-16 w-full min-w-0 rounded-2xl border px-4 py-3 text-base transition-colors outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };