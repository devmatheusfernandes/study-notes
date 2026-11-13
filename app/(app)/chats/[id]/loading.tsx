import { ChatsLoading } from "@/components/chat/chat-loading";

/**
 * Same component as the parent route's loading.tsx, on purpose: the chat's
 * skeleton and the list's used to be two different screens shown one after
 * the other for a single navigation (see ChatsLoading).
 */
export default function ChatConversationLoading() {
  return <ChatsLoading />;
}
