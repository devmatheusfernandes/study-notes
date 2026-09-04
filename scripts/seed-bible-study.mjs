/**
 * Seed do conteúdo da Bíblia de Estudo (rodapés, notas de estudo, esboço e
 * referências cruzadas oficiais) a partir de data/nwt_st.sqlite — ver
 * data/nwt_st_structure.md para o esquema da fonte e a migração
 * 0020_bible_study_edition.sql para o destino.
 *
 * Mesma forma dos outros seeds: sql.js para ler o sqlite, `pg` para escrever
 * via DATABASE_URL, tudo numa transação só.
 *
 * Re-rodável. As três tabelas novas são truncadas no início; as referências
 * cruzadas NÃO — elas convivem com as ~687 mil de data/cross_references.sqlite
 * na mesma tabela, então aqui só se apaga e reinsere `source = 'nwt'`.
 *
 *   npm run seed:bible-study
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import initSqlJs from "sql.js";
import { prepareStudyHtml, extractOutlineTitle } from "./bible-study-html.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      })
  );
}

const env = { ...readEnv(), ...process.env };
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL não está definida (.env ou ambiente).");
  process.exit(1);
}

const dbPath = path.join(root, "data", "nwt_st.sqlite");
if (!fs.existsSync(dbPath)) {
  console.error(`Arquivo não encontrado: ${dbPath}`);
  process.exit(1);
}

const SQL = await initSqlJs();
const sqlite = new SQL.Database(fs.readFileSync(dbPath));
const query = (sql) => {
  const result = sqlite.exec(sql);
  return result.length > 0 ? result[0].values : [];
};

// ─── Mapa de versículos da fonte ──────────────────────────────────────────
const verseById = new Map(
  query("SELECT id, book_order, chapter, verse, is_superscription FROM verses").map((row) => [
    row[0],
    { bookOrder: row[1], chapter: row[2], verse: row[3], isSuperscription: Boolean(row[4]) },
  ])
);

// ─── Leitura e preparo (fora da transação: é o passo caro) ────────────────
console.log("Preparando HTML (reescrita de links jwpub:// + sanitização)…");

const footnotes = query("SELECT id, verse_id, footnote_index, content FROM footnotes ORDER BY id").map(
  ([id, verseId, index, content]) => {
    const v = verseById.get(verseId);
    return [id, verseId, v.bookOrder, v.chapter, index, prepareStudyHtml(content)];
  }
);

const studyNotes = query("SELECT id, verse_id, label, content FROM study_notes ORDER BY id").map(
  ([id, verseId, label, content]) => {
    const v = verseById.get(verseId);
    return [
      id,
      verseId,
      v.bookOrder,
      v.chapter,
      v.verse,
      label ? prepareStudyHtml(label) : null,
      prepareStudyHtml(content),
    ];
  }
);

const outline = query(
  `SELECT id, parent_id, level, book_number, begin_chapter, begin_verse, end_chapter, end_verse, content
   FROM book_outline ORDER BY id`
).map(([id, parentId, level, bookNumber, bc, bv, ec, ev, content]) => [
  id,
  parentId,
  level,
  bookNumber,
  bc,
  bv,
  ec,
  ev,
  extractOutlineTitle(content),
  prepareStudyHtml(content),
]);

/**
 * Referências cruzadas: a fonte guarda ids de versículo, a tabela de destino
 * guarda livro/capítulo/versículo decomposto (formato herdado da migração
 * 0015, que precisa continuar valendo para as linhas 'extended').
 *
 * `sort_order` da fonte é `marcador * 1000 + índice dentro do marcador` — daí
 * `marker`. `rank` é recalculado como um ordinal simples por versículo, para
 * ter o mesmo significado nas duas fontes (as linhas 'extended' já usam
 * 1, 2, 3…), e a ordenação por `sort_order` preserva a ordem original.
 */
const crossRefsRaw = query(
  `SELECT source_verse_id, target_first_verse_id, target_last_verse_id, sort_order
   FROM cross_references ORDER BY source_verse_id, sort_order`
);

const crossRefs = [];
let rankCounter = 0;
let previousSource = null;
let crossChapterRanges = 0;

for (const [sourceId, targetFirstId, targetLastId, sortOrder] of crossRefsRaw) {
  const src = verseById.get(sourceId);
  const first = verseById.get(targetFirstId);
  const last = verseById.get(targetLastId);
  if (!src || !first) continue;

  if (sourceId !== previousSource) {
    rankCounter = 0;
    previousSource = sourceId;
  }
  rankCounter += 1;

  // `ref_end_verse` só consegue expressar uma faixa dentro do mesmo capítulo.
  // Duas referências da fonte atravessam capítulo/livro; nesses casos guarda
  // só o versículo inicial em vez de inventar um fim errado.
  let endVerse = null;
  if (last && targetLastId !== targetFirstId) {
    if (last.bookOrder === first.bookOrder && last.chapter === first.chapter) {
      endVerse = last.verse;
    } else {
      crossChapterRanges += 1;
    }
  }

  crossRefs.push([
    src.bookOrder,
    src.chapter,
    src.verse, // NULL nas 52 referências que nascem numa superescrição
    rankCounter,
    first.bookOrder,
    first.chapter,
    first.verse,
    endVerse,
    "nwt",
    Math.floor(sortOrder / 1000),
  ]);
}

console.log(
  `${footnotes.length} rodapés, ${studyNotes.length} notas de estudo, ` +
    `${outline.length} linhas de esboço, ${crossRefs.length} referências cruzadas.`
);
if (crossChapterRanges > 0) {
  console.log(`  (${crossChapterRanges} faixa(s) atravessando capítulo — guardadas só com o versículo inicial.)`);
}

sqlite.close();

// ─── Escrita ──────────────────────────────────────────────────────────────
const client = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

async function insertBatched(table, columns, rows) {
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = batch.map((row, idx) => {
      const base = idx * columns.length;
      values.push(...row);
      return `(${columns.map((_, c) => `$${base + c + 1}`).join(", ")})`;
    });
    await client.query(
      `insert into public.${table} (${columns.join(", ")}) values ${placeholders.join(", ")}`,
      values
    );
    process.stdout.write(`\r  ${table}… ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");
}

await client.query("begin");
try {
  // A integridade que a FK ausente não dá (ver o comentário na migração
  // 0020): confere que cada verse_id referenciado existe em bible_verses E
  // aponta para o mesmo livro/capítulo/versículo da fonte. É isso que pega um
  // bible_verses desatualizado — exatamente a classe de bug do João 8, em que
  // os ids existiam mas apontavam para o versículo errado.
  const { rows: pgVerses } = await client.query(
    "select id, book_order, chapter, verse from public.bible_verses"
  );
  const pgById = new Map(pgVerses.map((r) => [r.id, r]));

  const referenced = new Set([
    ...footnotes.map((r) => r[1]),
    ...studyNotes.map((r) => r[1]),
    ...crossRefsRaw.flatMap((r) => [r[0], r[1], r[2]]),
  ]);

  const mismatches = [];
  for (const verseId of referenced) {
    const source = verseById.get(verseId);
    const target = pgById.get(verseId);
    if (!source) continue;
    if (!target) {
      mismatches.push(`id ${verseId} não existe em bible_verses`);
    } else if (
      target.book_order !== source.bookOrder ||
      target.chapter !== source.chapter ||
      target.verse !== source.verse
    ) {
      mismatches.push(
        `id ${verseId}: fonte diz ${source.bookOrder}:${source.chapter}:${source.verse}, ` +
          `bible_verses diz ${target.book_order}:${target.chapter}:${target.verse}`
      );
    }
    if (mismatches.length >= 5) break;
  }

  if (mismatches.length > 0) {
    throw new Error(
      `bible_verses não corresponde a data/nwt_st.sqlite — rode 'npm run seed:bible' primeiro.\n  ` +
        mismatches.join("\n  ")
    );
  }
  console.log(`Validados ${referenced.size} ids de versículo contra bible_verses. OK.`);

  await client.query("truncate table public.bible_footnotes");
  await client.query("truncate table public.bible_study_notes");
  await client.query("truncate table public.bible_outline");
  // Nunca truncar: as linhas 'extended' da migração 0015 moram aqui também.
  const { rowCount: removed } = await client.query(
    "delete from public.bible_cross_references where source = 'nwt'"
  );
  if (removed > 0) console.log(`Removidas ${removed} referências 'nwt' anteriores.`);

  await insertBatched(
    "bible_footnotes",
    ["id", "verse_id", "book_order", "chapter", "footnote_index", "content_html"],
    footnotes
  );
  await insertBatched(
    "bible_study_notes",
    ["id", "verse_id", "book_order", "chapter", "verse", "label_html", "content_html"],
    studyNotes
  );
  await insertBatched(
    "bible_outline",
    ["id", "parent_id", "level", "book_order", "begin_chapter", "begin_verse", "end_chapter", "end_verse", "title", "content_html"],
    outline
  );
  await insertBatched(
    "bible_cross_references",
    ["book_order", "chapter", "verse", "rank", "ref_book_order", "ref_chapter", "ref_start_verse", "ref_end_verse", "source", "marker"],
    crossRefs
  );

  await client.query("commit");
  console.log("OK — conteúdo da Bíblia de Estudo populado.");
} catch (error) {
  await client.query("rollback");
  console.error("\nFalhou:", error.message ?? error);
  process.exit(1);
} finally {
  await client.end();
}
