/** AI-generated tag reorganization plan for JW Library notes — see app/(app)/jwlibrary-tag-ai-actions.ts. */

export type TagPlanOperation =
  | { op: "create"; tempId: string; name: string }
  | { op: "rename"; tagId: string; oldName: string; newName: string }
  | { op: "merge"; sourceTagId: string; sourceName: string; targetTagId: string; targetName: string }
  | { op: "assign"; noteId: string; noteTitle: string; addRefs: string[]; removeTagIds: string[] };

export interface TagPlan {
  generatedAt: string;
  prompt: string;
  model: string;
  /** tempId (from a still-pending or already-approved "create" op) -> real tag id. */
  tempIdMap: Record<string, string>;
  operations: TagPlanOperation[];
}
