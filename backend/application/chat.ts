// chat.ts — use cases чата (application-слой). Без I/O и транспорта:
// правила живут в доменном ChatManager, а доставку/рассылку делает адаптер (signaling).
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
 * Отправить сообщение в канал. Возвращает DTO либо доменную ошибку.
 */
export function sendChat(chat: ChatManager, input: SendChatInput): SendChatResult {
  const { scope, id = null, ...rest } = input;
  const res = chat.send(scope, id, rest);
  if ("error" in res) return { ok: false, error: `chat-${res.error}` };
  return { ok: true, message: res.message };
}

/** История канала (в памяти + порт ChatRepository), хронологически. */
export function chatHistory(
  chat: ChatManager,
  scope: string,
  id: string | null,
): ChatMessage[] {
  return chat.getHistory(scope, id);
}

export default { sendChat, chatHistory };
