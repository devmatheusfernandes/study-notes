"use client";

import { BookMarked } from "lucide-react";
import { GlobalPublicationUploadCard } from "./global-publication-upload-card";
import type { JwpubChapter } from "@/lib/jwpub/types";
import { isResearchGuideIntroduction, isResearchGuideTopic } from "@/lib/bible/research-guide-topics";

/**
 *   1 — initial import (A–Z topics + introduction, with their cited excerpts)
 */
const RESEARCH_GUIDE_TOPICS_IMPORT_VERSION = 1;

/**
 * Keeps the A–Z topics and the introduction. The 66 Bible-book pages are left
 * out on purpose: verse citations still come from the older edition's import
 * (bible_research_guide), and those pages' excerpts alone would add roughly
 * another 60 MB to the database for content the Guia tab already has.
 */
function keepChapter(chapter: JwpubChapter) {
  return isResearchGuideTopic(chapter) || isResearchGuideIntroduction(chapter);
}

export function ResearchGuideTopicsUploadCard() {
  return (
    <GlobalPublicationUploadCard
      symbol="rsg"
      importVersion={RESEARCH_GUIDE_TOPICS_IMPORT_VERSION}
      heading="Guia de Pesquisa (2026)"
      icon={<BookMarked className="size-4 text-accent" />}
      countLabel="assuntos"
      description={
        <>
          Edição de 2026 do Guia de Pesquisa (símbolo <code>rsg</code>), com o índice de assuntos de A a Z. Fica no
          botão “Guia de Pesquisa” da Bíblia e vale para todo mundo que usa o app. Não substitui o cartão acima: as
          citações por versículo da aba “Guia” continuam vindo da edição anterior.
        </>
      }
      validate={(parsed) => {
        if (!parsed.symbol.toLowerCase().startsWith("rsg")) {
          return `Isso parece ser "${parsed.title || parsed.symbol}", não o Guia de Pesquisa.`;
        }
        if (!parsed.chapters.some(isResearchGuideTopic)) {
          return "Este arquivo não tem o índice de assuntos de A a Z — envie a edição de 2026 ou mais recente.";
        }
        return null;
      }}
      includeChapter={keepChapter}
    />
  );
}
