/**
 * The 2026 Guia de Pesquisa's A–Z subject index ("Abel" … "Zorobabel") is
 * the archive's Class 3 documents in section 1 — verified against the real
 * `rsg_T.jwpub` of 02/10/2026 (1.164 of them). Section 2 holds the 66
 * Bible-book pages, and Class 11 is the introduction.
 */
export function isResearchGuideTopic(chapter: { sectionNumber: number | null; docClass: number | null }) {
  return chapter.sectionNumber === 1 && chapter.docClass === 3;
}

export function isResearchGuideIntroduction(chapter: { docClass: number | null }) {
  return chapter.docClass === 11;
}
