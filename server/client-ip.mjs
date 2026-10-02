import {isIP} from 'node:net';

export function clientIp(req, trustProxy = false) {
  const remote = req.socket.remoteAddress || 'unknown';
  if (!trustProxy || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return remote;
  // Cloudflare supplies this header; only accept it from our loopback proxy.
  for (const name of ['cf-connecting-ip', 'x-real-ip']) {
    const value = req.headers[name];
    if (typeof value === 'string' && isIP(value.trim())) return value.trim();
  }
  return remote;
}
