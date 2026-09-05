-- Flags an assistant reply whose retrieved "Fontes" were shown to the user
-- but never confirmed to actually answer the question (the model hedged
-- with "a informação não foi encontrada" despite something scoring above
-- the similarity threshold) — see app/(app)/chats/[id]/stream/route.ts.
-- The chat UI uses this to label those sources as unconfirmed instead of
-- presenting them as if they were the answer.
alter table public.chat_messages add column uncertain_sources boolean not null default false;
