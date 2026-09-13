// ice.ts — ICE configuration for WebRTC (STUN/TURN).
// By default — a public STUN (host candidates + STUN is enough for most
// home networks). For a symmetric NAT, set TURN via env:
//   VITE_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},
//                      {"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'
export function getIceServers(): RTCIceServer[] {
  const raw = (import.meta as any)?.env?.VITE_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // not JSON — allow a comma-separated url list
      const urls = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
      if (urls.length) return urls.map((urls) => ({ urls }));
    }
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

export default getIceServers;
