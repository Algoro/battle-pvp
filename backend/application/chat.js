// chat.js — use cases чата (application-слой). Без I/O и транспорта:
// правила живут в доменном ChatManager, а доставку/рассылку делает адаптер (signaling).

/**
 * Отправить сообщение в канал. Возвращает DTO либо доменную ошибку.
 * @returns {{ok:true, message:object}|{ok:false, error:string}}
 */
export function sendChat(chat, { scope, id = null, playerId, name, text, ts }) {
  const res = chat.send(scope, id, { playerId, name, text, ts });
  if (res.error) return { ok: false, error: `chat-${res.error}` };
  return { ok: true, message: res.message };
}

/** История канала (в памяти + порт ChatRepository), хронологически. */
export function chatHistory(chat, scope, id) {
  return chat.getHistory(scope, id);
}

export default { sendChat, chatHistory };
