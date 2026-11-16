"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Minus, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Vault, VaultBody, VaultContent, VaultHeader, VaultTitle } from "@/components/ui/vault";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { blockPause, htmlToRsvp, tokenDuration, type RsvpDocument, type RsvpToken } from "@/lib/rsvp/tokenize";

const WPM_STEP = 25;
const WPM_MIN = 100;
const WPM_MAX = 1000;

interface RsvpReaderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Note body or publication chapter HTML — only its text is read, it is never injected. */
  html: string;
}

/**
 * Speed reader (RSVP): one word at a time, always in the same spot, with the
 * Optimal Recognition Point letter tinted so the eye never has to travel.
 *
 * Hosted in a Vault like every other transient surface in the app (no modals).
 * "Fluxo" reads straight through, breathing longer between verses/paragraphs;
 * "Estudo" stops at the end of each one and shows it whole, so a verse or
 * paragraph is never a blur — Espaço continues.
 */
export function RsvpReader({ open, onOpenChange, title, html }: RsvpReaderProps) {
  return (
    <Vault open={open} onOpenChange={onOpenChange}>
      <VaultContent aria-label={`Leitura rápida — ${title}`} className="sm:max-w-md">
        <VaultHeader>
          <VaultTitle className="truncate text-base">{title || "Leitura rápida"}</VaultTitle>
        </VaultHeader>
        <VaultBody className="pb-4">{open && <RsvpPlayer html={html} />}</VaultBody>
      </VaultContent>
    </Vault>
  );
}

function RsvpPlayer({ html }: { html: string }) {
  const doc = useMemo<RsvpDocument>(() => htmlToRsvp(html), [html]);
  const { tokens, blocks } = doc;

  const wpm = usePreferencesStore((s) => s.rsvpWpm);
  const mode = usePreferencesStore((s) => s.rsvpMode);
  const setWpm = usePreferencesStore((s) => s.setRsvpWpm);
  const setMode = usePreferencesStore((s) => s.setRsvpMode);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Study mode: the block that just ended, shown whole while paused. */
  const [recap, setRecap] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);

  // Cumulative weights, so "time left" is cheap to show on every word.
  const prefix = useMemo(() => {
    const out = new Float64Array(tokens.length + 1);
    for (let i = 0; i < tokens.length; i++) out[i + 1] = out[i] + tokens[i].weight;
    return out;
  }, [tokens]);

  useEffect(() => {
    if (!playing) return;
    const token = tokens[index];
    if (!token) return;

    const block = blocks[token.block];
    const stopsHere = token.blockEnd && mode === "study" && !block.heading;
    let delay = tokenDuration(token, wpm);
    if (token.blockEnd && !stopsHere) delay += blockPause(block, wpm);

    const id = setTimeout(() => {
      const next = index + 1;
      if (next >= tokens.length) {
        setPlaying(false);
        setFinished(true);
        if (mode === "study") setRecap(token.block);
        return;
      }
      setIndex(next);
      if (stopsHere) {
        setPlaying(false);
        setRecap(token.block);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [playing, index, wpm, mode, tokens, blocks]);

  const currentBlock = recap ?? tokens[Math.min(index, tokens.length - 1)]?.block ?? 0;

  const goToBlock = useCallback(
    (block: number) => {
      const target = blocks[Math.max(0, Math.min(blocks.length - 1, block))];
      if (!target) return;
      setIndex(target.start);
      setRecap(null);
      setFinished(false);
    },
    [blocks]
  );

  const togglePlay = useCallback(() => {
    if (tokens.length === 0) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (finished) {
      setIndex(0);
      setFinished(false);
    }
    setRecap(null);
    setPlaying(true);
  }, [finished, playing, tokens.length]);

  const prev = useCallback(() => {
    // Mid-block: back to the start of this block first; at the start, the one before.
    const atStart = recap === null && tokens[index]?.block === currentBlock && index === blocks[currentBlock]?.start;
    goToBlock(recap !== null ? recap : atStart ? currentBlock - 1 : currentBlock);
  }, [blocks, currentBlock, goToBlock, index, recap, tokens]);

  const next = useCallback(() => {
    if (recap !== null) {
      // Index already sits on the following block.
      setRecap(null);
      return;
    }
    goToBlock(currentBlock + 1);
  }, [currentBlock, goToBlock, recap]);

  const restart = useCallback(() => {
    setPlaying(false);
    goToBlock(0);
  }, [goToBlock]);

  const nudgeWpm = useCallback(
    (delta: number) => setWpm(Math.min(WPM_MAX, Math.max(WPM_MIN, wpm + delta))),
    [setWpm, wpm]
  );

  // Keyboard, like the page it grew out of: space plays, arrows skip a block, up/down change speed, R restarts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          prev();
          break;
        case "ArrowRight":
          e.preventDefault();
          next();
          break;
        case "ArrowUp":
          e.preventDefault();
          nudgeWpm(WPM_STEP);
          break;
        case "ArrowDown":
          e.preventDefault();
          nudgeWpm(-WPM_STEP);
          break;
        case "r":
        case "R":
          restart();
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [nudgeWpm, next, prev, restart, togglePlay]);

  if (tokens.length === 0) {
    return (
      <p className="py-10 text-center text-[13.5px] text-muted-foreground">
        Não há texto para ler aqui.
      </p>
    );
  }

  const token = tokens[Math.min(index, tokens.length - 1)];
  const progress = finished ? 1 : prefix[index] / prefix[tokens.length];
  const remainingMin = Math.max(0, ((prefix[tokens.length] - prefix[index]) * (60000 / wpm)) / 60000);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex flex-col gap-5"
    >
      {/* Stage — also the tap target for play/pause, and no-drag so vaul never mistakes a tap for a sheet drag. */}
      <div
        data-vaul-no-drag
        onClick={togglePlay}
        className="relative flex h-44 cursor-pointer select-none items-center justify-center overflow-hidden rounded-3xl bg-secondary/40 [container-type:inline-size]"
      >
        <AnimatePresence mode="wait" initial={false}>
          {recap !== null ? (
            <motion.p
              key={`recap-${recap}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="max-h-full overflow-y-auto px-6 py-4 text-center text-[15px] leading-relaxed text-foreground/90"
            >
              {blocks[recap].text}
            </motion.p>
          ) : (
            <motion.div
              key="word"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="w-full"
            >
              <Word token={token} />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!playing && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-x-0 bottom-3 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground"
            >
              {finished ? "Fim" : recap !== null ? "Espaço para continuar" : index === 0 ? "Toque para começar" : "Pausado"}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Progress */}
      <div className="flex flex-col gap-1.5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
          <motion.div
            className="h-full origin-left rounded-full bg-accent"
            animate={{ scaleX: progress }}
            transition={{ ease: "linear", duration: 0.15 }}
          />
        </div>
        <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
          <span>
            {currentBlock + 1}/{blocks.length}
          </span>
          <span>{finished ? "concluído" : remainingMin < 1 ? "<1 min" : `~${Math.round(remainingMin)} min`}</span>
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center justify-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Voltar" onClick={prev}>
          <SkipBack />
        </Button>
        <Button
          size="icon"
          className="size-14"
          aria-label={playing ? "Pausar" : "Ler"}
          onClick={togglePlay}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={finished ? "again" : playing ? "pause" : "play"}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex"
            >
              {finished ? <RotateCcw className="size-5" /> : playing ? <Pause className="size-5" /> : <Play className="size-5" />}
            </motion.span>
          </AnimatePresence>
        </Button>
        <Button variant="ghost" size="icon" aria-label="Avançar" onClick={next}>
          <SkipForward />
        </Button>
      </div>

      {/* Speed + mode */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Mais devagar"
            disabled={wpm <= WPM_MIN}
            onClick={() => nudgeWpm(-WPM_STEP)}
          >
            <Minus />
          </Button>
          <span className="w-16 text-center font-mono text-[12px] tabular-nums text-foreground">{wpm} ppm</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Mais rápido"
            disabled={wpm >= WPM_MAX}
            onClick={() => nudgeWpm(WPM_STEP)}
          >
            <Plus />
          </Button>
        </div>

        <div role="group" aria-label="Modo de leitura" className="flex rounded-full bg-secondary p-0.5">
          {(
            [
              ["flow", "Fluxo"],
              ["study", "Estudo"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={mode === value ? "default" : "ghost"}
              size="xs"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn("font-sans", mode !== value && "text-muted-foreground")}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * One word with its ORP letter pinned to the horizontal centre: the part
 * before it grows leftwards, the part after it rightwards, so the eye stays put.
 * Font size shrinks with the longer side (container query units) so a long
 * word still fits the stage instead of being clipped.
 */
function Word({ token }: { token: RsvpToken }) {
  const { text, orp } = token;
  const before = text.slice(0, orp);
  const pivot = text.charAt(orp);
  const after = text.slice(orp + 1);
  const longest = Math.max(before.length + 0.5, after.length + 0.5);
  const size = `min(2.9rem, ${(50 / (0.6 * longest)).toFixed(2)}cqw)`;

  return (
    <div className="relative flex flex-col items-center">
      <span aria-hidden className="mb-2 h-3 w-px bg-border" />
      <div
        className="grid w-full grid-cols-[1fr_auto_1fr] items-baseline whitespace-nowrap font-sans leading-none tracking-tight text-foreground"
        style={{ fontSize: size }}
        aria-label={text}
      >
        <span className="text-right">{before}</span>
        <span className="text-accent">{pivot}</span>
        <span className="text-left">{after}</span>
      </div>
      <span aria-hidden className="mt-2 h-3 w-px bg-border" />
    </div>
  );
}
