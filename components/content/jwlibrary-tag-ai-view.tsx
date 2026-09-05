"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { notify } from "@/components/ui/toaster";
import { useDevice } from "@/hooks/ui/use-device";
import { ProcessingShimmer } from "./upload-progress-indicators";
import {
  listOwnJwlibraryTags,
  createJwlibraryTag,
  renameJwlibraryTag,
  mergeJwlibraryTags,
  addTagToJwlibraryNote,
  removeTagFromJwlibraryNote,
} from "@/app/(app)/jwlibrary-actions";
import { generateJwlibraryTagPlan, type JwlibraryTagAiModel } from "@/app/(app)/jwlibrary-tag-ai-actions";
import { loadTagPlan, saveTagPlan, clearTagPlan } from "@/lib/jwlibrary/tag-plan-storage";
import type { TagPlan, TagPlanOperation } from "@/lib/jwlibrary/tag-plan-types";

const NOTE_TITLE_MAX_CHARS = 100;

/** Some jwlibrary notes carry a full verse/paragraph as their "title" (no separate short title in the source backup) — cap it so one row doesn't dominate the list. */
function displayNoteTitle(title: string): string {
  const trimmed = title.trim() || "Sem título";
  return trimmed.length > NOTE_TITLE_MAX_CHARS ? `${trimmed.slice(0, NOTE_TITLE_MAX_CHARS)}…` : trimmed;
}

type CreateOp = Extract<TagPlanOperation, { op: "create" }>;
type RenameOp = Extract<TagPlanOperation, { op: "rename" }>;
type MergeOp = Extract<TagPlanOperation, { op: "merge" }>;
type AssignOp = Extract<TagPlanOperation, { op: "assign" }>;

function keyOf(op: TagPlanOperation): string {
  switch (op.op) {
    case "create":
      return `create:${op.tempId}`;
    case "rename":
      return `rename:${op.tagId}`;
    case "merge":
      return `merge:${op.sourceTagId}:${op.targetTagId}`;
    case "assign":
      return `assign:${op.noteId}`;
  }
}

/** Applies one operation against a given tempId->realId map (so bulk apply can thread its own local snapshot instead of stale React state). */
async function applyOperation(
  op: TagPlanOperation,
  tempIdMap: Record<string, string>
): Promise<{ error?: string; newId?: string }> {
  switch (op.op) {
    case "create": {
      const result = await createJwlibraryTag(op.name);
      return result.error ? { error: result.error } : { newId: result.id };
    }
    case "rename":
      return renameJwlibraryTag(op.tagId, op.newName);
    case "merge":
      return mergeJwlibraryTags(op.sourceTagId, op.targetTagId);
    case "assign": {
      const resolve = (ref: string) => tempIdMap[ref] ?? ref;
      const results = await Promise.all([
        ...op.addRefs.map((ref) => addTagToJwlibraryNote(op.noteId, resolve(ref))),
        ...op.removeTagIds.map((id) => removeTagFromJwlibraryNote(op.noteId, id)),
      ]);
      const failed = results.find((r) => r.error);
      return failed ? { error: failed.error } : {};
    }
  }
}

const OPERATION_ORDER: TagPlanOperation["op"][] = ["create", "rename", "merge", "assign"];

/**
 * Desktop-only AI review screen for reorganizing JW Library tags — see
 * /jwlibrary/tag-ai. Nothing here touches the database until an operation is
 * individually (or bulk-) approved; the plan itself only ever lives in
 * localStorage (lib/jwlibrary/tag-plan-storage.ts), never sent to the server
 * for storage.
 */
export function JwlibraryTagAiView() {
  const { isMobile } = useDevice();
  const [plan, setPlan] = useState<TagPlan | null>(null);
  const [existingTagNameById, setExistingTagNameById] = useState<Record<string, string>>({});

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<JwlibraryTagAiModel>("gpt-4o-mini");
  const [generating, setGenerating] = useState(false);

  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    const loaded = loadTagPlan();
    if (loaded) {
      // Deferred a tick — same pattern as jwlibrary-note-editor-vault.tsx —
      // so this doesn't trip the "no synchronous setState in an effect" rule.
      queueMicrotask(() => setPlan(loaded));
      void refreshTagNames();
    }
  }, []);

  async function refreshTagNames() {
    const result = await listOwnJwlibraryTags();
    const map: Record<string, string> = {};
    for (const t of result.tags ?? []) map[t.id] = t.name ?? "";
    setExistingTagNameById(map);
  }

  function nameForRef(ref: string): string {
    const pendingCreate = plan?.operations.find((o): o is CreateOp => o.op === "create" && o.tempId === ref);
    if (pendingCreate) return pendingCreate.name;
    const realId = plan?.tempIdMap[ref] ?? ref;
    // Defense in depth: the server resolves every ref to a real name/id before
    // this ever reaches the client, so this should never actually miss — but
    // if it ever does, show a label instead of leaking a raw id into the UI.
    return existingTagNameById[realId] ?? "tag desconhecida";
  }

  function isRefReady(ref: string): boolean {
    if (!plan) return false;
    if (plan.tempIdMap[ref]) return true;
    return !plan.operations.some((o) => o.op === "create" && o.tempId === ref);
  }

  function updatePlan(updater: (plan: TagPlan) => TagPlan) {
    setPlan((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      if (next.operations.length === 0) {
        clearTagPlan();
        return null;
      }
      saveTagPlan(next);
      return next;
    });
  }

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed) {
      notify.error("Escreva uma instrução para a IA seguir.");
      return;
    }
    setGenerating(true);
    const result = await generateJwlibraryTagPlan(trimmed, model);
    setGenerating(false);
    if (result.error || !result.plan) {
      notify.error("Não foi possível gerar sugestões", result.error);
      return;
    }
    if (result.plan.operations.length === 0) {
      notify.info("Nada para sugerir", "A IA não encontrou nenhuma mudança para essa instrução.");
      return;
    }
    setPlan(result.plan);
    saveTagPlan(result.plan);
    setPrompt("");
    void refreshTagNames();
  }

  function reject(op: TagPlanOperation) {
    updatePlan((p) => ({ ...p, operations: p.operations.filter((o) => o !== op) }));
  }

  // Bulk approve reads this between awaits instead of the `plan` closure —
  // updatePlan's setState is async, so a plain closure would see a stale
  // tempIdMap/operations list one iteration behind.
  const planRef = useRef<TagPlan | null>(null);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  /** Applies one operation and, on success, commits it out of the plan — shared by the single "Aprovar" button and the bulk loop below, so both animate/behave identically. */
  async function applyAndCommit(op: TagPlanOperation): Promise<boolean> {
    const key = keyOf(op);
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      const result = await applyOperation(op, planRef.current?.tempIdMap ?? {});
      if (result.error) {
        notify.error("Não foi possível aplicar essa sugestão", result.error);
        return false;
      }
      updatePlan((p) => {
        let operations = p.operations.filter((o) => o !== op);
        let tempIdMap = p.tempIdMap;
        if (op.op === "create" && result.newId) {
          tempIdMap = { ...tempIdMap, [op.tempId]: result.newId };
        }
        if (op.op === "merge") {
          operations = operations.map((o) =>
            o.op === "assign"
              ? {
                  ...o,
                  addRefs: o.addRefs.map((r) => (r === op.sourceTagId ? op.targetTagId : r)),
                  removeTagIds: o.removeTagIds.map((r) => (r === op.sourceTagId ? op.targetTagId : r)),
                }
              : o
          );
        }
        return { ...p, operations, tempIdMap };
      });
      if (op.op === "create") void refreshTagNames();
      return true;
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function approve(op: TagPlanOperation) {
    await applyAndCommit(op);
  }

  async function approveAllVisible() {
    if (!plan) return;
    setBulkBusy(true);
    const failedKeys = new Set<string>();
    let failures = 0;

    // One at a time, in dependency order (creates before the assigns that
    // reference them, merges before the assigns that pointed at the source
    // tag) — each success updates `plan` immediately via applyAndCommit, so
    // the row animates out and the next one picks up right after, instead of
    // everything jumping at once at the very end.
    for (const kind of OPERATION_ORDER) {
      for (;;) {
        const op = planRef.current?.operations.find((o) => o.op === kind && !failedKeys.has(keyOf(o)));
        if (!op) break;
        const ok = await applyAndCommit(op);
        if (!ok) {
          failures += 1;
          failedKeys.add(keyOf(op));
        }
      }
    }

    setBulkBusy(false);
    if (failures > 0) {
      notify.error("Algumas sugestões não puderam ser aplicadas", `${failures} falharam — revise item a item.`);
    } else {
      notify.success("Sugestões aplicadas");
    }
  }

  function rejectAllVisible() {
    clearTagPlan();
    setPlan(null);
    notify.info("Sugestões descartadas");
  }

  if (isMobile) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
        <Sparkles className="size-6 text-muted-foreground" />
        <p className="text-[15px] font-medium text-foreground">Disponível apenas no computador</p>
        <p className="max-w-xs text-[13.5px] text-muted-foreground">
          Revisar sugestões de tags lado a lado precisa de mais espaço de tela — abra o Study Notes no computador
          para usar essa ferramenta.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 pb-28">
      <Link
        href="/jwlibrary"
        className="flex w-fit items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[13px] text-foreground/80 transition-colors hover:bg-surface"
      >
        <ChevronLeft className="size-4" />
        Estudo Pessoal
      </Link>

      {!plan ? (
        <div className="flex flex-col gap-4 rounded-3xl border border-border bg-surface p-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-base text-foreground">O que você quer que a IA faça?</h2>
            <p className="text-[13px] text-muted-foreground">
              Ex: &quot;traduza minhas tags em inglês para português&quot;, &quot;mescle tags duplicadas&quot;,
              &quot;organize minhas notas por tema&quot;.
            </p>
          </div>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Escreva sua instrução…"
            rows={4}
          />
          <div className="flex items-center gap-3">
            <Select value={model} onValueChange={(v) => setModel(v as JwlibraryTagAiModel)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Modelo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o-mini">gpt-4o-mini (rápido/barato)</SelectItem>
                <SelectItem value="gpt-4o">gpt-4o (mais cuidadoso)</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="ml-auto"
              leftIcon={<Sparkles />}
              isLoading={generating}
              onClick={() => void handleGenerate()}
            >
              Gerar sugestões
            </Button>
          </div>
        </div>
      ) : (
        <>
          <TagPlanSections
            plan={plan}
            busyKeys={busyKeys}
            nameForRef={nameForRef}
            isRefReady={isRefReady}
            onApprove={(op) => void approve(op)}
            onReject={reject}
          />

          <div className="pointer-events-none sticky bottom-4 z-30 mt-2 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-2 rounded-3xl border border-border bg-surface-elevated px-4 py-2.5 shadow-[0_14px_34px_rgba(0,0,0,0.5)]">
              <span className="text-[13px] text-muted-foreground">
                {plan.operations.length} sugest{plan.operations.length === 1 ? "ão" : "ões"} pendente
                {plan.operations.length === 1 ? "" : "s"}
              </span>
              <div className="ml-2 flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setBulkConfirm("reject")}>
                  Recusar tudo
                </Button>
                <Button size="sm" isLoading={bulkBusy} onClick={() => setBulkConfirm("approve")}>
                  Aprovar tudo
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmVault
        open={bulkConfirm === "approve"}
        onOpenChange={(open) => !open && setBulkConfirm(null)}
        title="Aplicar todas as sugestões?"
        description="Toda tag renomeada, mesclada, criada ou atribuída pendente será gravada agora."
        confirmLabel="Aplicar tudo"
        destructive={false}
        onConfirm={() => void approveAllVisible()}
      />
      <ConfirmVault
        open={bulkConfirm === "reject"}
        onOpenChange={(open) => !open && setBulkConfirm(null)}
        title="Descartar todas as sugestões?"
        description="Nada foi salvo ainda — isso só limpa o que a IA sugeriu. Você pode gerar de novo depois."
        confirmLabel="Descartar"
        onConfirm={rejectAllVisible}
      />
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground/80">{children}</h3>;
}

function OperationRow({
  busy,
  onApprove,
  onReject,
  disabledReason,
  children,
}: {
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  disabledReason?: string;
  children: React.ReactNode;
}) {
  return (
    // Content and actions are always stacked (never side-by-side) — a note
    // title plus several tag badges can run long, and sharing one row with
    // the buttons let long content visually run underneath them.
    <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-2xl border border-border bg-surface px-4 py-3">
      {busy && <ProcessingShimmer />}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-2.5">
        {disabledReason && <span className="mr-auto text-[11.5px] text-muted-foreground">{disabledReason}</span>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onReject}>
          Recusar
        </Button>
        <Button size="sm" isLoading={busy} disabled={!!disabledReason} onClick={onApprove}>
          Aprovar
        </Button>
      </div>
    </div>
  );
}

/** Fade+scale mount/exit, with `layout` so remaining rows smoothly slide up into the gap left by one that just saved and disappeared. */
function AnimatedRow({ rowKey, children }: { rowKey: string; children: React.ReactNode }) {
  return (
    <motion.div
      key={rowKey}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function TagPlanSections({
  plan,
  busyKeys,
  nameForRef,
  isRefReady,
  onApprove,
  onReject,
}: {
  plan: TagPlan;
  busyKeys: Set<string>;
  nameForRef: (ref: string) => string;
  isRefReady: (ref: string) => boolean;
  onApprove: (op: TagPlanOperation) => void;
  onReject: (op: TagPlanOperation) => void;
}) {
  const creates = plan.operations.filter((o): o is CreateOp => o.op === "create");
  const renames = plan.operations.filter((o): o is RenameOp => o.op === "rename");
  const merges = plan.operations.filter((o): o is MergeOp => o.op === "merge");
  const assigns = plan.operations.filter((o): o is AssignOp => o.op === "assign");

  return (
    <div className="flex flex-col gap-6">
      {creates.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeading>Novas tags</SectionHeading>
          <AnimatePresence mode="popLayout">
            {creates.map((op) => (
              <AnimatedRow key={keyOf(op)} rowKey={keyOf(op)}>
                <OperationRow
                  busy={busyKeys.has(keyOf(op))}
                  onApprove={() => onApprove(op)}
                  onReject={() => onReject(op)}
                >
                  <Badge variant="success">+ {op.name}</Badge>
                </OperationRow>
              </AnimatedRow>
            ))}
          </AnimatePresence>
        </div>
      )}

      {renames.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeading>Renomear</SectionHeading>
          <AnimatePresence mode="popLayout">
            {renames.map((op) => (
              <AnimatedRow key={keyOf(op)} rowKey={keyOf(op)}>
                <OperationRow
                  busy={busyKeys.has(keyOf(op))}
                  onApprove={() => onApprove(op)}
                  onReject={() => onReject(op)}
                >
                  <Badge variant="secondary">{op.oldName}</Badge>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <Badge variant="success">{op.newName}</Badge>
                </OperationRow>
              </AnimatedRow>
            ))}
          </AnimatePresence>
        </div>
      )}

      {merges.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeading>Mesclar</SectionHeading>
          <AnimatePresence mode="popLayout">
            {merges.map((op) => (
              <AnimatedRow key={keyOf(op)} rowKey={keyOf(op)}>
                <OperationRow
                  busy={busyKeys.has(keyOf(op))}
                  onApprove={() => onApprove(op)}
                  onReject={() => onReject(op)}
                >
                  <Badge variant="destructive">{op.sourceName}</Badge>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <Badge variant="success">{op.targetName}</Badge>
                  <span className="text-[12px] text-muted-foreground">
                    notas com a primeira passam a usar a segunda
                  </span>
                </OperationRow>
              </AnimatedRow>
            ))}
          </AnimatePresence>
        </div>
      )}

      {assigns.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeading>Tags por nota</SectionHeading>
          <AnimatePresence mode="popLayout">
            {assigns.map((op) => {
              const blockedRef = op.addRefs.find((ref) => !isRefReady(ref));
              const disabledReason = blockedRef
                ? `Aprove a criação de "${nameForRef(blockedRef)}" primeiro`
                : undefined;
              return (
                <AnimatedRow key={keyOf(op)} rowKey={keyOf(op)}>
                  <OperationRow
                    busy={busyKeys.has(keyOf(op))}
                    onApprove={() => onApprove(op)}
                    onReject={() => onReject(op)}
                    disabledReason={disabledReason}
                  >
                    <span
                      className="min-w-0 max-w-full break-words text-[13.5px] font-medium text-foreground"
                      title={op.noteTitle.trim() || undefined}
                    >
                      {displayNoteTitle(op.noteTitle)}
                    </span>
                    {op.addRefs.map((ref) => (
                      <Badge key={`add:${ref}`} variant="success">
                        + {nameForRef(ref)}
                      </Badge>
                    ))}
                    {op.removeTagIds.map((id) => (
                      <Badge key={`remove:${id}`} variant="destructive">
                        − {nameForRef(id)}
                      </Badge>
                    ))}
                  </OperationRow>
                </AnimatedRow>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
