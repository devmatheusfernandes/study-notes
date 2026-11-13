import type { JwpubTocItem } from "./types";

/**
 * Turns the flat `PublicationViewItem` rows into what the contents screen
 * draws: tabs (the top-level items) each holding a flat, ordered list of
 * headings and entries.
 *
 * Shapes seen in real archives, which this has to cope with:
 *   - "Organizados": three top-level items — CONTEÚDO / APÊNDICE / ÍNDICE —
 *     so three tabs, with the chapters directly under CONTEÚDO.
 *   - "Pastoreiem": Conteúdo has a group heading ("Capítulos", no document)
 *     with the numbered chapters nested beneath it.
 *   - Apostila / Sentinela: ONE top-level item, so no tabs at all — just the
 *     list (the single top-level title is the publication's own).
 */

export type TocEntry =
  | { kind: "group"; key: string; title: string }
  | {
      kind: "item";
      key: string;
      title: string;
      /** "CAPÍTULO 1" style label for a numbered item, else null. */
      label: string | null;
      /** Printed page the item starts on, when the archive says so. */
      page: string | null;
      documentId: number;
    };

export interface TocTab {
  key: string;
  title: string;
  entries: TocEntry[];
}

/** The word JW Library puts over a numbered item, by the heading it sits under. The archive stores only the number. */
const NUMBER_LABELS: [RegExp, string][] = [
  [/^cap[ií]tulos?$/i, "CAPÍTULO"],
  [/^li[çc][õo]es$|^li[çc][ãa]o$/i, "LIÇÃO"],
  [/^estudos?$/i, "ESTUDO"],
  [/^partes?$/i, "PARTE"],
  [/^se[çc][õo]es$|^se[çc][ãa]o$/i, "SEÇÃO"],
  [/^artigos?$/i, "ARTIGO"],
];

function numberLabel(number: string, headingTitle: string): string {
  const word = NUMBER_LABELS.find(([pattern]) => pattern.test(headingTitle.trim()))?.[1] ?? "CAPÍTULO";
  return `${word} ${number}`;
}

/** The archive pads titles with non-breaking spaces. */
function clean(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

export function buildTocTabs(items: JwpubTocItem[]): TocTab[] {
  if (items.length === 0) return [];

  const children = new Map<number | null, JwpubTocItem[]>();
  for (const item of items) {
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position);

  /** Depth-first, flattening: a heading (no document) becomes a group line, its children follow it. */
  function collect(parent: JwpubTocItem, into: TocEntry[], headingTitle: string) {
    for (const child of children.get(parent.itemId) ?? []) {
      const title = clean(child.title);
      if (child.documentId === null) {
        into.push({ kind: "group", key: `g${child.itemId}`, title });
        collect(child, into, title);
        continue;
      }
      into.push({
        kind: "item",
        key: `i${child.itemId}`,
        title,
        label: child.number ? numberLabel(child.number, headingTitle) : null,
        page: child.location,
        documentId: child.documentId,
      });
      collect(child, into, headingTitle);
    }
  }

  const tops = children.get(null) ?? [];
  return tops.map((top) => {
    const entries: TocEntry[] = [];
    // A top-level item that opens a document itself is listed as an entry too.
    if (top.documentId !== null) {
      entries.push({
        kind: "item",
        key: `i${top.itemId}`,
        title: clean(top.title),
        label: null,
        page: top.location,
        documentId: top.documentId,
      });
    }
    collect(top, entries, clean(top.title));
    return { key: `t${top.itemId}`, title: clean(top.title), entries };
  });
}
