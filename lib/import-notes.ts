export interface DiscoveredFile {
  file: File;
  relativePath: string;
  folderPath: string[];
}

export interface ParsedNote {
  title: string;
  body: string;
  folderPath?: string[];
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

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type?: string;
  text?: string;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
}

/** Converts Tiptap AST JSON document node structure ({ type: "doc", content: [...] }) into HTML. */
export function tiptapNodeToHtml(node: TiptapNode | null | undefined): string {
  if (!node) return "";

  if (node.type === "text") {
    let text = escapeHtml(node.text || "");
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark.type === "bold") text = `<strong>${text}</strong>`;
        else if (mark.type === "italic") text = `<em>${text}</em>`;
        else if (mark.type === "code") text = `<code>${text}</code>`;
        else if (mark.type === "superscript") text = `<sup>${text}</sup>`;
        else if (mark.type === "subscript") text = `<sub>${text}</sub>`;
        else if (mark.type === "link") {
          const href = mark.attrs?.href || "#";
          text = `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        }
      }
    }
    return text;
  }

  const childrenHtml = (Array.isArray(node.content) ? node.content : [])
    .map(tiptapNodeToHtml)
    .join("");

  switch (node.type) {
    case "doc":
      return childrenHtml;
    case "paragraph":
      return `<p>${childrenHtml}</p>`;
    case "heading": {
      const level = node.attrs?.level || 1;
      return `<h${level}>${childrenHtml}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${childrenHtml}</ul>`;
    case "orderedList":
      return `<ol>${childrenHtml}</ol>`;
    case "listItem":
      return `<li>${childrenHtml}</li>`;
    case "taskList":
      return `<ul data-type="taskList">${childrenHtml}</ul>`;
    case "taskItem": {
      const checked = !!node.attrs?.checked;
      return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox" ${
        checked ? 'checked="checked"' : ""
      }/></label><div>${childrenHtml}</div></li>`;
    }
    case "blockquote":
      return `<blockquote>${childrenHtml}</blockquote>`;
    case "codeBlock": {
      const lang = node.attrs?.language || "";
      return `<pre><code class="language-${lang}">${childrenHtml}</code></pre>`;
    }
    case "image": {
      const src = node.attrs?.src || "";
      const alt = node.attrs?.alt || "";
      return `<img src="${src}" alt="${alt}" />`;
    }
    case "hardBreak":
      return "<br/>";
    case "horizontalRule":
      return "<hr/>";
    default:
      return childrenHtml ? `<p>${childrenHtml}</p>` : "";
  }
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

    if (!trimmed) {
      closeLists();
      continue;
    }

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

    if (trimmed.startsWith(">")) {
      closeLists();
      const quoteText = trimmed.replace(/^>\s*/, "");
      htmlParts.push(`<blockquote><p>${parseInlineMarkdown(quoteText)}</p></blockquote>`);
      continue;
    }

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

/** Sanitizes unescaped raw newlines/tabs inside string values in JSON files. */
function sanitizeJsonContent(raw: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (char === '"' && !escaped) {
      inString = !inString;
      result += char;
    } else if (inString) {
      if (char === "\n") {
        const rest = raw.slice(i + 1).trimStart();
        if (rest.startsWith("]") || rest.startsWith("}") || rest.startsWith(",")) {
          inString = false;
          result += '"\n';
        } else {
          result += "\\n";
        }
      } else if (char === "\r") {
        result += "\\r";
      } else if (char === "\t") {
        result += "\\t";
      } else {
        result += char;
      }
    } else {
      result += char;
    }
    escaped = char === "\\" && !escaped;
  }

  if (inString) result += '"';
  return result;
}

function parseNoteContent(rawContent: unknown): string {
  if (!rawContent) return "<p></p>";
  if (typeof rawContent === "object" && rawContent !== null) {
    const obj = rawContent as Record<string, unknown>;
    if (obj.type === "doc" || Array.isArray(obj.content)) {
      return tiptapNodeToHtml(obj as TiptapNode);
    }
    return `<pre><code>${escapeHtml(JSON.stringify(rawContent, null, 2))}</code></pre>`;
  }
  if (typeof rawContent === "string") {
    if (rawContent.includes("<p>") || rawContent.includes("<h1>") || rawContent.includes("<div>")) {
      return rawContent;
    }
    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;
      if (typeof parsed === "object" && parsed !== null && (parsed.type === "doc" || Array.isArray(parsed.content))) {
        return tiptapNodeToHtml(parsed as TiptapNode);
      }
    } catch {
      // plain text
    }
    return parseTxtToNote(rawContent, "nota").body;
  }
  return "<p></p>";
}

/** Parses JSON file content (including backup JSON exports with notes and folders) into ParsedNote objects. */
export function parseJsonToNotes(content: string, fileName: string): ParsedNote[] {
  const baseTitle = fileName.replace(/\.json$/i, "").replace(/\.md$/i, "").trim() || "Nova nota";
  const notes: ParsedNote[] = [];
  const folderMap = new Map<string, string>();

  // Extract folders array if present in JSON text
  const foldersMatch = content.match(/"folders"\s*:\s*(\[[^\]]*\])/);
  if (foldersMatch) {
    try {
      const folders = JSON.parse(foldersMatch[1]);
      if (Array.isArray(folders)) {
        folders.forEach((f: Record<string, unknown>) => {
          if (typeof f.id === "string" && typeof f.name === "string") {
            folderMap.set(f.id, f.name);
          }
        });
      }
    } catch {}
  }

  let parsed: unknown = null;
  try {
    const clean = sanitizeJsonContent(content);
    parsed = JSON.parse(clean);
  } catch {}

  if (parsed && typeof parsed === "object") {
    const parsedObj = parsed as Record<string, unknown>;
    const rawNotes: unknown[] = Array.isArray(parsed)
      ? (parsed as unknown[])
      : Array.isArray(parsedObj.notes)
      ? (parsedObj.notes as unknown[])
      : parsedObj.title || parsedObj.content || parsedObj.body || parsedObj.text
      ? [parsedObj]
      : [];

    let folderCounter = 1;

    for (const rawItem of rawNotes) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      const title =
        typeof item.title === "string"
          ? item.title
          : typeof item.name === "string"
          ? item.name
          : `${baseTitle} (${notes.length + 1})`;
      const folderId = typeof item.folderId === "string" ? item.folderId : undefined;
      if (folderId && !folderMap.has(folderId)) {
        folderMap.set(folderId, `Pasta ${folderCounter++}`);
      }
      const folderName = folderId ? folderMap.get(folderId) : undefined;
      const body = parseNoteContent(item.content || item.body || item.text);

      notes.push({
        title,
        body,
        folderPath: folderName ? [folderName] : undefined,
      });
    }

    if (notes.length > 0) return notes;
  }

  // Resilient fallback for broken or partially truncated backup JSON files
  const matches = [...content.matchAll(/"title"\s*:\s*"([^"]+)"/g)];
  let folderCounter = 1;

  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1];
    const startIdx = matches[i].index || 0;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index || content.length : content.length;
    const chunk = content.slice(startIdx, nextStart);

    const folderMatch = chunk.match(/"folderId"\s*:\s*"([^"]+)"/);
    const folderId = folderMatch ? folderMatch[1] : undefined;

    if (folderId && !folderMap.has(folderId)) {
      folderMap.set(folderId, `Pasta ${folderCounter++}`);
    }
    const folderName = folderId ? folderMap.get(folderId) : undefined;

    let body = "";
    const contentIdx = chunk.indexOf('"content":');
    if (contentIdx !== -1) {
      const objStart = chunk.indexOf("{", contentIdx);
      if (objStart !== -1) {
        let depth = 0;
        let objEnd = objStart;
        for (let j = objStart; j < chunk.length; j++) {
          if (chunk[j] === "{") depth++;
          else if (chunk[j] === "}") {
            depth--;
            if (depth === 0) {
              objEnd = j + 1;
              break;
            }
          }
        }
        if (objEnd > objStart) {
          try {
            const docStr = sanitizeJsonContent(chunk.slice(objStart, objEnd));
            const docObj = JSON.parse(docStr);
            if (docObj.type === "doc" || Array.isArray(docObj.content)) {
              body = tiptapNodeToHtml(docObj);
            }
          } catch {}
        }
      }
    }

    if (!body) {
      const texts = [...chunk.matchAll(/"text"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      body = texts.map((t) => `<p>${escapeHtml(t)}</p>`).join("");
    }

    notes.push({
      title,
      body: body || "<p></p>",
      folderPath: folderName ? [folderName] : undefined,
    });
  }

  if (notes.length > 0) return notes;

  // Generic JSON fallback: format neatly as code block
  return [
    {
      title: baseTitle,
      body: `<pre><code class="language-json">${escapeHtml(content)}</code></pre>`,
    },
  ];
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
    // If the .md file actually contains JSON backup content, route to JSON backup parser!
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && (trimmed.includes('"notes"') || trimmed.includes('"content"'))) {
      return parseJsonToNotes(content, file.name);
    }
    return [parseMdToNote(content, file.name)];
  }
  if (ext === "txt") {
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && (trimmed.includes('"notes"') || trimmed.includes('"content"'))) {
      return parseJsonToNotes(content, file.name);
    }
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

  return Array.from(dataTransfer.files).map((file) => ({
    file,
    relativePath: file.name,
    folderPath: [],
  }));
}
