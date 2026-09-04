# data/nwt_st.sqlite — Estrutura do banco da Bíblia (tabelas `verses` / `books`)

> **Fonte trocada.** Estas tabelas vinham de `data/NWT.sqlite`, que foi removido: ele numerava João 8 errado, não tinha João 8:49-59 e grudava palavras onde deveria haver quebra de linha de poesia. O arquivo atual é `data/nwt_st.sqlite`, que corrige tudo isso e ainda traz as tabelas da Bíblia de Estudo (rodapés, notas de estudo, referências cruzadas e esboço) documentadas em `data/nwt_st_structure.md`.

## Objetivo

Este banco contém o texto completo da Tradução do Novo Mundo em português, com um esquema de IDs que **corresponde exatamente** ao `BibleVerseId` usado internamente pelo JW Library. Qualquer citação bíblica encontrada em `BibleCitation.FirstBibleVerseId` / `LastBibleVerseId` / `BibleVerseId` dentro de um arquivo `.jwpub` pode ser resolvida com um lookup direto por `id` nesta tabela, sem nenhuma conversão.

## Regras para o parser

1. `verses.id` é o `BibleVerseId` oficial do JW Library. Use-o diretamente para resolver `FirstBibleVerseId`/`LastBibleVerseId`/`BibleVerseId` de qualquer `.jwpub`.
2. O ID começa em **0** (Gênesis 1:1) e vai até **31193** (Apocalipse 22:21), totalizando 31.194 linhas.
3. Nem toda linha é um "verso" no sentido tradicional: 116 linhas são **superescrições** de Salmos (títulos como "Salmo de Davi, quando fugia de seu filho Absalão"). Essas linhas têm `is_superscription = 1` e `verse = NULL`.
4. Para ordenar biblicamente, use `book_order`, depois `chapter`, depois `verse` — nunca `id` sozinho como proxy de ordem canônica (embora `id` já siga a ordem canônica aqui, `book_order` é a forma explícita e à prova de dúvida).
5. `text` **nunca é `NULL`** e nunca é vazio. (A fonte antiga tinha 11 linhas nulas; todas eram bug de extração, não lacuna editorial — ver "João 8" abaixo.)
6. `text` contém `\n` reais nos trechos de poesia. Preserve-os: são a quebra de linha do texto impresso, não ruído.

## Quebras de linha de poesia

7.560 versos carregam pelo menos um `\n` (no máximo 7 linhas por verso), concentrados em Salmo (2.420), Isaías (1.087), Jó (993), Provérbios (895) e Jeremias (608). Oito livros não têm nenhuma.

```text
"Esta, por fim, é osso dos meus ossos\nE carne da minha carne."
```

Consequências práticas:

- **Na exibição**, renderize com `whitespace-pre-line` (ou equivalente) — sem isso o HTML colapsa o `\n` num espaço e a poesia vira prosa corrida.
- **Na vetorização**, normalize `\n` → espaço *antes* de fazer chunk. Quebra de linha aqui é tipografia, não semântica, e `lib/vector/chunker.ts` trata `\n` como candidato preferencial de corte — mantê-los faria cada linha de poesia virar um chunk.
- **Na tokenização de palavras** (`lib/jwlibrary/paragraph-tokens.ts`), o `\n` conta como espaço em branco e portanto separa tokens. É esse o comportamento que faz os `StartToken`/`EndToken` importados de um backup `.jwlibrary` caírem no lugar certo — a fonte antiga, sem as quebras, colapsava dois tokens num só e deslocava o destaque.

## João 8

A passagem da mulher pega em adultério (João 7:53–8:11) não faz parte do texto principal da Tradução do Novo Mundo, e **esses versos não têm `BibleVerseId` no esquema oficial**. Os 48 ids que o JW Library reserva para João 8 (26485–26532) são os versos **12 a 59**, não 1 a 48.

Isso foi validado contra a própria fonte: `study_notes.label` traz o `jwpub://b/NWTR/{livro}:{capítulo}:{verso}` do `.jwpub` junto do `verse_id`, e o mapeamento deste arquivo acerta os 3.354 rótulos (a fonte antiga errava os 10 que caem em João 8).

Não trate João 8:1-11 como "verso sem texto" — trate como verso que não existe neste esquema.

## Tabela `verses`

| Coluna | Tipo | Nulo? | Descrição |
|---|---|---|---|
| `id` | INTEGER (PK) | Não | `BibleVerseId` oficial do JW Library. 0 a 31193. |
| `book` | TEXT | Não | Nome do livro (ex.: `Gênesis`, `Salmo`, `Mateus`, `Apocalipse`). |
| `chapter` | INTEGER | Não | Número do capítulo. |
| `verse` | INTEGER | Sim | Número do verso. `NULL` quando `is_superscription = 1`. |
| `text` | TEXT | Não | Texto do verso ou da superescrição. Pode conter `\n` (poesia — ver acima). |
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

## Textos ausentes: não há

A fonte antiga tinha 11 linhas com `text IS NULL` e as documentava como decisões editoriais da tradução. **As duas explicações estavam erradas** e foram removidas junto com o arquivo:

- **Números 30:7** não era "verso sem texto na fonte" — era bug de split. O texto de 30:6 e 30:7 vinha grudado numa linha só (com um `7` literal no meio) e a linha seguinte ficava vazia. Aqui os dois versos estão separados corretamente.
- **João 8:2-11** não são versos vazios — são versos que não existem neste esquema de IDs. Ver a seção "João 8" acima.

O código da aplicação ainda tem um fallback `"texto não disponível nesta tradução"` para `text === null`; ele agora é inalcançável a partir deste banco, mas não custa nada e cobre um seed futuro incompleto.

## O que o parser NÃO deve fazer

- Não renumerar ou recriar `verses.id` — é o identificador oficial e estável do JW Library.
- Não assumir que toda linha tem `verse` preenchido — verifique `is_superscription` antes de exibir número de verso.
- Não remover nem colapsar os `\n` de `text` na camada de dados — a decisão de como exibi-los é da UI (ver "Quebras de linha de poesia").
- Não inferir ordem canônica a partir de `id` isolado em ferramentas que só têm acesso a um subconjunto de linhas — prefira `book_order`.
