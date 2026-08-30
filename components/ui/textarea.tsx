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
          "input",
          // Mantivemos o field-sizing-content e o min-h-16 originais do textarea para ele crescer corretamente,
          // mas aplicamos todas as cores, bordas, radius e seleções do Input.
          "placeholder:text-foreground selection:bg-primary selection:text-primary-foreground border-input flex field-sizing-content min-h-16 w-full min-w-0 rounded-md border px-3 py-2 text-base transition-all outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
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