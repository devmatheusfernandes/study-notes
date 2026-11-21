/**
 * Renders a note (Tiptap HTML) to a real PDF file — selectable vector text,
 * headings, lists, task lists, quotes, code, highlights, alignment and inline
 * images — with no server round trip. jsPDF is loaded lazily on first use so
 * it never lands in the editor's initial bundle.
 *
 * It walks the DOM itself rather than rasterising the page (html2canvas):
 * that would cut lines in half at page breaks and make the text unselectable.
 * Only what the editor can produce is handled; anything unknown is rendered as
 * its text content.
 */
import type { jsPDF } from "jspdf";

const PAGE_MARGIN = 48;
const BASE_SIZE = 11;
const LINE_FACTOR = 1.45;
const INDENT_STEP = 18;
const MAX_IMAGE_PX = 1600;

type Align = "left" | "center" | "right" | "justify";

interface Style {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  underline?: boolean;
  highlight?: string;
  link?: boolean;
}

interface Atom {
  text: string;
  style: Style;
  size: number;
  width: number;
  space: boolean;
  /** Forced line break (`<br>`). */
  br?: boolean;
}

interface Ctx {
  /** Left edge of the block, in pt (grows with lists/quotes). */
  x: number;
  /** Bullet/number/checkbox drawn on the first line emitted, then cleared. */
  marker?: { kind: "text"; text: string } | { kind: "task"; checked: boolean };
  /** Vertical bars drawn beside the block (one per quote level). */
  quoteBars: number[];
  size: number;
  style: Style;
  align: Align;
}

// jsPDF's built-in fonts are WinAnsi: Latin-1 plus a handful of punctuation.
// Anything else (emoji, CJK, …) would print as garbage, so it's mapped or dropped.
const EXTRA_WINANSI = new Set("‘’‚“”„–—•…€™†‡‰‹›ŒœŠšŸŽž");
function sanitize(text: string): string {
  let out = "";
  for (const ch of text.replace(/ /g, " ").replace(/[​-‍﻿]/g, "")) {
    const code = ch.codePointAt(0)!;
    out += code <= 0xff || EXTRA_WINANSI.has(ch) ? ch : "";
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (h.length < 6) return null;
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function loadImage(src: string): Promise<{ data: string; width: number; height: number } | null> {
  try {
    const response = await fetch(src, { credentials: "same-origin" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image"));
        el.src = url;
      });
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // White underlay: JPEG has no alpha, and a transparent PNG would go black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return { data: canvas.toDataURL("image/jpeg", 0.85), width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

const INLINE_TAGS = new Set([
  "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "span", "a", "mark", "sub", "sup", "small", "br",
]);

class Renderer {
  private y = PAGE_MARGIN;
  private readonly pageW: number;
  private readonly pageH: number;
  private readonly contentRight: number;
  /** Images are fetched up front, in parallel, so layout itself stays synchronous. */
  private images = new Map<string, Awaited<ReturnType<typeof loadImage>>>();

  constructor(private readonly pdf: jsPDF) {
    this.pageW = pdf.internal.pageSize.getWidth();
    this.pageH = pdf.internal.pageSize.getHeight();
    this.contentRight = this.pageW - PAGE_MARGIN;
  }

  async preload(root: HTMLElement) {
    const srcs = [...new Set([...root.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "").filter(Boolean))];
    const loaded = await Promise.all(srcs.map((src) => loadImage(src)));
    srcs.forEach((src, i) => this.images.set(src, loaded[i]));
  }

  private ensureSpace(height: number) {
    if (this.y + height > this.pageH - PAGE_MARGIN) {
      this.pdf.addPage();
      this.y = PAGE_MARGIN;
    }
  }

  private fontFor(style: Style, size: number) {
    this.pdf.setFont(style.code ? "courier" : "helvetica", style.bold ? (style.italic ? "bolditalic" : "bold") : style.italic ? "italic" : "normal");
    this.pdf.setFontSize(style.code ? size * 0.92 : size);
  }

  // ---- inline layout ------------------------------------------------------

  private collectInline(nodes: Node[], ctx: Ctx, atoms: Atom[]) {
    const walk = (node: Node, style: Style) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = sanitize((node.textContent ?? "").replace(/\s+/g, " "));
        for (const part of text.split(/( )/)) {
          if (!part) continue;
          this.fontFor(style, ctx.size);
          atoms.push({ text: part, style, size: ctx.size, width: this.pdf.getTextWidth(part), space: part === " " });
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        atoms.push({ text: "", style, size: ctx.size, width: 0, space: false, br: true });
        return;
      }
      const next: Style = { ...style };
      if (tag === "strong" || tag === "b") next.bold = true;
      if (tag === "em" || tag === "i") next.italic = true;
      if (tag === "u") next.underline = true;
      if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
      if (tag === "code") next.code = true;
      if (tag === "a") next.link = true;
      if (tag === "mark") next.highlight = el.getAttribute("data-color") ?? "#e8c547";
      el.childNodes.forEach((child) => walk(child, next));
    };
    nodes.forEach((n) => walk(n, ctx.style));
  }

  private drawParagraph(nodes: Node[], ctx: Ctx, opts: { before?: number; after?: number } = {}) {
    const atoms: Atom[] = [];
    this.collectInline(nodes, ctx, atoms);
    // An empty paragraph is still a blank line in the editor.
    const hasContent = atoms.some((a) => !a.space || a.br);
    const lineH = ctx.size * LINE_FACTOR;
    this.y += opts.before ?? 0;

    if (!hasContent) {
      this.ensureSpace(lineH);
      this.drawMarker(ctx, lineH);
      this.drawQuoteBars(ctx, lineH);
      this.y += lineH;
      this.y += opts.after ?? 0;
      return;
    }

    const maxW = this.contentRight - ctx.x;
    const lines: Atom[][] = [];
    let line: Atom[] = [];
    let used = 0;
    const flush = () => {
      while (line.length && line[line.length - 1].space) line.pop();
      lines.push(line);
      line = [];
      used = 0;
    };
    for (const atom of atoms) {
      if (atom.br) {
        flush();
        continue;
      }
      if (atom.space && line.length === 0) continue;
      if (!atom.space && used + atom.width > maxW && line.length > 0) flush();
      // A single unbreakable word wider than the page: split it by character.
      if (!atom.space && atom.width > maxW) {
        this.fontFor(atom.style, atom.size);
        let chunk = "";
        for (const ch of atom.text) {
          if (this.pdf.getTextWidth(chunk + ch) > maxW && chunk) {
            line.push({ ...atom, text: chunk, width: this.pdf.getTextWidth(chunk) });
            flush();
            chunk = "";
          }
          chunk += ch;
        }
        const w = this.pdf.getTextWidth(chunk);
        line.push({ ...atom, text: chunk, width: w });
        used += w;
        continue;
      }
      line.push(atom);
      used += atom.width;
    }
    if (line.length || lines.length === 0) flush();

    lines.forEach((atomsInLine, index) => {
      this.ensureSpace(lineH);
      if (index === 0) this.drawMarker(ctx, lineH);
      this.drawQuoteBars(ctx, lineH);
      const isLast = index === lines.length - 1;
      this.drawLine(atomsInLine, ctx, lineH, maxW, isLast);
      this.y += lineH;
    });
    this.y += opts.after ?? 0;
  }

  private drawLine(atoms: Atom[], ctx: Ctx, lineH: number, maxW: number, isLast: boolean) {
    const natural = atoms.reduce((sum, a) => sum + a.width, 0);
    let x = ctx.x;
    let extraPerSpace = 0;
    const spaces = atoms.filter((a) => a.space).length;
    if (ctx.align === "center") x += (maxW - natural) / 2;
    else if (ctx.align === "right") x += maxW - natural;
    else if (ctx.align === "justify" && !isLast && spaces > 0) extraPerSpace = (maxW - natural) / spaces;

    const baseline = this.y + lineH * 0.72;
    for (const atom of atoms) {
      const width = atom.width + (atom.space ? extraPerSpace : 0);
      if (atom.style.highlight) {
        const rgb = hexToRgb(atom.style.highlight);
        if (rgb) {
          this.pdf.setFillColor(...rgb);
          this.pdf.rect(x, this.y + lineH * 0.1, width, lineH * 0.85, "F");
        }
      }
      if (!atom.space && atom.text) {
        this.fontFor(atom.style, atom.size);
        // Highlight pastels always carry dark text (same rule as the editor).
        if (atom.style.highlight) this.pdf.setTextColor(28, 25, 23);
        else if (atom.style.link) this.pdf.setTextColor(30, 90, 190);
        else this.pdf.setTextColor(30, 30, 30);
        this.pdf.text(atom.text, x, baseline);
      }
      if (atom.style.strike || atom.style.underline || atom.style.link) {
        this.pdf.setDrawColor(atom.style.link ? 30 : 30, atom.style.link ? 90 : 30, atom.style.link ? 190 : 30);
        this.pdf.setLineWidth(0.6);
        const ly = atom.style.strike ? baseline - atom.size * 0.28 : baseline + 1.4;
        this.pdf.line(x, ly, x + width, ly);
      }
      x += width;
    }
    this.pdf.setTextColor(30, 30, 30);
  }

  private drawMarker(ctx: Ctx, lineH: number) {
    const marker = ctx.marker;
    if (!marker) return;
    ctx.marker = undefined;
    const baseline = this.y + lineH * 0.72;
    if (marker.kind === "text") {
      this.fontFor({}, ctx.size);
      this.pdf.setTextColor(30, 30, 30);
      this.pdf.text(marker.text, ctx.x - 6, baseline, { align: "right" });
      return;
    }
    const box = ctx.size * 0.8;
    const bx = ctx.x - box - 6;
    const by = this.y + (lineH - box) / 2;
    this.pdf.setDrawColor(90, 90, 90);
    this.pdf.setLineWidth(0.8);
    if (marker.checked) {
      this.pdf.setFillColor(217, 119, 6);
      this.pdf.roundedRect(bx, by, box, box, 1.5, 1.5, "FD");
      this.pdf.setDrawColor(255, 255, 255);
      this.pdf.setLineWidth(1.1);
      this.pdf.line(bx + box * 0.22, by + box * 0.55, bx + box * 0.42, by + box * 0.75);
      this.pdf.line(bx + box * 0.42, by + box * 0.75, bx + box * 0.8, by + box * 0.28);
    } else {
      this.pdf.roundedRect(bx, by, box, box, 1.5, 1.5, "S");
    }
  }

  private drawQuoteBars(ctx: Ctx, lineH: number) {
    if (!ctx.quoteBars.length) return;
    this.pdf.setDrawColor(210, 160, 90);
    this.pdf.setLineWidth(2);
    for (const bx of ctx.quoteBars) this.pdf.line(bx, this.y, bx, this.y + lineH);
  }

  // ---- block layout -------------------------------------------------------

  renderChildren(parent: Node, ctx: Ctx) {
    let pending: Node[] = [];
    const flushInline = () => {
      if (!pending.length) return;
      const onlyBlankText = pending.every((n) => n.nodeType === Node.TEXT_NODE && !(n.textContent ?? "").trim());
      if (!onlyBlankText) this.drawParagraph(pending, ctx, { after: 4 });
      pending = [];
    };
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as HTMLElement).tagName.toLowerCase();
        if (INLINE_TAGS.has(tag)) {
          pending.push(node);
          return;
        }
        flushInline();
        this.renderBlock(node as HTMLElement, ctx);
      } else if (node.nodeType === Node.TEXT_NODE) {
        pending.push(node);
      }
    });
    flushInline();
  }

  private renderBlock(el: HTMLElement, ctx: Ctx) {
    const tag = el.tagName.toLowerCase();
    const align = (el.style.textAlign as Align) || ctx.align;
    const marginLeftEm = parseFloat(el.style.marginLeft || "0");
    const indent = Number.isFinite(marginLeftEm) ? marginLeftEm * ctx.size : 0;
    const local: Ctx = { ...ctx, align, x: ctx.x + indent };

    switch (tag) {
      case "p":
        this.drawParagraph([...el.childNodes], local, { after: 4 });
        return;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const size = ({ h1: 20, h2: 16, h3: 13.5 } as Record<string, number>)[tag] ?? 12;
        // Keep a heading with at least its first line.
        this.ensureSpace(size * LINE_FACTOR * 2 + 10);
        this.drawParagraph([...el.childNodes], { ...local, size, style: { ...local.style, bold: true } }, { before: 8, after: 4 });
        return;
      }
      case "blockquote": {
        const bar = ctx.x + 3;
        this.renderChildren(el, {
          ...local,
          x: ctx.x + 14,
          quoteBars: [...ctx.quoteBars, bar],
          style: { ...local.style, italic: true },
        });
        this.y += 2;
        return;
      }
      case "ul":
      case "ol":
        this.renderList(el, local);
        return;
      case "pre":
        this.renderCode(el, local);
        return;
      case "hr":
        this.ensureSpace(14);
        this.y += 6;
        this.pdf.setDrawColor(200, 200, 200);
        this.pdf.setLineWidth(0.8);
        this.pdf.line(ctx.x, this.y, this.contentRight, this.y);
        this.y += 8;
        return;
      case "img":
        this.renderImage(el, local);
        return;
      case "label":
      case "input":
      case "script":
      case "style":
        return;
      default:
        // div, section, table cells… — descend, and any stray inline run still gets drawn.
        this.renderChildren(el, local);
    }
  }

  private renderList(list: HTMLElement, ctx: Ctx) {
    const ordered = list.tagName.toLowerCase() === "ol";
    const isTask = list.getAttribute("data-type") === "taskList";
    const start = parseInt(list.getAttribute("start") ?? "1", 10) || 1;
    let n = start;
    for (const child of [...list.children]) {
      if (child.tagName.toLowerCase() !== "li") continue;
      const li = child as HTMLElement;
      const inner: Ctx = {
        ...ctx,
        x: ctx.x + INDENT_STEP + (isTask ? 6 : 0),
        marker: isTask
          ? { kind: "task", checked: li.getAttribute("data-checked") === "true" }
          : { kind: "text", text: ordered ? `${n}.` : "•" },
      };
      n += 1;
      this.renderChildren(li, inner);
    }
    this.y += 2;
  }

  private renderCode(pre: HTMLElement, ctx: Ctx) {
    const size = ctx.size * 0.92;
    const lineH = size * 1.4;
    const text = sanitize(pre.textContent ?? "").replace(/\n$/, "");
    const maxW = this.contentRight - ctx.x - 16;
    this.pdf.setFont("courier", "normal");
    this.pdf.setFontSize(size);
    const lines: string[] = text
      .split("\n")
      .flatMap((l) => (l ? (this.pdf.splitTextToSize(l, maxW) as string[]) : [""]));
    this.y += 4;
    lines.forEach((l) => {
      this.ensureSpace(lineH);
      this.pdf.setFillColor(244, 241, 236);
      this.pdf.rect(ctx.x, this.y, this.contentRight - ctx.x, lineH, "F");
      this.pdf.setFont("courier", "normal");
      this.pdf.setFontSize(size);
      this.pdf.setTextColor(30, 30, 30);
      this.pdf.text(l, ctx.x + 8, this.y + lineH * 0.72);
      this.y += lineH;
    });
    this.y += 6;
  }

  private renderImage(el: HTMLElement, ctx: Ctx) {
    const loaded = this.images.get(el.getAttribute("src") ?? "");
    if (!loaded) {
      this.drawParagraph([document.createTextNode("[imagem indisponível]")], { ...ctx, style: { italic: true } }, { after: 4 });
      return;
    }
    const maxW = this.contentRight - ctx.x;
    const maxH = this.pageH - PAGE_MARGIN * 2;
    // Natural pixels at 96dpi → pt, but never wider than the column.
    const pxToPt = 0.75;
    const fit = Math.min(maxW / (loaded.width * pxToPt), maxH / (loaded.height * pxToPt), 1);
    const w = loaded.width * pxToPt * fit;
    const h = loaded.height * pxToPt * fit;
    this.ensureSpace(h + 8);
    this.y += 4;
    let x = ctx.x;
    if (ctx.align === "center") x += (maxW - w) / 2;
    else if (ctx.align === "right") x += maxW - w;
    this.pdf.addImage(loaded.data, "JPEG", x, this.y, w, h);
    this.y += h + 6;
  }

  drawTitle(title: string) {
    const size = 24;
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(size);
    this.pdf.setTextColor(20, 20, 20);
    const lines = this.pdf.splitTextToSize(sanitize(title), this.contentRight - PAGE_MARGIN) as string[];
    for (const l of lines) {
      this.ensureSpace(size * 1.3);
      this.pdf.text(l, PAGE_MARGIN, this.y + size);
      this.y += size * 1.3;
    }
    this.y += 4;
    this.pdf.setDrawColor(217, 119, 6);
    this.pdf.setLineWidth(1.5);
    this.pdf.line(PAGE_MARGIN, this.y, PAGE_MARGIN + 48, this.y);
    this.y += 16;
  }

  rootContext(): Ctx {
    return { x: PAGE_MARGIN, quoteBars: [], size: BASE_SIZE, style: {}, align: "left" };
  }

  drawPageNumbers() {
    const total = this.pdf.getNumberOfPages();
    if (total < 2) return;
    for (let i = 1; i <= total; i += 1) {
      this.pdf.setPage(i);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setFontSize(9);
      this.pdf.setTextColor(140, 140, 140);
      this.pdf.text(`${i} / ${total}`, this.pageW / 2, this.pageH - 24, { align: "center" });
    }
  }
}

function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned || "Nota"}.pdf`;
}

/** Builds the PDF for a note. Runs in the browser only (needs DOMParser/canvas). */
export async function noteToPdfFile(title: string, bodyHtml: string): Promise<File> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  pdf.setProperties({ title: title || "Nota" });

  const doc = new DOMParser().parseFromString(bodyHtml || "", "text/html");
  const renderer = new Renderer(pdf);
  await renderer.preload(doc.body);

  renderer.drawTitle(title || "Nova nota");
  renderer.renderChildren(doc.body, renderer.rootContext());
  renderer.drawPageNumbers();

  const blob = pdf.output("blob");
  return new File([blob], safeFileName(title), { type: "application/pdf" });
}
