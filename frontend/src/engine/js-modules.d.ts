// js-modules.d.ts — типы для JS-модулей ядра/netcode, импортируемых из TS.
// JS-модули не типизированы; объявляем их как any, чтобы TS не требовал .d.ts.
declare module "*pvp.js";
declare module "*rollback/session.js";
declare module "*transport/relay.js";
declare module "*transport/webrtc.js";
declare module "*transport/multi.js";
declare module "*local.js";
