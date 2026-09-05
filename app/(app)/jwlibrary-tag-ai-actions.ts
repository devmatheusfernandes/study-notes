"use server";

import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { decryptText } from "@/lib/encryption";
import type { TagPlan, TagPlanOperation } from "@/lib/jwlibrary/tag-plan-types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export type JwlibraryTagAiModel = "gpt-4o-mini" | "gpt-4o";

// $/1M tokens. gpt-4o-mini matches the constant already hardcoded in
// assistant-actions.ts; gpt-4o pricing recorded here the same self-documenting
// way — re-check both against https://openai.com/api/pricing/ if they drift.
const MODEL_PRICING: Record<JwlibraryTagAiModel, { prompt: number; completion: number }> = {
  "gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "gpt-4o": { prompt: 2.5, completion: 10 },
};

// Notes are split into batches by character budget rather than sent in one
// giant request — a single request either got truncated by the completion
// token cap or (more often, per real-world testing) the model just quietly
// sampled a subset of notes instead of covering all of them. Chunking keeps
// each request small enough that "cover every note in this batch" is
// actually achievable, and results are merged back into one plan below.
const CHARS_PER_BATCH = 60_000;
const MAX_COMPLETION_TOKENS = 16_000;

const OPERATION_SCHEMA = {
  type: "object" as const,
  properties: {
    operations: {
      type: "array" as const,
      items: {
        anyOf: [
          {
            type: "object" as const,
            properties: {
              op: { type: "string" as const, enum: ["create"] },
              tempId: { type: "string" as const, description: "A short local id you invent, e.g. 'new-1'." },
              name: { type: "string" as const },
            },
            required: ["op", "tempId", "name"],
            additionalProperties: false,
          },
          {
            type: "object" as const,
            properties: {
              op: { type: "string" as const, enum: ["rename"] },
              tagId: { type: "string" as const, description: "The tag's short code from the tag list, e.g. 't3'." },
              oldName: { type: "string" as const },
              newName: { type: "string" as const },
            },
            required: ["op", "tagId", "oldName", "newName"],
            additionalProperties: false,
          },
          {
            type: "object" as const,
            properties: {
              op: { type: "string" as const, enum: ["merge"] },
              sourceTagId: { type: "string" as const, description: "Short tag code, e.g. 't3'." },
              sourceName: { type: "string" as const },
              targetTagId: { type: "string" as const, description: "Short tag code, e.g. 't5'." },
              targetName: { type: "string" as const },
            },
            required: ["op", "sourceTagId", "sourceName", "targetTagId", "targetName"],
            additionalProperties: false,
          },
          {
            type: "object" as const,
            properties: {
              op: { type: "string" as const, enum: ["assign"] },
              noteId: { type: "string" as const, description: "The note's short code from the note list, e.g. 'n12'." },
              noteTitle: { type: "string" as const },
              addRefs: {
                type: "array" as const,
                items: { type: "string" as const },
                description:
                  "Short tag codes (e.g. 't3') to add, or a tempId from one of this batch's own 'create' operations.",
              },
              removeTagIds: {
                type: "array" as const,
                items: { type: "string" as const },
                description: "Short tag codes (e.g. 't3') to remove.",
              },
            },
            required: ["op", "noteId", "noteTitle", "addRefs", "removeTagIds"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["operations"],
  additionalProperties: false,
};

/** Defensive re-validation of the model's own JSON — a malformed entry is dropped, not trusted. */
function isValidOperation(value: unknown): value is TagPlanOperation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  switch (v.op) {
    case "create":
      return typeof v.tempId === "string" && typeof v.name === "string" && v.name.trim() !== "";
    case "rename":
      return typeof v.tagId === "string" && typeof v.oldName === "string" && typeof v.newName === "string";
    case "merge":
      return (
        typeof v.sourceTagId === "string" &&
        typeof v.sourceName === "string" &&
        typeof v.targetTagId === "string" &&
        typeof v.targetName === "string" &&
        v.sourceTagId !== v.targetTagId
      );
    case "assign":
      return (
        typeof v.noteId === "string" &&
        typeof v.noteTitle === "string" &&
        Array.isArray(v.addRefs) &&
        v.addRefs.every((r) => typeof r === "string") &&
        Array.isArray(v.removeTagIds) &&
        v.removeTagIds.every((r) => typeof r === "string")
      );
    default:
      return false;
  }
}

interface NoteRecord {
  id: string;
  title: string;
  content: string;
  tagIds: string[];
}

interface TagRecord {
  id: string;
  name: string;
}

/**
 * A tag id showing up in both `addRefs` and `removeTagIds` for the same
 * assign — self-contradictory ("add X" and "remove X" on the same note) —
 * is dropped from both. Seen in practice when a single batch response (or
 * two batches merged later) proposed opposing operations for the same tag,
 * which rendered as identical-looking "+ Name" / "− Name" badges side by
 * side with no way to tell they were ever meant to net out.
 */
function dropContradictingRefs(addRefs: string[], removeTagIds: string[]) {
  const removeSet = new Set(removeTagIds);
  const addSet = new Set(addRefs);
  return {
    addRefs: addRefs.filter((r) => !removeSet.has(r)),
    removeTagIds: removeTagIds.filter((r) => !addSet.has(r)),
  };
}

/** Splits notes into batches under a character budget — one oversized note still gets its own batch rather than looping forever. */
function batchNotes(notes: NoteRecord[]): NoteRecord[][] {
  const batches: NoteRecord[][] = [];
  let current: NoteRecord[] = [];
  let currentChars = 0;
  for (const note of notes) {
    const size = note.title.length + note.content.length;
    if (current.length > 0 && currentChars + size > CHARS_PER_BATCH) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(note);
    currentChars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Runs one batch's request against a short-lived local coding scheme
 * (`t1`, `t2`, … for tags already in the account; `n1`, `n2`, … for notes in
 * this batch) instead of asking the model to echo real UUIDs back verbatim.
 * LLMs are unreliable at faithfully reproducing long random-looking ids over
 * a big list — verified empirically (near-miss ids that matched nothing,
 * shown as raw garbage badges in the review UI) — short sequential codes are
 * far more reliably copied. Codes are remapped back to real ids before
 * returning, so every caller downstream still works in real-id space.
 */
async function runBatch(
  openai: OpenAI,
  model: JwlibraryTagAiModel,
  userPrompt: string,
  tags: TagRecord[],
  batchNotesList: NoteRecord[],
  tagCodeById: Map<string, string>,
  tagIdByCode: Map<string, string>
): Promise<{ operations: TagPlanOperation[]; promptTokens: number; completionTokens: number; totalTokens: number }> {
  const noteIdByCode = new Map<string, string>();
  const notePayload = batchNotesList.map((n, i) => {
    const code = `n${i + 1}`;
    noteIdByCode.set(code, n.id);
    return {
      id: code,
      title: n.title,
      content: n.content,
      currentTags: n.tagIds.map((id) => tagCodeById.get(id)).filter((c): c is string => !!c),
    };
  });
  const tagPayload = tags.map((t) => ({ id: tagCodeById.get(t.id), name: t.name }));

  const systemPrompt = [
    "Você organiza as tags de um usuário do JW Library dentro do Study Notes.",
    "Ele vai te dar uma instrução em português sobre como reorganizar suas tags (traduzir, mesclar duplicadas, criar novas, reatribuir por tema, etc).",
    "Responda APENAS com operações no formato dado. Regras:",
    "- Toda referência a uma tag existente ou nota usa o código curto dado (ex: 't3', 'n12') — nunca invente um código que não esteja nas listas abaixo.",
    "- Prefira reutilizar uma tag já existente (lista abaixo) em vez de criar uma nova.",
    "- Só use 'create' quando nenhuma tag existente realmente encaixar.",
    "- Em 'assign', 'addRefs' pode conter o código de uma tag existente OU o 'tempId' de uma operação 'create' desta mesma resposta.",
    "- Não gere uma operação 'assign' redundante para uma tag que a nota já tem (veja 'currentTags' de cada nota), a menos que a instrução peça para revisar/remover tags existentes.",
    "- IMPORTANTE: avalie TODAS as notas listadas abaixo, uma a uma — se a instrução do usuário se aplica a uma nota, gere a operação para ela. Não pare no meio da lista nem processe só uma amostra.",
    "",
    `Tags existentes: ${JSON.stringify(tagPayload)}`,
    "",
    `Notas deste lote: ${JSON.stringify(notePayload)}`,
  ].join("\n");

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "tag_plan", schema: OPERATION_SCHEMA, strict: true },
    },
  });

  const raw = response.choices[0]?.message?.content;
  const usage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  };
  if (!raw) return { operations: [], ...usage };

  let parsedOperations: unknown[] = [];
  try {
    const parsed = JSON.parse(raw) as { operations?: unknown[] };
    parsedOperations = Array.isArray(parsed.operations) ? parsed.operations : [];
  } catch {
    return { operations: [], ...usage };
  }

  const valid = parsedOperations.filter(isValidOperation);
  // A ref the model wrote for 'assign' is either a real tag's code or the
  // tempId of one of this same batch's own 'create' ops — anything else is
  // a hallucinated code and must be dropped, never passed through as-is.
  // (Passing an unresolved code through as if it were a real id was the
  // original bug here — it silently became "the tag id" downstream and
  // broke the actual DB call once approved, e.g. renameJwlibraryTag("t34", ...).)
  const createTempIds = new Set(
    valid
      .filter((o): o is Extract<TagPlanOperation, { op: "create" }> => o.op === "create")
      .map((o) => o.tempId)
  );
  const resolveTagRef = (ref: string): string | null =>
    tagIdByCode.get(ref) ?? (createTempIds.has(ref) ? ref : null);

  const operations = valid
    .map((op): TagPlanOperation | null => {
      switch (op.op) {
        case "create":
          return op;
        case "rename": {
          const tagId = tagIdByCode.get(op.tagId);
          return tagId ? { ...op, tagId } : null;
        }
        case "merge": {
          const sourceTagId = tagIdByCode.get(op.sourceTagId);
          const targetTagId = tagIdByCode.get(op.targetTagId);
          return sourceTagId && targetTagId ? { ...op, sourceTagId, targetTagId } : null;
        }
        case "assign": {
          const noteId = noteIdByCode.get(op.noteId);
          if (!noteId) return null;
          const addRefs = op.addRefs.map(resolveTagRef).filter((r): r is string => r !== null);
          const removeTagIds = op.removeTagIds.map(resolveTagRef).filter((r): r is string => r !== null);
          const { addRefs: cleanAdd, removeTagIds: cleanRemove } = dropContradictingRefs(addRefs, removeTagIds);
          return { ...op, noteId, addRefs: cleanAdd, removeTagIds: cleanRemove };
        }
      }
    })
    .filter((op): op is TagPlanOperation => op !== null);

  return { operations, ...usage };
}

/** Merges batches' operations into one plan, de-duplicating what shouldn't repeat across independent batch calls. */
function mergeOperations(batches: TagPlanOperation[][]): TagPlanOperation[] {
  const all = batches.flat();
  const creates = all.filter((o): o is Extract<TagPlanOperation, { op: "create" }> => o.op === "create");
  const renames = all.filter((o): o is Extract<TagPlanOperation, { op: "rename" }> => o.op === "rename");
  const merges = all.filter((o): o is Extract<TagPlanOperation, { op: "merge" }> => o.op === "merge");
  const assigns = all.filter((o): o is Extract<TagPlanOperation, { op: "assign" }> => o.op === "assign");

  // Two batches proposing the same new tag name get folded into one create —
  // every assign across every batch that pointed at the dropped duplicate's
  // tempId is rewritten to the surviving one's tempId.
  const tempIdRewrite = new Map<string, string>();
  const seenCreateNames = new Map<string, string>(); // lowercased name -> surviving tempId
  const dedupedCreates = creates.filter((op) => {
    const key = op.name.trim().toLowerCase();
    const survivor = seenCreateNames.get(key);
    if (survivor) {
      tempIdRewrite.set(op.tempId, survivor);
      return false;
    }
    seenCreateNames.set(key, op.tempId);
    return true;
  });

  const seenRenameTag = new Set<string>();
  const dedupedRenames = renames.filter((op) => {
    if (seenRenameTag.has(op.tagId)) return false;
    seenRenameTag.add(op.tagId);
    return true;
  });

  const seenMergePair = new Set<string>();
  const dedupedMerges = merges.filter((op) => {
    const key = `${op.sourceTagId}=>${op.targetTagId}`;
    if (seenMergePair.has(key)) return false;
    seenMergePair.add(key);
    return true;
  });

  const assignByNote = new Map<string, Extract<TagPlanOperation, { op: "assign" }>>();
  for (const op of assigns) {
    const addRefs = op.addRefs.map((ref) => tempIdRewrite.get(ref) ?? ref);
    const existing = assignByNote.get(op.noteId);
    if (!existing) {
      assignByNote.set(op.noteId, { ...op, addRefs });
      continue;
    }
    assignByNote.set(op.noteId, {
      ...existing,
      addRefs: [...new Set([...existing.addRefs, ...addRefs])],
      removeTagIds: [...new Set([...existing.removeTagIds, ...op.removeTagIds])],
    });
  }

  const cleanedAssigns = [...assignByNote.values()].map((op) => ({
    ...op,
    ...dropContradictingRefs(op.addRefs, op.removeTagIds),
  }));

  return [...dedupedCreates, ...dedupedRenames, ...dedupedMerges, ...cleanedAssigns];
}

export async function generateJwlibraryTagPlan(
  userPrompt: string,
  model: JwlibraryTagAiModel
): Promise<{ plan?: TagPlan; error?: string }> {
  const trimmedPrompt = userPrompt.trim();
  if (!trimmedPrompt) return { error: "Escreva o que você quer que a IA faça." };
  if (!(model in MODEL_PRICING)) return { error: "Modelo inválido." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "A chave OPENAI_API_KEY não está configurada no ambiente." };

  const [{ data: noteRows, error: notesError }, { data: tagRows, error: tagsError }, { data: mapRows }] =
    await Promise.all([
      supabase.from("jwlibrary_notes").select("id, title, content"),
      supabase.from("jwlibrary_tags").select("id, name").eq("tag_type", 1),
      supabase.from("jwlibrary_tag_map").select("note_id, tag_id").not("note_id", "is", null),
    ]);
  if (notesError || tagsError) return { error: "Não foi possível carregar suas notas e tags." };
  if ((noteRows ?? []).length === 0) return { error: "Nenhuma nota importada do JW Library ainda." };

  const tagIdsByNote = new Map<string, string[]>();
  for (const row of mapRows ?? []) {
    if (!row.note_id) continue;
    const list = tagIdsByNote.get(row.note_id) ?? [];
    list.push(row.tag_id);
    tagIdsByNote.set(row.note_id, list);
  }

  const notes: NoteRecord[] = (noteRows ?? []).map((n) => ({
    id: n.id as string,
    title: decryptText(n.title) || "",
    content: decryptText(n.content) || "",
    tagIds: tagIdsByNote.get(n.id as string) ?? [],
  }));
  const tags: TagRecord[] = (tagRows ?? []).map((t) => ({ id: t.id as string, name: (t.name as string) || "" }));

  const tagCodeById = new Map<string, string>();
  const tagIdByCode = new Map<string, string>();
  tags.forEach((t, i) => {
    const code = `t${i + 1}`;
    tagCodeById.set(t.id, code);
    tagIdByCode.set(code, t.id);
  });

  const batches = batchNotes(notes);

  try {
    const openai = new OpenAI({ apiKey });
    const results = await Promise.all(
      batches.map((batch) => runBatch(openai, model, trimmedPrompt, tags, batch, tagCodeById, tagIdByCode))
    );

    const pricing = MODEL_PRICING[model];
    const logRows = results.map((r) => ({
      user_id: user.id,
      operation_type: "jwlibrary_tag_plan",
      model,
      prompt_tokens: r.promptTokens,
      completion_tokens: r.completionTokens,
      total_tokens: r.totalTokens,
      estimated_cost_usd: (r.promptTokens / 1_000_000) * pricing.prompt + (r.completionTokens / 1_000_000) * pricing.completion,
    }));
    if (logRows.length > 0) await supabase.from("ai_usage_logs").insert(logRows);

    const operations = mergeOperations(results.map((r) => r.operations));

    const plan: TagPlan = {
      generatedAt: new Date().toISOString(),
      prompt: trimmedPrompt,
      model,
      tempIdMap: {},
      operations,
    };
    return { plan };
  } catch (err) {
    console.error("Erro ao gerar plano de tags com IA:", err);
    return { error: "Não foi possível gerar sugestões agora." };
  }
}
