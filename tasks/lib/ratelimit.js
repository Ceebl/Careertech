// A blunt per-address request limit.
//
// Not a defence against a determined attacker -- that is what the login
// throttling in auth.js is for. This is here so a runaway script or a bored
// scanner cannot keep the box busy.

export function rateLimit({ windowMs = 60_000, max = 300 } = {}) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
  }, windowMs);
  sweep.unref();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let entry = hits.get(ip);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: 'too many requests' });
    }
    return next();
  };
}
