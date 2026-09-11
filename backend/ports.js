// ports.js — порты (интерфейсы) backend. Домен и application зависят только от них;
// конкретные реализации (SQLite, WebSocket) подаются адаптерами извне.
//
// Типы описаны через JSDoc (проект на JS) и служат контрактом для адаптеров и тестов.
// Реализации: persistence/store.js (matches/players), persistence/chat-repository.js.

// @typedef {object} ChatRepository
// @property {(message: {scope:string,id:string|null,from:string,name:string,text:string,ts:number})=>void} insert
// @property {(scope:string, id:string|null, limit:number)=>
//   Array<{scope:string,id:string|null,from:string,name:string,text:string,ts:number}>} list
//
// @typedef {object} MatchRepository
// @property {(matchId:string, players:Array<{playerId:string,team:string}>)=>void} ensureMatch
// @property {(matchId:string, winnerTeam:string|null)=>void} finishMatch
// @property {(limit?:number)=>Array<object>} [listMatches]
//
// @typedef {object} PlayerRepository
// @property {(playerId:string, name:string)=>void} upsertPlayer
//
// @typedef {object} Clock
// @property {()=>number} now
//
// Модуль намеренно не экспортирует runtime-код: это чистый контракт (только типы).

export {};
