export function requestOrigin(req, fallback, trustProxy = false) {
  if (!trustProxy || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return fallback;
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'];
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:[\]-]+$/.test(host) || !['http', 'https'].includes(protocol)) return fallback;
  const parsed = new URL(`${protocol}://${host}`);
  return parsed.origin;
}
