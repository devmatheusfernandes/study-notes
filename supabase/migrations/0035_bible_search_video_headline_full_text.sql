-- Corrige o "Início em 00:02" errado ao clicar num resultado de vídeo cuja
-- palavra buscada só aparece bem depois do começo da transcrição.
--
-- search_global_videos cortava o texto passado para ts_headline em
-- left(content_text, 12000) (migração 0025, por custo — medido então em
-- ~60ms com corte vs ~95ms sem, para 20 resultados). O problema: o WHERE
-- casa contra search_vector/search_vector_exact, que são gerados a partir do
-- content_text INTEIRO — então uma palavra que só aparece depois do caractere
-- 12.000 ainda faz a linha aparecer no resultado, só que o ts_headline (que
-- só recebe os primeiros 12.000 caracteres) não acha nada ali e cai no
-- comportamento padrão dele: devolve o começo do texto como se fosse o
-- trecho relevante.
--
-- Isso não é só um destaque errado — o snippet devolvido alimenta o
-- "Início em HH:MM" de InlineVideoCard (o texto plano é comparado contra a
-- legenda .vtt para achar o timestamp certo), então o vídeo abria pulando
-- direto pro segundo 2 (o começo real da transcrição) em vez do minuto onde
-- a palavra buscada é dita de verdade. Verificado com o caso relatado:
-- "Rispa" está no caractere 35.211 de uma transcrição de 44.262 — bem fora
-- da janela de 12.000 que o ts_headline via.
--
-- Removido o corte: ts_headline roda sobre a transcrição inteira. O custo
-- extra é só nas até 20 linhas de UMA página de resultado (o corte nunca
-- existiu para reduzir quantas linhas são processadas, só o tamanho de cada
-- uma) — a diferença medida em 0025 já era pequena (~35ms para a página
-- toda), e a alternativa (abrir um vídeo no minuto errado) é pior que esse
-- custo.
create or replace function public.search_global_videos(
  query_text text,
  max_results int default 20,
  result_offset int default 0
)
returns table (
  id text,
  title text,
  cover_image text,
  video_url text,
  subtitles_url text,
  duration_formatted text,
  first_published timestamptz,
  headline text,
  rank real
)
language plpgsql
stable
set search_path = public
as $$
declare
  tsq tsquery;
  trimmed_query text := trim(coalesce(query_text, ''));
begin
  if trimmed_query ~ '"' and trimmed_query !~ '[&|!]' then
    tsq := public.pt_exact_tsquery(trimmed_query);
    if tsq is null then
      return;
    end if;

    return query
    with hits as (
      select g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
             g.duration_formatted, g.first_published, g.content_text,
             ts_rank(g.search_vector_exact, tsq) as rank
      from public.global_videos g
      where g.search_vector_exact @@ tsq
      order by ts_rank(g.search_vector_exact, tsq) desc, g.first_published desc nulls last
      limit greatest(max_results, 0) offset greatest(result_offset, 0)
    )
    select h.id, h.title, h.cover_image, h.video_url, h.subtitles_url,
           h.duration_formatted, h.first_published,
           ts_headline(
             'public.pt_simple_unaccent',
             coalesce(h.content_text, ''), tsq,
             E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
           ),
           h.rank
    from hits h
    order by h.rank desc, h.first_published desc nulls last;
    return;
  end if;

  if trimmed_query ~ '[&|!]' then
    tsq := public.pt_advanced_tsquery(trimmed_query);
  else
    tsq := websearch_to_tsquery('public.pt_unaccent', trimmed_query);

    if tsq is null or not exists (
      select 1 from public.global_videos g where g.search_vector @@ tsq
    ) then
      tsq := public.pt_or_tsquery(trimmed_query);
    end if;
  end if;

  if tsq is null then
    return;
  end if;

  return query
  with hits as (
    select g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
           g.duration_formatted, g.first_published, g.content_text,
           ts_rank(g.search_vector, tsq) as rank
    from public.global_videos g
    where g.search_vector @@ tsq
    order by ts_rank(g.search_vector, tsq) desc, g.first_published desc nulls last
    limit greatest(max_results, 0) offset greatest(result_offset, 0)
  )
  select h.id, h.title, h.cover_image, h.video_url, h.subtitles_url,
         h.duration_formatted, h.first_published,
         ts_headline(
           'public.pt_unaccent',
           coalesce(h.content_text, ''), tsq,
           E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
         ),
         h.rank
  from hits h
  order by h.rank desc, h.first_published desc nulls last;
end;
$$;
