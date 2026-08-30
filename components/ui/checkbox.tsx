"use client";
import * as React from "react";
import { useRef, useEffect, useCallback } from "react";
import { gsap } from "gsap";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  onCheckedChange?: (checked: boolean) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      onCheckedChange,
      onChange,
      checked,
      defaultChecked,
      disabled,
      ...props
    },
    ref
  ) => {
    const [internalChecked, setInternalChecked] = React.useState(
      defaultChecked ?? false
    );
    const isChecked = checked !== undefined ? checked : internalChecked;

    const boxRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<SVGCircleElement>(null);
    const tickRef = useRef<SVGPathElement>(null);
    const prevChecked = useRef(isChecked);

    const setInputRef = useCallback(
      (node: HTMLInputElement | null) => {
        if (typeof ref === "function") ref(node);
        else if (ref)
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
      },
      [ref]
    );

    // ------------------------------------------------------------------
    // CHECK animation
    // ------------------------------------------------------------------
    const animateCheck = useCallback(() => {
      const box = boxRef.current;
      const fill = fillRef.current;
      const tick = tickRef.current;
      if (!box || !fill || !tick) return;

      const tl = gsap.timeline();

      gsap.set(tick, { strokeDashoffset: 24 });

      // 1. Squeeze in
      tl.to(box, { scale: 0.82, duration: 0.1, ease: "power2.in" })

        // 2. Expand with fill
        .to(box, {
          scale: 1.12,
          duration: 0.18,
          ease: "power2.out",
          onStart() {
            box.style.boxShadow = "inset 0 0 0 13px var(--cb-active)";
            gsap.to(fill, { attr: { r: 13 }, duration: 0.18, ease: "power2.out" });
          },
        })

        // 3. Elastic settle
        .to(box, { scale: 1, duration: 0.35, ease: "elastic.out(1.2, 0.5)" })

        // Corner pinch
        .to(box, { borderRadius: "11px", duration: 0.1 }, 0.1)
        .to(box, { borderRadius: "7px", duration: 0.22 }, 0.2)

        // 4. Tick draws in
        .to(tick, { strokeDashoffset: 0, duration: 0.3, ease: "power2.out" }, 0.22);
    }, []);

    // ------------------------------------------------------------------
    // UNCHECK animation
    // ------------------------------------------------------------------
    const animateUncheck = useCallback(() => {
      const box = boxRef.current;
      const fill = fillRef.current;
      const tick = tickRef.current;
      if (!box || !fill || !tick) return;

      const tl = gsap.timeline();

      // 1. Tick wipes out
      tl.to(tick, { strokeDashoffset: -24, duration: 0.16, ease: "power2.in" })

        // 2. Squeeze
        .to(box, { scale: 0.85, duration: 0.1, ease: "power2.in" }, 0.08)

        // 3. Fill shrinks
        .to(fill, {
          attr: { r: 0 },
          duration: 0.2,
          ease: "power2.in",
          onStart() {
            box.style.boxShadow = "inset 0 0 0 2px var(--cb-default)";
          },
        }, 0.1)

        // 4. Elastic bounce back
        .to(box, { scale: 1.08, duration: 0.18, ease: "power2.out" }, 0.2)
        .to(box, { scale: 1, duration: 0.35, ease: "elastic.out(1.3, 0.5)" }, 0.38)

        // 5. Reset dashoffset silently
        .set(tick, { strokeDashoffset: 24 }, 0.6);
    }, []);

    // Sync controlled changes
    useEffect(() => {
      if (prevChecked.current !== isChecked) {
        if (isChecked) animateCheck();
        else animateUncheck();
        prevChecked.current = isChecked;
      }
    }, [isChecked, animateCheck, animateUncheck]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.checked;
      if (checked === undefined) setInternalChecked(next);
      onChange?.(e);
      onCheckedChange?.(next);
    };

    return (
      <div
        ref={boxRef}
        className={cn("relative inline-flex shrink-0", className)}
        style={
          {
            width: 24,
            height: 24,
            borderRadius: 7,
            boxShadow: isChecked
              ? "inset 0 0 0 13px var(--cb-active)"
              : "inset 0 0 0 2px var(--cb-default)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            "--cb-active": "var(--primary)",
            "--cb-default": "var(--border)",
          } as React.CSSProperties
        }
      >
        <input
          type="checkbox"
          ref={setInputRef}
          checked={isChecked}
          disabled={disabled}
          onChange={handleChange}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            width: "100%",
            height: "100%",
            cursor: disabled ? "not-allowed" : "pointer",
            margin: 0,
            zIndex: 1,
          }}
          {...props}
        />

        <svg
          viewBox="0 0 26 26"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          {/* Fill circle — GSAP animates r 0 ↔ 13 */}
          <circle
            ref={fillRef}
            cx="13"
            cy="13"
            r={isChecked ? 13 : 0}
            fill="var(--primary)"
          />

          {/* Checkmark */}
          <path
            ref={tickRef}
            d="M6 13L11 18L20 8"
            stroke="var(--primary-foreground)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="24"
            strokeDashoffset={isChecked ? "0" : "24"}
          />
        </svg>
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";

export { Checkbox };