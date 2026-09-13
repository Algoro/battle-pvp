// chat.ts — chat use cases (application layer). No I/O and no transport:
// the rules live in the domain ChatManager, while delivery/broadcast is done by the adapter (signaling).
import type { ChatManager, ChatSendInput } from "../domain/chat.ts";
import type { ChatMessage } from "../ports.ts";

export interface SendChatInput extends ChatSendInput {
  scope: string;
  id?: string | null;
}

export type SendChatResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

/**
 * Send a message to a channel. Returns a DTO or a domain error.
 */
export function sendChat(chat: ChatManager, input: SendChatInput): SendChatResult {
  const { scope, id = null, ...rest } = input;
  const res = chat.send(scope, id, rest);
  if ("error" in res) return { ok: false, error: `chat-${res.error}` };
  return { ok: true, message: res.message };
}

/** Channel history (in memory + the ChatRepository port), chronologically. */
export function chatHistory(
  chat: ChatManager,
  scope: string,
  id: string | null,
): ChatMessage[] {
  return chat.getHistory(scope, id);
}

export default { sendChat, chatHistory };
