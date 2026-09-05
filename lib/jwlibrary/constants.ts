/**
 * Display-only fallback data for imported .jwlibrary content — used when a
 * note/highlight's KeySymbol doesn't resolve to an already-imported .jwpub
 * (see lib/jwlibrary/resolve.ts), so the UI can still show a readable
 * publication name instead of a bare symbol like "w" or "mwb".
 *
 * Titles cross-checked against jw.org/wol.jw.org where a page could be found
 * (A Sentinela, Despertai!, Estudo Perspicaz, Tradução do Novo Mundo,
 * Apostila da Reunião Vida e Ministério, Organizados para Fazer a Vontade de
 * Jeová, Seja Feliz Para Sempre!, Jesus — O Caminho a Verdade a Vida,
 * "Dando Testemunho Cabal..."). The rarer/older symbols (brochures,
 * songbooks, s-34/s-140 talk-outline codes, ijw* web-article categories)
 * are translated from well-established usage rather than an individually
 * verified page — safe to correct here if one reads off.
 */

export const PUBLICATION_SYMBOLS: Record<string, { title: string; shortTitle: string }> = {
  w: { title: "A Sentinela", shortTitle: "A Sentinela" },
  wp: { title: "A Sentinela — Anunciando o Reino de Jeová", shortTitle: "A Sentinela (Pública)" },
  ws: { title: "A Sentinela (Vocabulário Simplificado)", shortTitle: "A Sentinela (Simples)" },
  g: { title: "Despertai!", shortTitle: "Despertai!" },
  mwb: { title: "Nossa Vida e Ministério Cristão — Apostila da Reunião", shortTitle: "Apostila da Reunião" },
  km: { title: "Nosso Ministério do Reino", shortTitle: "Ministério do Reino" },
  nwt: { title: "Tradução do Novo Mundo da Bíblia Sagrada", shortTitle: "Tradução do Novo Mundo" },
  nwtsty: {
    title: "Tradução do Novo Mundo da Bíblia Sagrada (Edição de Estudo)",
    shortTitle: "Bíblia de Estudo",
  },
  bi12: { title: "Tradução do Novo Mundo das Escrituras Sagradas (Edição de 1984)", shortTitle: "TNM 1984" },
  rbi8: { title: "Tradução do Novo Mundo com Referências", shortTitle: "TNM com Referências" },
  int: { title: "Tradução Interlinear do Reino das Escrituras Gregas", shortTitle: "Interlinear do Reino" },
  lff: { title: "Seja Feliz Para Sempre! — Um Curso da Bíblia Para Você", shortTitle: "Seja Feliz Para Sempre!" },
  lffi: { title: "Seja Feliz Para Sempre! — Lições Bíblicas Introdutórias", shortTitle: "Seja Feliz (Introdução)" },
  bt: { title: "Dando Testemunho Cabal Sobre o Reino de Deus", shortTitle: "Testemunho Cabal" },
  rr: { title: "Adoração Pura de Jeová — Finalmente Restaurada!", shortTitle: "Adoração Pura" },
  th: { title: "Tire Proveito da Leitura e do Ensino", shortTitle: "Leitura e Ensino" },
  it: { title: "Estudo Perspicaz das Escrituras", shortTitle: "Estudo Perspicaz" },
  "it-1": { title: "Estudo Perspicaz das Escrituras — Volume 1", shortTitle: "Estudo Perspicaz Vol. 1" },
  "it-2": { title: "Estudo Perspicaz das Escrituras — Volume 2", shortTitle: "Estudo Perspicaz Vol. 2" },
  cl: { title: "Aproxime-se de Jeová", shortTitle: "Aproxime-se de Jeová" },
  jr: { title: "Jeremias — A Palavra de Deus Para Nós", shortTitle: "Jeremias" },
  ia: { title: "Imitar a Fé Deles", shortTitle: "Imitar a Fé Deles" },
  jy: { title: "Jesus — O Caminho, a Verdade, a Vida", shortTitle: "Jesus — O Caminho" },
  bhs: { title: "O Que a Bíblia Nos Ensina?", shortTitle: "A Bíblia Nos Ensina" },
  bh: { title: "O Que a Bíblia Realmente Ensina?", shortTitle: "A Bíblia Ensina" },
  od: { title: "Organizados Para Fazer a Vontade de Jeová", shortTitle: "Organizados" },
  sjj: { title: "Cantem Alegres a Jeová", shortTitle: "Cantem Alegres" },
  sn: { title: "Cantem Louvores a Jeová", shortTitle: "Cantem Louvores" },
  sb: { title: "Cante de Coração a Jeová", shortTitle: "Cante de Coração" },
  es: { title: "Examine as Escrituras Diariamente", shortTitle: "Examine as Escrituras" },
  scl: { title: "Escrituras Para a Vida Cristã", shortTitle: "Escrituras Para a Vida" },
  kr: { title: "O Reino de Deus Já Governa!", shortTitle: "O Reino Já Governa" },
  cf: { title: "'Seja Meu Seguidor'", shortTitle: "Seja Meu Seguidor" },
  yc: { title: "Sua Família Pode Ser Feliz", shortTitle: "Família Feliz" },
  fg: { title: "Boas Novas Da Parte de Deus!", shortTitle: "Boas Novas de Deus" },
  ll: { title: "Ouça a Deus e Viva Para Sempre", shortTitle: "Ouça a Deus" },
  ld: { title: "Ouça a Deus", shortTitle: "Ouça a Deus" },
  rj: { title: "Volte Para Jeová", shortTitle: "Volte Para Jeová" },
  hf: { title: "Sua Família Pode Ser Feliz", shortTitle: "Família Feliz" },
  jl: { title: "Quem Está Fazendo a Vontade de Jeová Hoje?", shortTitle: "Vontade de Jeová Hoje" },
  lf: { title: "A Vida Foi Criada?", shortTitle: "A Vida Foi Criada?" },
  lc: { title: "A Origem da Vida — Cinco Perguntas Que Vale a Pena Fazer", shortTitle: "Origem da Vida" },
  gl: { title: "'Veja a Boa Terra'", shortTitle: "Veja a Boa Terra" },
  bm: { title: "A Bíblia. Qual É a Mensagem Dela?", shortTitle: "A Mensagem da Bíblia" },
  ypq: {
    title: "10 Perguntas Que os Jovens Fazem — Respostas Que Funcionam",
    shortTitle: "10 Perguntas dos Jovens",
  },
  yp1: { title: "Perguntas Que os Jovens Fazem — Respostas Práticas, Volume 1", shortTitle: "Jovens Perguntam Vol. 1" },
  yp2: { title: "Perguntas Que os Jovens Fazem — Respostas Práticas, Volume 2", shortTitle: "Jovens Perguntam Vol. 2" },
  fy: { title: "O Segredo da Felicidade Familiar", shortTitle: "Felicidade Familiar" },
  ct: { title: "Existe um Criador Que Se Importa com Você?", shortTitle: "Existe um Criador?" },
  kl: { title: "Conhecimento Que Leva à Vida Eterna", shortTitle: "Conhecimento Que Leva à Vida" },
  pe: { title: "Você Pode Viver Para Sempre no Paraíso na Terra", shortTitle: "Viver Para Sempre no Paraíso" },
  dx: { title: "Índice de Publicações da Torre de Vigia", shortTitle: "Índice de Publicações" },
  yb: { title: "Anuário das Testemunhas de Jeová", shortTitle: "Anuário" },
  "s-34": { title: "Esboço de Discurso Público", shortTitle: "Esboço de Discurso" },
  "s-140": { title: "Instruções da Reunião Vida e Ministério", shortTitle: "Instruções da Reunião" },
  mrt: { title: "Tópicos de Pesquisa Para Reuniões", shortTitle: "Tópicos de Pesquisa" },
  thp: { title: "Folha de Progresso — Leitura e Ensino", shortTitle: "Folha de Progresso" },
  ijw: { title: "Artigos do JW.ORG", shortTitle: "Artigos JW.ORG" },
  ijwfq: { title: "Perguntas Frequentes (JW.ORG)", shortTitle: "Perguntas Frequentes" },
  ijwyp: { title: "Os Jovens Perguntam (JW.ORG)", shortTitle: "Jovens Perguntam (Web)" },
  ijwbq: { title: "Perguntas Bíblicas Respondidas (JW.ORG)", shortTitle: "Perguntas Bíblicas" },
  ijwia: { title: "Imitar a Fé Deles (Artigos Web)", shortTitle: "Imitar a Fé (Web)" },
};

export function getPublicationFallbackTitle(symbol: string | null | undefined): string {
  if (!symbol || !symbol.trim()) return "Nota geral";
  const clean = symbol.trim().toLowerCase();

  if (PUBLICATION_SYMBOLS[clean]) return PUBLICATION_SYMBOLS[clean].shortTitle;
  if (/^w\d+/i.test(clean)) return `A Sentinela (${symbol})`;
  if (/^g\d+/i.test(clean)) return `Despertai! (${symbol})`;
  if (/^mwb\d+/i.test(clean)) return `Apostila (${symbol})`;
  if (/^yb\d+/i.test(clean)) return `Anuário (${symbol})`;

  return symbol.toUpperCase();
}

/** First `n` words of a label — used to keep a publication filter chip short on desktop without falling back to the bare symbol. */
export function firstWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/);
  return words.slice(0, n).join(" ");
}

/** JW Library's fixed 6-color highlight palette (UserMark.ColorIndex, 1-6). */
export const JWLIBRARY_HIGHLIGHT_COLORS: Record<number, { name: string; hex: string }> = {
  1: { name: "Amarelo", hex: "#e8c547" },
  2: { name: "Verde", hex: "#7cb87a" },
  3: { name: "Azul", hex: "#6fa8dc" },
  4: { name: "Rosa", hex: "#e08fa8" },
  5: { name: "Laranja", hex: "#e0975a" },
  6: { name: "Roxo", hex: "#a888c9" },
};
