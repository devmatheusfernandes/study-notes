# NWT_corrected.sqlite — Estrutura do banco da Bíblia

## Objetivo

Este banco contém o texto completo da Tradução do Novo Mundo em português, com um esquema de IDs que **corresponde exatamente** ao `BibleVerseId` usado internamente pelo JW Library. Qualquer citação bíblica encontrada em `BibleCitation.FirstBibleVerseId` / `LastBibleVerseId` / `BibleVerseId` dentro de um arquivo `.jwpub` pode ser resolvida com um lookup direto por `id` nesta tabela, sem nenhuma conversão.

## Regras para o parser

1. `verses.id` é o `BibleVerseId` oficial do JW Library. Use-o diretamente para resolver `FirstBibleVerseId`/`LastBibleVerseId`/`BibleVerseId` de qualquer `.jwpub`.
2. O ID começa em **0** (Gênesis 1:1) e vai até **31193** (Apocalipse 22:21), totalizando 31.194 linhas.
3. Nem toda linha é um "verso" no sentido tradicional: 116 linhas são **superescrições** de Salmos (títulos como "Salmo de Davi, quando fugia de seu filho Absalão"). Essas linhas têm `is_superscription = 1` e `verse = NULL`.
4. Para ordenar biblicamente, use `book_order`, depois `chapter`, depois `verse` — nunca `id` sozinho como proxy de ordem canônica (embora `id` já siga a ordem canônica aqui, `book_order` é a forma explícita e à prova de dúvida).
5. `text` pode ser `NULL` em 11 casos específicos (ver seção "Textos ausentes"). Trate isso como "sem texto disponível", não como erro.

## Tabela `verses`

| Coluna | Tipo | Nulo? | Descrição |
|---|---|---|---|
| `id` | INTEGER (PK) | Não | `BibleVerseId` oficial do JW Library. 0 a 31193. |
| `book` | TEXT | Não | Nome do livro (ex.: `Gênesis`, `Salmo`, `Mateus`, `Apocalipse`). |
| `chapter` | INTEGER | Não | Número do capítulo. |
| `verse` | INTEGER | Sim | Número do verso. `NULL` quando `is_superscription = 1`. |
| `text` | TEXT | Sim | Texto do verso ou da superescrição. `NULL` em 11 casos (ver abaixo). |
| `is_superscription` | INTEGER (0/1) | Não | `1` para as 116 superescrições de capítulos de Salmos. `0` para versos normais. |
| `book_order` | INTEGER | Não | Ordem canônica do livro, de 1 (Gênesis) a 66 (Apocalipse). |

### Índices disponíveis

- `idx_verses_id` em `verses(id)`
- `idx_verses_book_chapter_verse` em `verses(book, chapter, verse)`
- `idx_verses_superscription` em `verses(is_superscription)`

## Tabela `books`

Ordem canônica dos 66 livros.

| Coluna | Tipo | Descrição |
|---|---|---|
| `book` | TEXT (PK) | Nome canônico do livro. |
| `canonical_order` | INTEGER | Posição canônica, de 1 a 66. |

## Como resolver uma citação de `.jwpub`

Quando o parser encontrar, no banco interno de uma publicação `.jwpub`:

```text
BibleCitation.FirstBibleVerseId = X
BibleCitation.LastBibleVerseId  = Y
```

faça o lookup direto:

```sql
SELECT id, book, chapter, verse, text, is_superscription
FROM verses
WHERE id BETWEEN ? AND ?
ORDER BY id;
```

Passe `X` e `Y` sem nenhuma conversão. Para uma citação de um único verso, `X = Y`.

## Como exibir um capítulo (incluindo superescrição, se houver)

A superescrição, quando existe, é sempre a primeira linha do capítulo:

```sql
SELECT id, verse, text, is_superscription
FROM verses
WHERE book = 'Salmo' AND chapter = 23
ORDER BY id;
```

Na exibição, trate `is_superscription = 1` como um bloco de título separado, sem número de verso — não tente numerá-la como "verso 1".

## Como buscar por referência humana (livro/capítulo/verso)

```sql
SELECT id, book, chapter, verse, text
FROM verses
WHERE book = 'Marcos'
  AND chapter = 4
  AND verse = 28;
```

Para não depender da grafia exata de `book`, consulte primeiro `books` e use o nome retornado.

## Textos ausentes (11 casos com `text IS NULL`)

Não são bugs — são lacunas/decisões editoriais da própria tradução:

- **Números 30:7** — um único verso sem texto disponível na fonte.
- **João 8:2-11** (10 versos) — a passagem da mulher pega em adultério. A Tradução do Novo Mundo não inclui esse trecho como texto principal por não constar nos manuscritos mais antigos.

Se uma citação apontar para um desses IDs, exiba algo como "texto não disponível nesta tradução" em vez de tratar como erro de resolução.

## O que o parser NÃO deve fazer

- Não renumerar ou recriar `verses.id` — é o identificador oficial e estável do JW Library.
- Não assumir que toda linha tem `verse` preenchido — verifique `is_superscription` antes de exibir número de verso.
- Não tratar `text IS NULL` como falha de lookup — é um estado válido para os 11 casos documentados acima.
- Não inferir ordem canônica a partir de `id` isolado em ferramentas que só têm acesso a um subconjunto de linhas — prefira `book_order`.
