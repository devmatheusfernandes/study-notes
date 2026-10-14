"use client";

import { BookOpen } from "lucide-react";
import { GlobalPublicationUploadCard } from "./global-publication-upload-card";

/**
 * Bump whenever the import pipeline changes — see
 * checkGlobalPublicationNeedsImport's own comment for why a source-hash-only
 * check would wrongly skip a reupload after a bug fix.
 *
 *   1 — initial import
 *   2 — stopped emitting `data-jwpub-extract`: nothing persisted a global
 *       publication's excerpts yet, so those citations led nowhere.
 *   3 — excerpts are persisted now (global_publication_extracts, migration
 *       0047), so citations open their excerpt in place again; also records
 *       each article's SectionNumber/Class.
 */
const INSIGHT_IMPORT_VERSION = 3;

/**
 * Perspicaz (Estudo Perspicaz das Escrituras, símbolo `it`), imported once
 * for every signed-in user. Fills the "known gap" in
 * publication-download-actions.ts: the combined archive is ~354MB, past the
 * per-download ceiling, so citations into it would otherwise only offer a
 * download that can't succeed. Read on the Bible page via its "Perspicaz"
 * button.
 */
export function InsightUploadCard() {
  return (
    <GlobalPublicationUploadCard
      symbol="it"
      importVersion={INSIGHT_IMPORT_VERSION}
      heading="Estudo Perspicaz"
      icon={<BookOpen className="size-4 text-accent" />}
      countLabel="artigos"
      description={
        <>
          Enciclopédia bíblica do jw.org (símbolo <code>it</code>), volumes 1 e 2 combinados (~350MB). Envie o{" "}
          <code>.jwpub</code> dela aqui — vale para todo mundo que usa o app, não só para você. Fica disponível no
          botão “Perspicaz” da Bíblia, e as citações do Guia de Pesquisa que apontam para ele abrem o conteúdo direto.
        </>
      }
      validate={(parsed) =>
        parsed.symbol.toLowerCase().startsWith("it")
          ? null
          : `Isso parece ser "${parsed.title || parsed.symbol}", não o Estudo Perspicaz.`
      }
    />
  );
}
