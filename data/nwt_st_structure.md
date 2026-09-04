# nwt_full.sqlite — Bíblia com notas de rodapé, notas de estudo, referências cruzadas e esboço

## O que mudou em relação ao NWT_corrected.sqlite

Mesma tabela `verses`/`books` de antes (31.194 versos, IDs 0–31193, esquema oficial do JW Library), **mais quatro tabelas novas**: `footnotes`, `study_notes`, `cross_references`, `book_outline`. Todo o conteúdo textual delas veio decodificado (AES-CBC + zlib) diretamente do `.jwpub` da Bíblia de Estudo — não é mais um placeholder.

## Tabela `footnotes`

```sql
CREATE TABLE footnotes(
  id INTEGER PRIMARY KEY,
  verse_id INTEGER NOT NULL,   -- FK verses.id
  footnote_index INTEGER,      -- ordem da nota dentro do verso (1ª, 2ª nota...)
  content TEXT                 -- HTML da nota
)
```

9.227 notas. Exemplo de `content`:
```html
<div id="footnote1" data-fnid="1" class="fcc fn-ref"><p id="p468" data-pid="468">Ou: "sem forma".</p></div>
```
O texto útil está dentro do `<p>` — extraia com qualquer parser HTML (`innerText`/`get_text()`).

## Tabela `study_notes`

```sql
CREATE TABLE study_notes(
  id INTEGER PRIMARY KEY,
  verse_id INTEGER NOT NULL,   -- FK verses.id
  label TEXT,                  -- HTML: referência do verso ("1:1") como link jwpub://
  content TEXT                 -- HTML: o corpo da nota de estudo
)
```

3.354 notas. `label` é um pequeno bloco HTML tipo:
```html
<p class="se"><a href="jwpub://b/NWTR/40:1:1-40:1:1" class="b"><strong>1:1</strong></a></p>
```
`content` é o texto explicativo em si, ex.:
```html
<p class="s5"><strong>livro da história:</strong> As primeiras palavras do texto grego de Mateus...</p>
```
Um verso pode ter zero, uma ou mais notas de estudo (várias frases/termos do mesmo verso comentados separadamente).

## Tabela `cross_references`

```sql
CREATE TABLE cross_references(
  id INTEGER PRIMARY KEY,
  source_verse_id INTEGER NOT NULL,       -- FK verses.id (o verso que tem a referência)
  target_first_verse_id INTEGER NOT NULL, -- FK verses.id (início do trecho referenciado)
  target_last_verse_id INTEGER NOT NULL,  -- FK verses.id (fim do trecho referenciado; igual ao first se for 1 verso só)
  sort_order INTEGER                      -- ordem de exibição (letra a, b, c... do verso)
)
```

60.884 referências. **Sem HTML nenhum** — são só IDs, então não precisa decodificar nada pra usar. Exemplo real: Salmo 3:1 (a superescrição menciona a fuga de Davi de Absalão) tem duas referências, para 2 Samuel 15:12 e 2 Samuel 16:15 — a narrativa histórica correspondente.

```sql
-- referências cruzadas de um verso, já com o texto do alvo resolvido
SELECT cr.sort_order, v.book, v.chapter, v.verse, v.text
FROM cross_references cr
JOIN verses v ON v.id = cr.target_first_verse_id
WHERE cr.source_verse_id = ?
ORDER BY cr.sort_order;
```

Não há ligação com a posição exata da letra (a, b, c) dentro do texto do verso — só sabemos que aquele verso tem aquela referência, não qual palavra específica a originou. Se seu app precisa mostrar a letrinha no meio do texto, essa granularidade não está disponível sem decodificar o `BibleChapter.Content` também (que tem os marcadores `<span class="m">`).

## Tabela `book_outline`

```sql
CREATE TABLE book_outline(
  id INTEGER PRIMARY KEY,
  parent_id INTEGER,      -- FK book_outline.id (hierarquia em árvore, NULL = raiz)
  level INTEGER,          -- profundidade na árvore (1, 2, 3...)
  book_number INTEGER,    -- 1-66, mesmo número usado em book_order
  begin_chapter INTEGER,
  begin_verse INTEGER,
  end_chapter INTEGER,
  end_verse INTEGER,
  content TEXT            -- HTML com o título da seção (dentro de <li>/<a>)
)
```

5.758 entradas. É o esboço temático de cada livro (ex. "Criação dos céus e da terra" cobrindo Gênesis 1:1-2:3). Monte a árvore recursivamente por `parent_id`. O `content` de cada nível já vem com o HTML aninhado da lista inteira até aquele ponto (é assim que o formato original armazena) — pegue só o texto do último `<li>`/`<a>` se quiser exibir nível a nível, ou use o de nível mais profundo se quiser só a folha.

## Como tudo se liga

```
verses.id (BibleVerseId oficial)
  ├── footnotes.verse_id
  ├── study_notes.verse_id
  ├── cross_references.source_verse_id
  │     └── cross_references.target_first_verse_id/target_last_verse_id → verses.id (outro verso)
  └── book_outline.book_number + begin_chapter/verse..end_chapter/verse (não é FK direta, é faixa)
```

## Renderização do HTML

Todo `content`/`label` é um fragmento HTML pensado para a UI oficial do JW Library (classes CSS como `s5`, `se`, `fcc fn-ref`, links `jwpub://`). Para o seu projeto:

- **Se só precisa do texto puro**: extraia com `get_text()` (Python/BeautifulSoup) ou `.textContent` (JS/DOM), igual já fazemos com `Document.Content` das publicações.
- **Se quiser preservar formatação** (negrito em termos-chave, itálico): renderize o HTML diretamente, mas troque os links `jwpub://b/NWTR/...` pelos seus próprios links internos de referência bíblica (o formato é `jwpub://b/NWTR/{livro}:{capítulo}:{verso}-{livro}:{capítulo}:{verso}`).

## O que ficou de fora (por enquanto)

- **Quadros de destaque / "O que a Bíblia diz"** (`Extract`/`DocumentExtract`, 401 registros) — mesma decodificação funciona, só não extraí ainda. Avise se quiser.
- **Mapas e imagens** (`Multimedia`, `Asset`) — são arquivos de mídia (jpg/svg) dentro do `.jwpub`, não texto; não fazem parte deste `.sqlite`.
- **Posição exata da letra de referência marginal dentro do texto do verso** — como explicado acima em `cross_references`, sabemos que existe a referência, não a palavra exata que a originou.

## Reimportação / atualização futura

Se o JW Library atualizar o conteúdo da Bíblia de Estudo (nova build), o processo pra gerar um `nwt_full.sqlite` novo é: baixar o `.jwpub` atualizado, extrair `manifest.json` → pegar `symbol`/`year`/`language`/`issueId`, derivar a chave (`SHA-256("{language}_{symbol}_{year}[_{issueId}]")` XOR a constante fixa do formato, primeiros 16 bytes = chave AES, últimos 16 = IV), decodificar cada `Content` (AES-CBC → zlib padrão, `wbits=15`), e rodar o mesmo mapeamento de tabelas descrito aqui.
