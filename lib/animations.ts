export const pageVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
};

export const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.2,
        },
    },
};

export const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
        y: 0,
        opacity: 1,
        transition: {
            type: "spring" as const,
            stiffness: 120,
            damping: 12,
        },
    },
};

export const iconVariants = {
    hidden: { scale: 0.8, opacity: 0 },
    visible: {
        scale: 1,
        opacity: 1,
        transition: {
            type: "spring" as const,
            stiffness: 150,
            damping: 12,
            delay: 0.1,
        },
    },
};

export const fadeInUp = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -20, scale: 0.95 },
};

// ─── Animações centralizadas do Stepper ──────────────────────────────────────────────────

export const SPRING = { type: "spring", stiffness: 380, damping: 28 } as const;
export const EASE_LINE = { duration: 0.45, ease: [0.4, 0, 0.2, 1] } as const;
