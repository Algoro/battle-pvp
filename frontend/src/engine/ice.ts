// ice.ts — конфигурация ICE для WebRTC (STUN/TURN).
// По умолчанию — публичный STUN (host-кандидаты + STUN достаточно для большинства
// домашних сетей). Для симметричного NAT задайте TURN через env:
//   VITE_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},
//                      {"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'
// @ts-nocheck
export function getIceServers(): RTCIceServer[] {
  const raw = (import.meta as any)?.env?.VITE_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // не JSON — допускаем список url через запятую
      const urls = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
      if (urls.length) return urls.map((urls) => ({ urls }));
    }
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

export default getIceServers;
