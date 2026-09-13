-- Corrige pt_simple_unaccent (criada em 0033): a config tinha SÓ o
-- dicionário `unaccent` no mapeamento de word/hword/hword_part, sem nada
-- depois dele.
--
-- `unaccent` é um dicionário "filtro" — ele troca "ríspido" por "rispido" e
-- passa adiante para o PRÓXIMO dicionário da lista decidir se isso vira um
-- léxico de verdade. pt_unaccent (a config original, migração 0025) sempre
-- teve dois dicionários encadeados (`unaccent, portuguese_stem`) por causa
-- disso. pt_simple_unaccent tinha só um, e sem um dicionário depois dele
-- para "fechar" o token, ele nunca virava léxico nenhum — verificado direto
-- no banco: to_tsvector('public.pt_simple_unaccent', 'ríspido') devolvia
-- vetor VAZIO (palavras 100% ASCII como "casa" continuavam funcionando,
-- porque essas caem no tipo de token "asciiword", mapeado só para `simple`,
-- sem passar pelo unaccent). Ou seja: a busca exata funcionava para
-- qualquer palavra sem acento e falhava silenciosamente para qualquer
-- palavra acentuada — o pior caso possível, já que a maior parte do
-- português tem acento.
alter text search configuration public.pt_simple_unaccent
  alter mapping for hword, hword_part, word
  with extensions.unaccent, simple;

-- A configuração corrigida só vale para o que for calculado DAQUI PRA
-- FRENTE — os valores já gravados em search_vector_exact (0033) foram
-- calculados com o mapeamento quebrado e não se corrigem sozinhos só porque
-- a config mudou. Recriar a coluna força o Postgres a recalcular para toda
-- a tabela agora.
alter table public.bible_verses drop column search_vector_exact;
alter table public.bible_verses
  add column search_vector_exact tsvector
  generated always as (to_tsvector('public.pt_simple_unaccent', coalesce(text, ''))) stored;
create index bible_verses_search_exact_idx on public.bible_verses using gin (search_vector_exact);

alter table public.global_videos drop column search_vector_exact;
alter table public.global_videos
  add column search_vector_exact tsvector
  generated always as (
    setweight(to_tsvector('public.pt_simple_unaccent', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('public.pt_simple_unaccent', coalesce(content_text, '')), 'D')
  ) stored;
create index global_videos_search_exact_idx on public.global_videos using gin (search_vector_exact);
