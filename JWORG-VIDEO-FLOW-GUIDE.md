# Guia do fluxo de vídeo do JW.org

Este guia explica como o projeto coleta vídeos do JW.org, identifica a melhor URL de reprodução, busca as legendas/transcrições em VTT, converte o texto para um formato utilizável e salva tudo para consulta posterior.

---

## Visão geral

O fluxo funciona em etapas:

```text
JW.org API
  ↓
Crawl por categorias
  ↓
Filtrar vídeos com legendas
  ↓
Escolher melhor URL de vídeo
  ↓
Buscar arquivo de legenda (.vtt)
  ↓
Converter VTT para texto limpo
  ↓
Salvar no banco / Firestore
  ↓
Exibir vídeo + transcrição na UI
```

Os pontos principais ficam em:

- `lib/video/video-crawler.ts`
- `lib/video/video-utils.ts`
- `lib/video/video-service.ts`
- `scripts/importAllVideos.ts`
- `app/hub/(dashboard)/personal-study/video/[id]/page.tsx`

---

## 1) Onde começa a coleta

A busca começa em `lib/video/video-crawler.ts`.

### A API usada

```ts
const url = `https://b.jw-cdn.org/apis/mediator/v1/categories/T/${key}?detailed=1&mediaLimit=0&clientType=www`
```

Esse endpoint retorna categorias e mídia do JW.org em formato JSON. A função `crawlCategory()` percorre a árvore de categorias até achar vídeos relevantes.

```ts
async function fetchCategory(key: string): Promise<ApiResponse> {
  const url = `https://b.jw-cdn.org/apis/mediator/v1/categories/T/${key}?detailed=1&mediaLimit=0&clientType=www`
  const res = await fetch(url)
  return res.json()
}
```

### Como a categoria é percorrida

```ts
export async function crawlCategory(key: string, rootKey?: string, visited = new Set<string>()): Promise<VideoData[]> {
  if (visited.has(key)) return []
  visited.add(key)

  const data = await fetchCategory(key)
  const category = data?.category
  if (!category) return []

  const mediaList = Array.isArray(category.media) ? category.media : []
  const validVideos: VideoData[] = []

  for (const video of mediaList) {
    let subtitlesUrl: string | undefined
    for (const f of video.files || []) {
      if (f?.subtitles?.url) {
        subtitlesUrl = f.subtitles.url
        break
      }
    }

    if (!subtitlesUrl) continue

    validVideos.push({
      id: video.naturalKey,
      title: video.title || "",
      categoryKey: key,
      primaryCategory: video.primaryCategory || key,
      durationFormatted: video.durationFormattedMinSec || "",
      coverImage: video.images?.wss?.lg || video.images?.pnr?.lg || video.images?.sqr?.lg || undefined,
      subtitlesUrl,
      videoUrl: selectBestVideoUrl(video.files || []),
      book: extractBook(title)
    })
  }

  // recursão para subcategorias
  const subcategories = Array.isArray(category.subcategories) ? category.subcategories : []
  const subResults = await Promise.all(
    subcategories.map((sub) => crawlCategory(sub.key, rootKey, visited))
  )

  return [...validVideos, ...subResults.flat()]
}
```

### O que é filtrado

O projeto só considera vídeos que têm legenda disponível. Isso é importante, porque a transcrição é a base para:

- busca por conteúdo
- resumo de vídeo
- notas pessoais
- indexação em vetores

Se o vídeo não tiver `subtitles.url`, ele é ignorado.

---

## 2) Como escolhe a melhor URL do vídeo

A função `selectBestVideoUrl()` em `lib/video/video-utils.ts` pega a lista de arquivos do vídeo e seleciona o melhor MP4.

```ts
interface VideoFile {
  mimetype?: string;
  frameHeight?: number;
  bitRate?: number;
  progressiveDownloadURL?: string;
}

export function selectBestVideoUrl(files: VideoFile[] = []): string | undefined {
  const mp4s = files.filter((f) => String(f?.mimetype || "").includes("mp4"))
  if (mp4s.length === 0) return undefined

  mp4s.sort((a, b) => {
    const ah = Number(a?.frameHeight || 0)
    const bh = Number(b?.frameHeight || 0)
    const ar = Number(a?.bitRate || 0)
    const br = Number(b?.bitRate || 0)
    if (bh !== ah) return bh - ah
    return br - ar
  })

  return mp4s[mp4s.length - 1]?.progressiveDownloadURL
}
```

### Lógica

- filtra somente arquivos MP4
- ordena pelo maior `frameHeight` (resolução)
- se houver empate, usa maior `bitRate`
- retorna a URL final do vídeo

Isso garante que o app use o melhor vídeo disponível para o usuário.

---

## 3) Como busca a transcrição

A transcrição normalmente vem em um arquivo VTT no JW.org. O projeto salva a URL da legenda em `subtitlesUrl`.

```ts
let subtitlesUrl: string | undefined
for (const f of video.files || []) {
  if (f?.subtitles?.url) {
    subtitlesUrl = f.subtitles.url
    break
  }
}
```

Depois, em `scripts/importAllVideos.ts`, ele faz a requisição:

```ts
const res = await fetch(video.subtitlesUrl!)
if (!res.ok) throw new Error(`Status ${res.status}`)

const vtt = await res.text()
const contentText = formatVttToText(vtt)
```

Ou seja: o projeto baixa o arquivo `.vtt`, transforma em texto e salva esse texto para busca, contexto e consulta.

---

## 4) Como o VTT vira texto legível

A função `formatVttToText()` em `lib/video/video-utils.ts` remove o ruído do formato VTT e converte em texto em blocos.

```ts
export function formatVttToText(vtt: string): string {
    const lines = vtt.split("\n")
    const paragraphs: string[] = []
    let buffer = ""

    for (const raw of lines) {
        let line = raw.trim()
        if (!line) continue
        if (line.startsWith("WEBVTT")) continue
        if (line.includes("-->")) continue
        if (/^[0-9]+$/.test(line)) continue

        line = line.replace(/<[^>]+>/g, "").trim()

        if (buffer.length > 0) {
            buffer += " " + line
        } else {
            buffer = line
        }

        if (/[.!?…]$/.test(line)) {
            paragraphs.push(buffer.trim())
            buffer = ""
        }
    }

    if (buffer) paragraphs.push(buffer.trim())
    return paragraphs.join("\n\n")
}
```

### O que ela remove

- cabeçalho `WEBVTT`
- linhas de tempo `00:00:01.000 --> 00:00:03.000`
- números de linhas
- tags HTML como `<c.colorE5E5E5>`

### Resultado

A transcrição fica em texto quase limpo, em parágrafos legíveis para:

- buscar
- mostrar junto ao vídeo
- indexar para IA
- extrair contexto

---

## 5) Como gera segmentos por tempo

Além de transformar o VTT em texto bruto, o projeto também pode quebrar a legenda em blocos por tempo usando `parseVttToSegments()`.

```ts
export interface TranscriptSegment {
    startTime: number;
    startTimeFormatted: string;
    text: string;
}

export function parseVttToSegments(vtt: string): TranscriptSegment[] {
    const lines = vtt.split(/\r?\n/);
    const segments: TranscriptSegment[] = [];
    let currentStartTime: number | null = null;
    let currentBuffer = "";

    const timestampRegex = /(\d{2}:\d{2}:\d{2}.\d{3}) --> (\d{2}:\d{2}:\d{2}.\d{3})/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line === "WEBVTT") continue;

        const tsMatch = line.match(timestampRegex);
        if (tsMatch) {
            const startStr = tsMatch[1];
            const parts = startStr.split(":");
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const s = parseFloat(parts[2]);
            const seconds = h * 3600 + m * 60 + s;

            if (currentStartTime === null) {
                currentStartTime = seconds;
            }
            continue;
        }

        if (/^\d+$/.test(line)) continue;

        const cleanText = line.replace(/<[^>]+>/g, "").trim();
        if (!cleanText) continue;

        if (currentBuffer) {
            currentBuffer += " " + cleanText;
        } else {
            currentBuffer = cleanText;
        }

        if (/[.!?…]$/.test(cleanText)) {
            if (currentStartTime !== null) {
                segments.push({
                    startTime: currentStartTime,
                    startTimeFormatted: formatSecondsToTimestamp(currentStartTime),
                    text: currentBuffer.trim()
                });
                currentStartTime = null;
                currentBuffer = "";
            }
        }
    }

    if (currentBuffer && currentStartTime !== null) {
        segments.push({
            startTime: currentStartTime,
            startTimeFormatted: formatSecondsToTimestamp(currentStartTime),
            text: currentBuffer.trim()
        });
    }

    return segments;
}
```

Esse formato é muito útil em player de vídeo, porque permite:

- sincronizar legenda com o tempo
- criar destaque por trecho
- permitir busca por frase exata
- mostrar transcrição clicável ao lado do vídeo

---

## 6) Como salva os vídeos no banco

A importação em massa acontece em `scripts/importAllVideos.ts`.

### Importação em lote

```ts
export async function importAllVideos() {
  const videos = await crawlCategory(ROOT_CATEGORY)
  const existingIdsSnap = await adminDb.collection(VIDEOS_COLLECTION).select().get();
  const existingIds = new Set(existingIdsSnap.docs.map(doc => doc.id));
  const newVideos = videos.filter(video => !existingIds.has(video.id));

  for (let i = 0; i < newVideos.length; i += 20) {
    const batch = newVideos.slice(i, i + 20)

    await Promise.all(batch.map(async (video) => {
      const res = await fetch(video.subtitlesUrl!)
      const vtt = await res.text()
      const contentText = formatVttToText(vtt)

      await docRef.set({
        ...video,
        contentText,
        tokens: tokenize(contentText),
        subtitlesHash: hash(contentText),
        tokenVersion: 1,
        vectorSynced: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    }))
  }
}
```

### O que é salvo

Cada vídeo recebe campos como:

- `id`
- `title`
- `categoryKey`
- `primaryCategory`
- `durationFormatted`
- `coverImage`
- `subtitlesUrl`
- `videoUrl`
- `contentText`
- `tokens`
- `subtitlesHash`
- `updatedAt`

Isso permite:

- listagem no app
- busca de texto do conteúdo
- reprodução do vídeo
- busca semântica e vetorial

---

## 7) Como o app busca um vídeo pelo ID

A resolução real de vídeo acontece em `lib/video/video-service.ts`.

### Ordem de busca

1. tenta pegar do cache local
2. tenta pegar no Firestore
3. tenta buscar pela API do JW.org

```ts
async getVideoById(id: string): Promise<VideoData | null> {
  const cached = findVideoInCache(id)
  if (cached) return cached

  const ref = doc(db, VIDEOS_COLLECTION, id)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    return { id: snap.id, ...snap.data() } as VideoData
  }

  const url = `https://b.jw-cdn.org/apis/mediator/v1/media-items/T/${id}?clientType=www`
  const res = await fetch(url)
  // ...
}
```

### O que ele recupera

- `title`
- `primaryCategory`
- `coverImage`
- `videoUrl`
- `subtitlesUrl`

Isso é importante porque nem sempre o vídeo está listado localmente; vale a busca de fallback pela API.

---

## 8) Como o vídeo é exibido na interface

A página de exibição está em `app/hub/(dashboard)/personal-study/video/[id]/page.tsx`.

Ela faz basicamente:

```ts
const data = await videoService.getVideoById(id as string)
if (data && data.subtitlesUrl) {
  const res = await fetch(data.subtitlesUrl)
  const vtt = await res.text()
  const segments = parseVttToSegments(vtt)
  setSegments(segments)
}
```

Depois:

- renderiza um player de vídeo com a melhor URL encontrada
- monta os blocos de legenda
- mostra a transcrição em texto
- permite navegar por timestamps

Exemplo simplificado:

```tsx
<video controls src={video.videoUrl} />

{segments.map((segment) => (
  <button key={segment.startTime} onClick={() => setCurrentTime(segment.startTime)}>
    {segment.startTimeFormatted} - {segment.text}
  </button>
))}
```

---

## 9) Como a transcrição ajuda a busca e IA

Uma parte útil do projeto é transformar a legenda em texto limpo e depois tokenizar esse texto.

```ts
const contentText = formatVttToText(vtt)
const tokens = tokenize(contentText)
```

Isso permite:

- busca textual rápida
- busca por conversão/ia
- resumos do conteúdo do vídeo
- indexação em banco vetorial

Em outras palavras: o vídeo não é só reproduzido; ele vira conteúdo pesquisável.

---

## 10) Fluxo resumido

```text
JW.org API
  ↓
fetchCategory()
  ↓
crawlCategory()
  ↓
filtra apenas vídeos com subtitlesUrl
  ↓
selectBestVideoUrl(files)
  ↓
fetch(subtitlesUrl)
  ↓
formatVttToText(vtt)
  ↓
parseVttToSegments(vtt) (opcional)
  ↓
Salvar no Firestore / banco
  ↓
Exibir vídeo + transcrição + busca
```

---

## 11) Código completo para usar em um único arquivo

Abaixo está um bloco completo, prático para você copiar em um único guia ou em um protótipo inicial. Ele reúne as partes essenciais:

- tipos
- utilitário de VTT
- crawler da API do JW.org
- importação massiva
- serviço de acesso ao vídeo
- componente mínimo de player + transcrição

### 11.1 Tipos

```ts
export interface VideoData {
  id: string;
  title: string;
  categoryKey?: string;
  rootCategoryKey?: string;
  primaryCategory?: string;
  durationFormatted?: string;
  coverImage?: string;
  subtitlesUrl?: string;
  videoUrl?: string;
  book?: string;
  contentText?: string;
  tokens?: string[];
  updatedAt?: string;
  importedAsNote?: boolean;
  noteId?: string;
}
```

### 11.2 Utilitários de transcrição

```ts
export interface TranscriptSegment {
  startTime: number;
  startTimeFormatted: string;
  text: string;
}

export function extractBook(title: string): string | undefined {
  const books = [
    "Gen", "Ex", "Lev", "Num", "Deut", "Jos", "Jud", "Rut", "1Sam", "2Sam",
    "1Reis", "2Reis", "1Cron", "2Cron", "Esdras", "Neemias", "Ester", "Jó",
    "Sal", "Prov", "Ecl", "Canta", "Isa", "Jer", "Lam", "Eze", "Dan", "Os",
    "Joel", "Am", "Ob", "Jon", "Miq", "Naum", "Hab", "Sof", "Age", "Zar",
    "Mal", "Mat", "Mar", "Luc", "Joao", "At", "Rom", "1Cor", "2Cor", "Gal",
    "Ef", "Fil", "Col", "1Tes", "2Tes", "1Tim", "2Tim", "Tito", "Filem",
    "Heb", "Tiago", "1Pe", "2Pe", "1Jo", "2Jo", "3Jo", "Jud", "Ap"
  ];

  const lower = title.toLowerCase();
  for (const book of books) {
    if (lower.includes(book.toLowerCase())) return book;
  }
  return undefined;
}

export function formatSecondsToTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function formatVttToText(vtt: string): string {
  const lines = vtt.split("\n");
  const paragraphs: string[] = [];
  let buffer = "";

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith("WEBVTT")) continue;
    if (line.includes("-->")) continue;
    if (/^[0-9]+$/.test(line)) continue;

    line = line.replace(/<[^>]+>/g, "").trim();

    if (buffer.length > 0) {
      buffer += " " + line;
    } else {
      buffer = line;
    }

    if (/[.!?…]$/.test(line)) {
      paragraphs.push(buffer.trim());
      buffer = "";
    }
  }

  if (buffer) paragraphs.push(buffer.trim());
  return paragraphs.join("\n\n");
}

export function parseVttToSegments(vtt: string): TranscriptSegment[] {
  const lines = vtt.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  let currentStartTime: number | null = null;
  let currentBuffer = "";

  const timestampRegex = /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "WEBVTT") continue;

    const tsMatch = trimmed.match(timestampRegex);
    if (tsMatch) {
      const startStr = tsMatch[1];
      const [h, m, sText] = startStr.split(":");
      const s = parseFloat(sText);
      const seconds = Number(h) * 3600 + Number(m) * 60 + s;

      if (currentStartTime === null) {
        currentStartTime = seconds;
      }
      continue;
    }

    if (/^\d+$/.test(trimmed)) continue;

    const cleanText = trimmed.replace(/<[^>]+>/g, "").trim();
    if (!cleanText) continue;

    currentBuffer = currentBuffer ? `${currentBuffer} ${cleanText}` : cleanText;

    if (/[.!?…]$/.test(cleanText) && currentStartTime !== null) {
      segments.push({
        startTime: currentStartTime,
        startTimeFormatted: formatSecondsToTimestamp(currentStartTime),
        text: currentBuffer.trim(),
      });

      currentStartTime = null;
      currentBuffer = "";
    }
  }

  if (currentBuffer && currentStartTime !== null) {
    segments.push({
      startTime: currentStartTime,
      startTimeFormatted: formatSecondsToTimestamp(currentStartTime),
      text: currentBuffer.trim(),
    });
  }

  return segments;
}

interface VideoFile {
  mimetype?: string;
  frameHeight?: number;
  bitRate?: number;
  progressiveDownloadURL?: string;
}

export function selectBestVideoUrl(files: VideoFile[] = []): string | undefined {
  const mp4s = files.filter((f) => (f.mimetype || "").includes("mp4"));
  if (mp4s.length === 0) return undefined;

  mp4s.sort((a, b) => {
    const ah = Number(a.frameHeight || 0);
    const bh = Number(b.frameHeight || 0);
    const ar = Number(a.bitRate || 0);
    const br = Number(b.bitRate || 0);
    if (bh !== ah) return bh - ah;
    return br - ar;
  });

  return mp4s[mp4s.length - 1]?.progressiveDownloadURL;
}
```

### 11.3 Crawler básico do JW.org

```ts
export interface VideoApiItem {
  naturalKey: string;
  title?: string;
  primaryCategory?: string;
  durationFormattedMinSec?: string;
  images?: {
    wss?: { lg?: string };
    pnr?: { lg?: string };
    sqr?: { lg?: string };
  };
  files?: {
    subtitles?: { url?: string };
    mimetype?: string;
    frameHeight?: number;
    bitRate?: number;
    progressiveDownloadURL?: string;
  }[];
}

export async function fetchCategory(key: string) {
  const url = `https://b.jw-cdn.org/apis/mediator/v1/categories/T/${key}?detailed=1&mediaLimit=0&clientType=www`;
  const res = await fetch(url);
  return res.json();
}

export async function crawlCategory(key: string, rootKey?: string, visited = new Set<string>()): Promise<VideoData[]> {
  if (visited.has(key)) return [];
  visited.add(key);

  const data = await fetchCategory(key);
  const category = data?.category;
  if (!category) return [];

  const mediaList = Array.isArray(category.media) ? category.media : [];
  const validVideos: VideoData[] = [];

  for (const video of mediaList) {
    const subtitlesUrl = (video.files || []).find((f) => f?.subtitles?.url)?.subtitles?.url;
    if (!subtitlesUrl) continue;

    const title = video.title || "";
    const coverImage = video.images?.wss?.lg || video.images?.pnr?.lg || video.images?.sqr?.lg || undefined;
    const videoUrl = selectBestVideoUrl(video.files || []);

    validVideos.push({
      id: video.naturalKey,
      title,
      categoryKey: key,
      rootCategoryKey: rootKey || key,
      primaryCategory: video.primaryCategory || key,
      durationFormatted: video.durationFormattedMinSec || "",
      coverImage,
      subtitlesUrl,
      videoUrl,
      book: extractBook(title),
    });
  }

  const subcategories = Array.isArray(category.subcategories) ? category.subcategories : [];
  const subResults = await Promise.all(
    subcategories.map((sub: { key: string }) => crawlCategory(sub.key, rootKey || key, visited))
  );

  return [...validVideos, ...subResults.flat()];
}
```

### 11.4 Importação em massa para persistência

```ts
import crypto from "crypto";

function hash(text: string) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

export async function importAllVideos() {
  const videos = await crawlCategory("T");

  for (const video of videos) {
    const res = await fetch(video.subtitlesUrl!);
    if (!res.ok) throw new Error(`Status ${res.status} ao buscar legenda`);

    const vtt = await res.text();
    const contentText = formatVttToText(vtt);

    await saveToDatabase({
      id: video.id,
      title: video.title,
      subtitlesUrl: video.subtitlesUrl,
      videoUrl: video.videoUrl,
      contentText,
      tokens: tokenize(contentText),
      subtitlesHash: hash(contentText),
      updatedAt: new Date().toISOString(),
    });
  }
}
```

### 11.5 Tokenização simples para busca

```ts
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}
```

### 11.6 Serviço para buscar um vídeo pelo ID

```ts
export async function getVideoById(id: string): Promise<VideoData | null> {
  const cached = findVideoInCache(id);
  if (cached) return cached;

  const url = `https://b.jw-cdn.org/apis/mediator/v1/media-items/T/${id}?clientType=www`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const video = data?.media?.[0];
  if (!video) return null;

  const subtitlesUrl = (video.files || []).find((f: any) => f?.subtitles?.url)?.subtitles?.url;
  const videoUrl = selectBestVideoUrl(video.files || []);

  return {
    id: video.naturalKey,
    title: video.title || "",
    categoryKey: video.primaryCategory || "VideoOnDemand",
    primaryCategory: video.primaryCategory || "VideoOnDemand",
    durationFormatted: video.durationFormattedMinSec || "",
    coverImage: video.images?.wss?.lg || video.images?.pnr?.lg || video.images?.sqr?.lg || undefined,
    subtitlesUrl,
    videoUrl,
  };
}
```

### 11.7 Componente mínimo de player + transcrição

```tsx
"use client";

import { useEffect, useState } from "react";
import { parseVttToSegments, TranscriptSegment } from "./video-utils";

export function VideoPlayer({ videoId }: { videoId: string }) {
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    async function load() {
      const data = await getVideoById(videoId);
      if (!data) return;

      setVideoUrl(data.videoUrl);
      if (!data.subtitlesUrl) return;

      const res = await fetch(data.subtitlesUrl);
      const vtt = await res.text();
      setSegments(parseVttToSegments(vtt));
    }

    load();
  }, [videoId]);

  return (
    <div>
      {videoUrl && (
        <video
          controls
          src={videoUrl}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          style={{ width: "100%", maxWidth: 900 }}
        />
      )}

      <div style={{ marginTop: 16 }}>
        {segments.map((segment) => {
          const active = Math.abs(segment.startTime - currentTime) < 2;
          return (
            <button
              key={`${segment.startTime}-${segment.text}`}
              onClick={() => setCurrentTime(segment.startTime)}
              style={{
                display: "block",
                padding: "8px 10px",
                marginBottom: 8,
                background: active ? "#dbeafe" : "#f4f4f5",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <small>{segment.startTimeFormatted}</small>
              <div>{segment.text}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

---

## 12) Conclusão

Esse conjunto de trechos é o mínimo funcional para reproduzir o fluxo do projeto:

- descobrir vídeos no JW.org
- identificar o melhor MP4 disponível
- baixar a legenda VTT
- converter em texto legível
- tokenizar para busca
- salvar e exibir no app

Se você quiser, o próximo passo é transformar isso em um único módulo pronto para produção, com:

- `videoService.ts`
- `videoCrawler.ts`
- `videoUtils.ts`
- `VideoPlayer.tsx`
- `importAllVideos.ts`

Tudo estruturado em uma pasta única e pronto para colar em outro projeto.

O fluxo de vídeos do JW.org neste projeto segue uma lógica bem clara:

1. percorre categorias do JW.org via API
2. seleciona vídeos com legenda
3. escolhe a melhor URL de conteúdo no MP4
4. baixa a legenda em VTT
5. converte VTT para texto natural
6. salva em banco/Firestore com tokens para busca
7. usa esse conteúdo para exibir o vídeo e a transcrição na interface

É um fluxo muito útil para qualquer app que queira:

- catalogar vídeos religiosos
- gerar transcrições
- permitir busca de conteúdo
- reutilizar o texto de vídeo em IA ou notes

---

## 12) Se quiser reproduzir em outro projeto

Você pode seguir esse esquema minimalista:

```ts
const categories = await fetch('https://b.jw-cdn.org/apis/mediator/v1/categories/T/...')
const videos = categories.category.media

const valid = videos.filter(v => v.files.some(f => f.subtitles?.url))

for (const video of valid) {
  const subtitlesUrl = video.files.find(f => f.subtitles?.url)?.subtitles?.url
  const videoUrl = selectBestVideoUrl(video.files)

  const vtt = await fetch(subtitlesUrl!).then(r => r.text())
  const text = formatVttToText(vtt)

  console.log({
    id: video.naturalKey,
    title: video.title,
    subtitlesUrl,
    videoUrl,
    text
  })
}
```

Isso já dá a base para montar um sistema funcional de catalogação e transcrição de vídeos do JW.org.

Se quiser, eu também posso criar um terceiro markdown com uma versão pronta para implementação, contendo um `videoService.ts`, `crawler.ts` e `ui/video-player.tsx` prontos para colar em outro projeto.
