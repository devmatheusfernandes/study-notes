export interface DiscoveredFile {
  file: File;
  relativePath: string;
  folderPath: string[];
}

export interface ParsedNote {
  title: string;
  body: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Format inline markdown syntax to Tiptap-friendly HTML. */
function parseInlineMarkdown(text: string): string {
  let escaped = escapeHtml(text);
  // Bold: **text** or __text__
  escaped = escaped.replace(/(\*\*|__)(.*?)\1/g, "<strong>$2</strong>");
  // Italic: *text* or _text_
  escaped = escaped.replace(/(\*|_)(.*?)\1/g, "<em>$2</em>");
  // Inline Code: `text`
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links: [label](url)
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return escaped;
}

/** Converts markdown string into note title (extracted from # Heading if present) and Tiptap HTML. */
export function parseMdToNote(content: string, fileName: string): ParsedNote {
  const baseTitle = fileName.replace(/\.md$/i, "").trim() || "Nova nota";
  const lines = content.split(/\r?\n/);
  let extractedTitle: string | undefined = undefined;
  const htmlParts: string[] = [];

  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = "";

  let inUnorderedList = false;
  let inOrderedList = false;

  function closeLists() {
    if (inUnorderedList) {
      htmlParts.push("</ul>");
      inUnorderedList = false;
    }
    if (inOrderedList) {
      htmlParts.push("</ol>");
      inOrderedList = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code blocks ```
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        // Close code block
        htmlParts.push(`<pre><code class="language-${codeLang}">${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
        inCodeBlock = false;
        codeBuffer = [];
        codeLang = "";
      } else {
        closeLists();
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Empty lines
    if (!trimmed) {
      closeLists();
      continue;
    }

    // Headings #, ##, ###, etc.
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeLists();
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      if (level === 1 && !extractedTitle) {
        extractedTitle = headingText;
      }
      htmlParts.push(`<h${level}>${parseInlineMarkdown(headingText)}</h${level}>`);
      continue;
    }

    // Blockquotes >
    if (trimmed.startsWith(">")) {
      closeLists();
      const quoteText = trimmed.replace(/^>\s*/, "");
      htmlParts.push(`<blockquote><p>${parseInlineMarkdown(quoteText)}</p></blockquote>`);
      continue;
    }

    // Checkboxes / Task list items: - [ ] or - [x]
    const taskMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      const checked = taskMatch[1].toLowerCase() === "x";
      const itemText = taskMatch[2];
      if (!inUnorderedList) {
        closeLists();
        htmlParts.push('<ul data-type="taskList">');
        inUnorderedList = true;
      }
      htmlParts.push(
        `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox" ${
          checked ? 'checked="checked"' : ""
        }/></label><div><p>${parseInlineMarkdown(itemText)}</p></div></li>`
      );
      continue;
    }

    // Unordered list items: - or * or +
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      if (inOrderedList) closeLists();
      if (!inUnorderedList) {
        htmlParts.push("<ul>");
        inUnorderedList = true;
      }
      htmlParts.push(`<li><p>${parseInlineMarkdown(ulMatch[1])}</p></li>`);
      continue;
    }

    // Ordered list items: 1. item
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (inUnorderedList) closeLists();
      if (!inOrderedList) {
        htmlParts.push("<ol>");
        inOrderedList = true;
      }
      htmlParts.push(`<li><p>${parseInlineMarkdown(olMatch[1])}</p></li>`);
      continue;
    }

    // Regular paragraph
    closeLists();
    htmlParts.push(`<p>${parseInlineMarkdown(trimmed)}</p>`);
  }

  closeLists();

  if (inCodeBlock) {
    htmlParts.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
  }

  return {
    title: extractedTitle || baseTitle,
    body: htmlParts.join("") || "<p></p>",
  };
}

/** Converts plain text string into note title and HTML paragraphs. */
export function parseTxtToNote(content: string, fileName: string): ParsedNote {
  const title = fileName.replace(/\.txt$/i, "").trim() || "Nova nota";
  const blocks = content.split(/\r?\n\r?\n/);
  const paragraphs = blocks
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `<p>${escapeHtml(b).replace(/\r?\n/g, "<br/>")}</p>`)
    .join("");

  return {
    title,
    body: paragraphs || "<p></p>",
  };
}

/** Parses JSON file content into one or multiple ParsedNote objects. */
export function parseJsonToNotes(content: string, fileName: string): ParsedNote[] {
  const baseTitle = fileName.replace(/\.json$/i, "").trim() || "Nova nota";

  try {
    const parsed = JSON.parse(content);

    // Array of note objects
    if (Array.isArray(parsed)) {
      const notes: ParsedNote[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (typeof item === "object" && item !== null) {
          const title = item.title || item.name || `${baseTitle} (${i + 1})`;
          const rawBody = item.body || item.content || item.text || JSON.stringify(item, null, 2);
          const body =
            typeof rawBody === "string" && (rawBody.includes("<p>") || rawBody.includes("<h1>"))
              ? rawBody
              : parseTxtToNote(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody, null, 2), title).body;
          notes.push({ title, body });
        } else {
          notes.push({
            title: `${baseTitle} (${i + 1})`,
            body: `<p>${escapeHtml(String(item))}</p>`,
          });
        }
      }
      if (notes.length > 0) return notes;
    }

    // Single note object { title, body }
    if (typeof parsed === "object" && parsed !== null) {
      if (parsed.title || parsed.body || parsed.content || parsed.text) {
        const title = parsed.title || parsed.name || baseTitle;
        const rawBody = parsed.body || parsed.content || parsed.text || JSON.stringify(parsed, null, 2);
        const body =
          typeof rawBody === "string" && (rawBody.includes("<p>") || rawBody.includes("<h1>"))
            ? rawBody
            : parseTxtToNote(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody, null, 2), title).body;
        return [{ title, body }];
      }
    }

    // Generic JSON fallback: format neatly as a code block
    const formatted = JSON.stringify(parsed, null, 2);
    return [
      {
        title: baseTitle,
        body: `<pre><code class="language-json">${escapeHtml(formatted)}</code></pre>`,
      },
    ];
  } catch {
    return [
      {
        title: baseTitle,
        body: `<pre><code class="language-json">${escapeHtml(content)}</code></pre>`,
      },
    ];
  }
}

/** Check whether a file is a text/document format that should be converted to a note. */
export function isNoteImportFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "txt" || ext === "md" || ext === "json";
}

/** Reads a File as text asynchronously. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Parses any File (.txt, .md, .json) into an array of ParsedNote objects. */
export async function parseFileToNotes(file: File): Promise<ParsedNote[]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const content = await readFileAsText(file);

  if (ext === "md") {
    return [parseMdToNote(content, file.name)];
  }
  if (ext === "txt") {
    return [parseTxtToNote(content, file.name)];
  }
  if (ext === "json") {
    return parseJsonToNotes(content, file.name);
  }
  return [];
}

/** Recursively extracts files and directory paths from DataTransfer items using `webkitGetAsEntry`. */
export async function extractDiscoveredItems(dataTransfer: DataTransfer): Promise<DiscoveredFile[]> {
  const discovered: DiscoveredFile[] = [];

  async function traverseEntry(entry: FileSystemEntry, path: string[] = []): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      await new Promise<void>((resolve) => {
        fileEntry.file(
          (file) => {
            discovered.push({
              file,
              relativePath: [...path, file.name].join("/"),
              folderPath: path,
            });
            resolve();
          },
          () => resolve()
        );
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const dirReader = dirEntry.createReader();
      const readEntriesBatch = (): Promise<FileSystemEntry[]> => {
        return new Promise((resolve) => {
          dirReader.readEntries(
            (entries) => resolve(entries),
            () => resolve([])
          );
        });
      };

      let entries: FileSystemEntry[] = [];
      let batch: FileSystemEntry[];
      do {
        batch = await readEntriesBatch();
        entries = entries.concat(batch);
      } while (batch.length > 0);

      for (const child of entries) {
        await traverseEntry(child, [...path, dirEntry.name]);
      }
    }
  }

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === "file") {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    }

    if (entries.length > 0) {
      for (const entry of entries) {
        await traverseEntry(entry, []);
      }
      return discovered;
    }
  }

  // Fallback for standard file drop without webkitGetAsEntry
  return Array.from(dataTransfer.files).map((file) => ({
    file,
    relativePath: file.name,
    folderPath: [],
  }));
}
