interface FolderNode {
  id: string;
  parentId?: string | null;
}

/** Every folder nested anywhere below `id` (not including `id` itself). */
export function descendantIds(folders: readonly FolderNode[], id: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    const siblings = childrenByParent.get(f.parentId);
    if (siblings) siblings.push(f.id);
    else childrenByParent.set(f.parentId, [f.id]);
  }

  const result = new Set<string>();
  const stack = [...(childrenByParent.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (result.has(next)) continue;
    result.add(next);
    stack.push(...(childrenByParent.get(next) ?? []));
  }
  return result;
}

/** Moving `id` under `newParentId` would put a folder inside itself (directly or through its own descendants). */
export function wouldCreateFolderCycle(
  folders: readonly FolderNode[],
  id: string,
  newParentId: string | null | undefined
): boolean {
  if (!newParentId) return false;
  return newParentId === id || descendantIds(folders, id).has(newParentId);
}
