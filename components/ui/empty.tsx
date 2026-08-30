"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  containerVariants,
  iconVariants,
  itemVariants,
} from "@/lib/animations";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-md border-dashed p-6 text-center text-balance",
        className
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "font-heading text-lg font-medium tracking-tight",
        className
      )}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn(
        "text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance mt-4",
        className
      )}
      {...props}
    />
  );
}

interface EmptyResultsProps {
  searchQuery?: string;
  customMessage?: {
    withSearch?: string;
    withoutSearch?: string;
  };
  title?: string;
  description?: string;
  className?: string;
}

const EmptyResults: React.FC<EmptyResultsProps> = ({
  searchQuery = "",
  customMessage,
  title,
  description,
  className,
}) => {
  
  const defaultMessages = {
    withSearch: `Nenhum resultado encontrado para "${searchQuery}".`,
    withoutSearch: `Nenhum resultado encontrado.`,
  };

  const messages = { ...defaultMessages, ...customMessage };
  const message =
    title || (searchQuery ? messages.withSearch : messages.withoutSearch);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={className}
    >
      <Empty className="border-none py-8 text-primary/85 dark:text-primary/70">
        <EmptyHeader>
          <motion.div variants={iconVariants}>
            <EmptyMedia className="w-24 h-24 mb-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-full w-full text-primary/50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </EmptyMedia>
          </motion.div>

          <motion.div variants={itemVariants}>
            <EmptyTitle>{message}</EmptyTitle>
          </motion.div>

          {description && (
            <motion.div variants={itemVariants}>
              <EmptyDescription className="mt-1">
                {description}
              </EmptyDescription>
            </motion.div>
          )}

          {searchQuery && !title && (
            <motion.div variants={itemVariants}>
              <EmptyDescription className="mt-1">
                Ajuste a busca ou tente palavras-chave diferentes para encontrar o que você está procurando.
              </EmptyDescription>
            </motion.div>
          )}
        </EmptyHeader>
      </Empty>
    </motion.div>
  );
};

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
  EmptyResults,
};