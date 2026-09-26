import { networkInterfaces } from "node:os";

export const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
export const PORT = Number(process.env.PORT ?? 5173);

function detectLanIp(): string {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (String(net.family) === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// QR에 인쇄될 공개 주소. 미설정 시 LAN IP 자동 감지.
export const BASE_URL =
  process.env.BASE_URL ?? `http://${detectLanIp()}:${PORT}`;
