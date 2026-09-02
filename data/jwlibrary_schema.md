# .jwlibrary — Estrutura do backup de dados do usuário (notas, marcações, tags, favoritos)

## Formato do arquivo

Um `.jwlibrary` é um **zip** contendo:

```
UserdataBackup_....jwlibrary/
├── manifest.json
├── userData.db          ← SQLite (schemaVersion 16)
├── default_thumbnail.png (opcional)
├── userData.db-wal       (só se exportado com WAL pendente — ver nota abaixo)
└── userData.db-shm
```

### `manifest.json`

```json
{
  "name": "UserdataBackup_....jwlibrary",
  "creationDate": "2026-09-02",
  "version": 1,
  "type": 0,
  "userDataBackup": {
    "lastModifiedDate": "2026-09-02T13:58:11Z",
    "deviceName": "Samsung_SM-A256E",
    "databaseName": "userData.db",
    "hash": "d3382bd0...",
    "schemaVersion": 16
  }
}
```

- `userDataBackup.hash` = **SHA-256 do arquivo `userData.db` bruto** (bytes exatos do arquivo dentro do zip, sem aplicar WAL). Confirmei isso recalculando o hash — bate exatamente.
- `schemaVersion` precisa corresponder ao schema que a versão do JW Library do usuário espera. `16` é a versão atual observada.

### WAL/SHM

Se o app exportar com um WAL pendente (`userData.db-wal`/`userData.db-shm` presentes), **aplique o checkpoint antes de ler**, ou dados recentes ficam de fora:

```python
import sqlite3
conn = sqlite3.connect("userData.db")
conn.execute("PRAGMA wal_checkpoint(FULL);")
```

Para **gerar** um `.jwlibrary` pronto pra reimportar, não inclua `-wal`/`-shm` no zip — faça o checkpoint antes de zipar, deixando só `userData.db` limpo. Recalcule o `hash` do manifest sobre esse arquivo final.

---

## Tabelas

### `Note` — as notas

```sql
CREATE TABLE Note(
  NoteId           INTEGER PRIMARY KEY,
  Guid             TEXT NOT NULL UNIQUE,
  UserMarkId       INTEGER,               -- FK UserMark, opcional (nota vinculada a uma marcação)
  LocationId       INTEGER,               -- FK Location
  Title            TEXT,
  Content          TEXT,
  LastModified     TEXT NOT NULL,         -- ISO 8601 UTC: 'YYYY-MM-DDTHH:MM:SSZ'
  Created          TEXT NOT NULL,
  BlockType        INTEGER NOT NULL DEFAULT 0,
  BlockIdentifier  INTEGER,
  CHECK((BlockType = 0 AND BlockIdentifier IS NULL)
     OR (BlockType BETWEEN 1 AND 2 AND BlockIdentifier IS NOT NULL))
)
```

- `BlockType = 0` → nota geral, presa ao `Location` inteiro (sem parágrafo/verso específico). `BlockIdentifier` deve ser `NULL`.
- `BlockType = 1` → nota em **parágrafo de publicação**. `BlockIdentifier` = número do parágrafo.
- `BlockType = 2` → nota em **verso bíblico**. `BlockIdentifier` = número do verso dentro do capítulo.
- `Guid` é obrigatório e único — gere um UUID v4 ao criar uma nota nova.
- `LastModified`/`Created` são obrigatórios, formato `strftime('%Y-%m-%dT%H:%M:%SZ','now')`.

### `Location` — "onde" uma nota/marcação/favorito aponta

```sql
CREATE TABLE Location(
  LocationId      INTEGER PRIMARY KEY,
  BookNumber      INTEGER,      -- 1-66, só quando é referência bíblica
  ChapterNumber   INTEGER,
  DocumentId      INTEGER,      -- MepsDocumentId (ID GLOBAL da publicação — não é o id interno do seu parser de .jwpub)
  Track           INTEGER,      -- faixa de áudio/vídeo
  IssueTagNumber  INTEGER NOT NULL DEFAULT 0,  -- edição/data da revista, formato AAAAMM00
  KeySymbol       TEXT,         -- símbolo da publicação, ex. 'nwtsty', 'w', 'it', 'pk'
  MepsLanguage    INTEGER,      -- código de idioma MEPS (ex. 0=inglês)
  Type            INTEGER NOT NULL,
  Title           TEXT,
  Specialty       TEXT,
  Edition         TEXT,
  UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type)
)
```

**`Type` — o que cada valor significa (confirmado nos dados reais):**

| Type | Significado | Campos preenchidos |
|---|---|---|
| `0` | Documento/capítulo bíblico específico | `DocumentId` (publicação) OU `BookNumber`+`ChapterNumber`+`KeySymbol` (Bíblia) |
| `1` | Publicação inteira (referência genérica, sem capítulo/parágrafo específico) | só `KeySymbol` (+ `IssueTagNumber` se for revista) |
| `2` | Mídia (áudio/vídeo) | `Track`, sem `BookNumber`/`ChapterNumber` |
| `3` | Mídia (áudio/vídeo), variante | `Track`, sem `BookNumber`/`ChapterNumber` |

**Regra prática pra resolver uma nota:**

- Se `Location.BookNumber IS NOT NULL` → é nota bíblica. Use `BookNumber` + `ChapterNumber` + `Note.BlockIdentifier` (verso) para bater com o `id` oficial (`BibleVerseId`) do seu banco `NWT_corrected.sqlite` — `BookNumber` aqui é o mesmo 1-66 que `book_order`.
- Se `Location.DocumentId IS NOT NULL` → é nota de publicação. **`DocumentId` = `MepsDocumentId`**, não o `DocumentId` sequencial interno que seu parser de `.jwpub` usa. Resolva assim:
  ```sql
  -- no banco interno do .jwpub já parseado por você:
  SELECT DocumentId FROM Document WHERE MepsDocumentId = :location_documentid;
  -- aí use esse DocumentId junto com Note.BlockIdentifier (= número de parágrafo)
  -- pra localizar o parágrafo certo via DocumentParagraph.ParagraphIndex/ParagraphNumberLabel
  ```
  Se você não tiver a publicação exata baixada/parseada (símbolo + `MepsLanguage` + `IssueTagNumber`/`Edition` batendo), ainda dá pra mostrar a nota "solta" (título + conteúdo) sem o trecho de contexto.

### `UserMark` — marcações de texto (highlights)

```sql
CREATE TABLE UserMark(
  UserMarkId      INTEGER PRIMARY KEY,
  ColorIndex      INTEGER NOT NULL,
  LocationId      INTEGER NOT NULL,   -- FK Location
  StyleIndex      INTEGER NOT NULL,
  UserMarkGuid    TEXT NOT NULL UNIQUE,
  Version         INTEGER NOT NULL,
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId)
)
```

- `ColorIndex` (cores padrão do JW Library): `1`=amarelo, `2`=verde, `3`=azul, `4`=vermelho/rosa, `5`=laranja, `6`=roxo (aproximado — a UI pode variar levemente a tonalidade exata por tema).
- `StyleIndex`: `0`=destaque sólido, `1`=sublinhado (só vi `0` neste backup, mas `1` existe no formato).
- `Version` incrementa a cada edição da marcação — ao editar, incremente.
- `UserMarkGuid` obrigatório e único, gere UUID v4 ao criar.

### `BlockRange` — o trecho exato dentro do parágrafo/verso marcado

```sql
CREATE TABLE BlockRange(
  BlockRangeId    INTEGER PRIMARY KEY,
  BlockType       INTEGER NOT NULL,   -- 1=parágrafo de publicação, 2=verso bíblico (mesma convenção do Note)
  Identifier      INTEGER NOT NULL,   -- número do parágrafo ou verso
  StartToken      INTEGER,            -- posição inicial (em "palavras"/tokens) dentro do bloco
  EndToken        INTEGER,            -- posição final
  UserMarkId      INTEGER NOT NULL,   -- FK UserMark
  CHECK(BlockType BETWEEN 1 AND 2)
)
```

- Uma `UserMark` pode ter **várias** `BlockRange` (texto destacado em trechos não-contíguos do mesmo parágrafo/verso).
- `StartToken`/`EndToken` contam **palavras**, não caracteres — é a posição da palavra inicial e final do trecho destacado dentro do texto renderizado daquele parágrafo/verso. Se seu parser de `.jwpub` já tokeniza o texto em palavras (você mencionou a tabela `Word` do formato), esses índices se alinham com essa tokenização.

### `Tag` e `TagMap` — categorias/etiquetas

```sql
CREATE TABLE Tag(
  TagId   INTEGER PRIMARY KEY,
  Type    INTEGER NOT NULL,   -- 0 = "Favorite" (especial), 1 = tag comum criada pelo usuário
  Name    TEXT
)

CREATE TABLE TagMap(
  TagMapId          INTEGER PRIMARY KEY,
  PlaylistItemId    INTEGER,  -- FK PlaylistItem
  LocationId        INTEGER,  -- FK Location
  NoteId            INTEGER,  -- FK Note
  TagId             INTEGER NOT NULL,   -- FK Tag
  Position          INTEGER NOT NULL,   -- ordem de exibição dentro da tag
  UNIQUE(TagId, Position),
  UNIQUE(TagId, NoteId),
  UNIQUE(TagId, LocationId),
  CHECK( -- exatamente UM dos três é preenchido por linha
    (NoteId IS NULL AND LocationId IS NULL AND PlaylistItemId IS NOT NULL) OR
    (LocationId IS NULL AND PlaylistItemId IS NULL AND NoteId IS NOT NULL) OR
    (PlaylistItemId IS NULL AND NoteId IS NULL AND LocationId IS NOT NULL)
  )
)
```

Uma linha de `TagMap` vincula a tag a **exatamente um** de: uma nota (`NoteId`), um local sem nota (`LocationId` — ex. um capítulo marcado como favorito sem ter nota), ou um item de playlist (`PlaylistItemId`). Nunca mais de um preenchido.

### `Bookmark` — favoritos (o ícone de marcador de página)

```sql
CREATE TABLE Bookmark(
  BookmarkId              INTEGER PRIMARY KEY,
  LocationId              INTEGER NOT NULL,   -- onde o favorito aponta
  PublicationLocationId   INTEGER NOT NULL,   -- a publicação/capítulo "pai" (pra agrupar os slots)
  Slot                    INTEGER NOT NULL,   -- posição do favorito (0, 1, 2...) dentro dessa publicação
  Title                   TEXT NOT NULL,
  Snippet                 TEXT,
  BlockType               INTEGER NOT NULL DEFAULT 0,
  BlockIdentifier         INTEGER,
  UNIQUE(PublicationLocationId, Slot),
  CHECK((BlockType = 0 AND BlockIdentifier IS NULL)
     OR (BlockType BETWEEN 1 AND 2 AND BlockIdentifier IS NOT NULL))
)
```

Mesma convenção de `BlockType`/`BlockIdentifier` do `Note`.

### `InputField` — respostas preenchidas em campos de estudo (apostilas com espaços em branco)

```sql
CREATE TABLE InputField(
  LocationId   INTEGER NOT NULL,   -- FK Location (aponta pro documento)
  TextTag      TEXT NOT NULL,      -- identificador do campo dentro do HTML do documento
  Value        TEXT NOT NULL       -- o que o usuário digitou
)
```

### `LastModified` — controle de sincronização global

```sql
CREATE TABLE LastModified(LastModified TEXT)  -- 1 única linha
```

Timestamp global do backup inteiro. **Ao gravar qualquer mudança**, atualize essa linha pro timestamp atual (`UPDATE LastModified SET LastModified = strftime('%Y-%m-%dT%H:%M:%SZ','now')`), senão o JW Library pode não reconhecer o backup como mais recente ao reimportar/sincronizar.

### Tabelas de playlist/mídia (vazias neste backup, mas fazem parte do schema)

`PlaylistItem`, `PlaylistItemAccuracy`, `PlaylistItemIndependentMediaMap`, `PlaylistItemLocationMap`, `PlaylistItemMarker`, `PlaylistItemMarkerBibleVerseMap`, `PlaylistItemMarkerParagraphMap`, `IndependentMedia` — usadas só se o usuário criar playlists de mídia dentro do app. Ignoráveis se seu projeto não mexe com isso; não precisa criar/alterar essas linhas pra notas/marcações funcionarem.

---

## Receitas práticas

### Ler todas as notas com o texto do verso/parágrafo já resolvido

```sql
-- Notas bíblicas
SELECT n.NoteId, n.Guid, n.Title, n.Content, n.Created, n.LastModified,
       l.BookNumber, l.ChapterNumber, n.BlockIdentifier AS verse
FROM Note n
JOIN Location l ON n.LocationId = l.LocationId
WHERE n.BlockType = 2 AND l.BookNumber IS NOT NULL;
```
Depois, para cada linha, resolva o texto:
```sql
SELECT text FROM verses WHERE book_order = :BookNumber AND chapter = :ChapterNumber AND verse = :verse;
```

```sql
-- Notas em publicações
SELECT n.NoteId, n.Guid, n.Title, n.Content, n.Created, n.LastModified,
       l.DocumentId AS meps_document_id, l.KeySymbol, n.BlockIdentifier AS paragraph
FROM Note n
JOIN Location l ON n.LocationId = l.LocationId
WHERE n.BlockType = 1;
```

### Criar uma nota nova em um verso bíblico

```sql
-- 1. Garanta que existe um Location pra esse capítulo (reaproveite se já existir, por causa do UNIQUE)
INSERT OR IGNORE INTO Location (BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type)
VALUES (:book, :chapter, 'nwtsty', :meps_lang, 0);

-- 2. Insira a nota
INSERT INTO Note (Guid, LocationId, Title, Content, LastModified, Created, BlockType, BlockIdentifier)
VALUES (:novo_uuid, :location_id, :titulo, :conteudo,
        strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'),
        2, :numero_do_verso);

-- 3. Atualize o controle global
UPDATE LastModified SET LastModified = strftime('%Y-%m-%dT%H:%M:%SZ','now');
```

### Editar uma nota existente

```sql
UPDATE Note
SET Title = :novo_titulo, Content = :novo_conteudo,
    LastModified = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NoteId = :note_id;

UPDATE LastModified SET LastModified = strftime('%Y-%m-%dT%H:%M:%SZ','now');
```

---

## Empacotando pra reimportar no JW Library

1. Faça `PRAGMA wal_checkpoint(FULL)` no banco (se estiver usando modo WAL) e feche a conexão.
2. Calcule `sha256` do arquivo `userData.db` final.
3. Gere o `manifest.json`:
   ```json
   {
     "name": "SeuBackup.jwlibrary",
     "creationDate": "AAAA-MM-DD",
     "version": 1,
     "type": 0,
     "userDataBackup": {
       "lastModifiedDate": "AAAA-MM-DDTHH:MM:SSZ",
       "deviceName": "SeuApp",
       "databaseName": "userData.db",
       "hash": "<sha256 calculado no passo 2>",
       "schemaVersion": 16
     }
   }
   ```
4. Zipe `manifest.json` + `userData.db` (thumbnail é opcional) na raiz do zip (sem pasta pai), e renomeie pra `.jwlibrary`.
5. Importe pelo app JW Library (Configurações → Backup/Restauração → Importar).

**Cuidados que quebram a reimportação:**
- `Guid`/`UserMarkGuid` duplicados (têm `UNIQUE`) — sempre gere UUID novo ao criar.
- Violar os `CHECK` constraints do `Location` (ex. `Type=0` sem `DocumentId` nem `BookNumber`+`KeySymbol`) — o app pode rejeitar o import ou o SQLite recusa o insert.
- Hash do manifest não bater com o arquivo `userData.db` real dentro do zip.
- `schemaVersion` desatualizado em relação à versão instalada do app (o app pode migrar ou rejeitar).
