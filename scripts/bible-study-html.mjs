/**
 * Reescrita de links `jwpub://` + sanitização do HTML da Bíblia de Estudo.
 *
 * Roda no SEED, não na leitura — mesma regra que lib/jwpub/sanitize.ts segue
 * no ingest de uma publicação: o banco só guarda markup confiável, e o leitor
 * é um renderizador puro. Assim o DOMPurify nunca precisa liberar um esquema
 * de URI exótico, e nenhum componente precisa saber que `jwpub://` existe.
 *
 * É um `.mjs` em scripts/ (e não `lib/bible/…​.ts`) porque só o seed usa isso,
 * e o seed é um script standalone rodado pelo node — fora do module graph do
 * Next, que não resolveria um `.ts`.
 */
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

/**
 * Um único JSDOM para o processo inteiro, reaproveitado por todas as
 * chamadas. Instanciar um por linha estourava a heap do V8 na tabela de
 * esboço (5.758 linhas) muito antes de terminar — cada JSDOM carrega um
 * `window` completo e o GC não acompanhava o ritmo do laço.
 */
const dom = new JSDOM("<div id='scratch'></div>");
const scratch = dom.window.document.getElementById("scratch");

const DOMPurify = createDOMPurify(dom.window);

/**
 * Formato real dos links internos, confirmado contra o arquivo:
 *
 *   jwpub://b/NWTR/40:1:1-40:1:1   → referência bíblica (livro:cap:verso, 1-66)
 *   jwpub://c/T:1001070105/1:3-1:5 → trecho de um documento da publicação
 *   jwpub://p/T:1001077384/        → outra publicação, OU um apêndice
 *
 * Cada um vira um `data-*` inerte e o `href` cai fora, para nada poder
 * navegar para um esquema que o navegador não entende.
 *
 * `appendixMepsIds`, quando fornecido, é o conjunto de `meps_document_id` da
 * tabela `appendices` da fonte — sem ele, não há como saber se um link
 * `p/T:{id}/` aponta para um apêndice (que este seed também está prestes a
 * persistir, em `bible_appendices`) ou para uma publicação externa de
 * verdade (glossário, outra tradução). Passe-o sempre que ele já estiver
 * disponível — hoje isso é sempre, já que os apêndices vêm no mesmo sqlite.
 */
export function rewriteBibleStudyLinks(html, appendixMepsIds = new Set()) {
  if (typeof html !== "string") return "";

  return html.replace(
    /<a\b([^>]*?)href="jwpub:\/\/([^"]+)"([^>]*)>/gi,
    (_match, before, target, after) => {
      // b/NWTR/{livro}:{cap}:{verso}-{livro}:{cap}:{verso}
      const bible =
        /^b\/[^/]+\/(\d+):(\d+):(\d+)(?:-(\d+):(\d+):(\d+))?/.exec(target);
      if (bible) {
        const [, book, chapter, verse, endBook, endChapter, endVerse] = bible;
        // O fim só é anotado quando difere do início — a esmagadora maioria
        // das referências é de um versículo só (`40:1:1-40:1:1`), e repetir
        // a mesma tripla em todo link inflaria o HTML à toa.
        const isRange =
          endBook !== undefined &&
          (endBook !== book || endChapter !== chapter || endVerse !== verse);
        const endAttr = isRange
          ? ` data-bible-ref-end="${endBook}:${endChapter}:${endVerse}"`
          : "";
        return `<a${before}data-bible-ref="${book}:${chapter}:${verse}"${endAttr}${after}>`;
      }

      const pubRef = /^p\/T:(\d+)\/(?:(\d+)(?:-\d+)?(?::\d+)?)?$/.exec(target);
      if (pubRef) {
        const rawMepsId = Number(pubRef[1]);
        // O índice do Apêndice A ("Apêndice A" header's own TOC list) usa um
        // esquema de id "de menu" que é exatamente id_real − 9000 para seus 15
        // links (A1..A7-H) — verificado sem nenhum desvio contra os 15
        // artigos reais. Os índices de Apêndice B e C não têm esse offset;
        // usam o meps_document_id real do artigo diretamente. Sem esse
        // fallback, os 15 links do próprio índice de A ficariam mortos.
        const mepsId = appendixMepsIds.has(rawMepsId)
          ? rawMepsId
          : appendixMepsIds.has(rawMepsId + 9000)
            ? rawMepsId + 9000
            : null;

        // Um apêndice da própria Bíblia de Estudo: resolvido direto contra
        // bible_appendices, sem depender de o usuário ter importado nada.
        if (mepsId !== null) {
          return `<a${before}data-bible-appendix-ref="${mepsId}"${after}>`;
        }
        // Publicação externa de verdade (glossário, outra obra) — MESMO
        // atributo que resolveJwpubReferences em app/(app)/jwpub-actions.ts
        // já resolve, então fica clicável de graça quando o usuário tem
        // aquela publicação na biblioteca. Resolver aqui seria errado: se o
        // usuário importa a publicação depois, o link teria nascido morto.
        const pidAttr = pubRef[2] ? ` data-jwpub-pubref-pid="${pubRef[2]}"` : "";
        return `<a${before}data-jwpub-pubref="${rawMepsId}"${pidAttr}${after}>`;
      }

      // c/T:{id}/{faixa} e qualquer outro formato — preservados como texto,
      // sem clique. Resolver um documento da própria Bíblia de Estudo
      // exigiria um mapa MepsDocumentId → livro que não temos aqui.
      return `<a${before}data-bible-ref-raw="${target.replace(/"/g, "")}"${after}>`;
    }
  );
}

/**
 * Espelha lib/jwpub/sanitize.ts: perfil HTML padrão, mais os `data-*` que a
 * reescrita acima acabou de criar. `USE_PROFILES: { html: true }` já barra
 * `href`/`src` com esquema estranho, mas os links internos já viraram
 * `data-*` antes disso — o allowlist abaixo é o que sobra.
 */
export function sanitizeStudyHtml(html) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: [
      "class", "id", "colspan", "rowspan",
      "data-pid", "data-fnid", "data-bid", "data-xtid",
      "data-bible-ref", "data-bible-ref-end", "data-bible-ref-raw",
      "data-jwpub-pubref", "data-jwpub-pubref-pid", "data-bible-appendix-ref",
    ],
    // "img" is forbidden entirely, not just its `src`: 18 of the 62
    // appendices reference `jwpub-media://...` illustrations, but
    // data/nwt_st.sqlite has no media table backing this feature (unlike
    // .jwpub ingest, which has a real asset pipeline — see
    // uploadPublicationMedia in lib/jwpub/ingest.ts). An <img> with no `src`
    // renders a broken-image icon; dropping the tag leaves the figcaption
    // (kept — it's plain text describing the figure and reads fine alone).
    FORBID_TAGS: ["script", "style", "iframe", "form", "input", "object", "embed", "img"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "src", "srcset", "href", "style"],
  });
}

/** Reescreve e sanitiza, na ordem que importa. */
export function prepareStudyHtml(html, appendixMepsIds = new Set()) {
  return sanitizeStudyHtml(rewriteBibleStudyLinks(html ?? "", appendixMepsIds));
}

/**
 * Título exibível de uma linha de esboço.
 *
 * `book_outline.content` traz a lista inteira aninhada até aquele nó (o nível
 * 3 vem embrulhado no <ul> do nível 2, que vem no do nível 1), então o texto
 * útil é sempre o do <li> MAIS PROFUNDO — que é o último a abrir. Daí pegar a
 * última ocorrência, não a primeira.
 *
 * A faixa de versículos ("3-5") vem dentro do próprio <p>, num <span
 * class="altsize"> entre parênteses; ela é redundante com as colunas
 * begin_/end_chapter/verse, então sai fora para o título ficar limpo.
 */
export function extractOutlineTitle(html) {
  if (typeof html !== "string" || !html) return "";

  scratch.innerHTML = html;
  const items = scratch.querySelectorAll("li");
  const deepest = items[items.length - 1];
  if (!deepest) {
    scratch.innerHTML = "";
    return "";
  }

  const paragraph = deepest.querySelector("p") ?? deepest;
  for (const altsize of paragraph.querySelectorAll(".altsize")) altsize.remove();

  const title = (paragraph.textContent ?? "").replace(/\s+/g, " ").trim();
  scratch.innerHTML = "";
  return title;
}
