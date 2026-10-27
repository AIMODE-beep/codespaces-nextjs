import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const localBuckets = new Map()
const rateLimiters = new Map()

function getClientIp(request) {
  const forwardedFor = request.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',').at(-1).trim()
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length) {
    return forwardedFor.at(-1).split(',').at(-1).trim()
  }
  return request.socket?.remoteAddress
}

function getRateLimiter({ limit, window, prefix }) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  const key = `${prefix}:${limit}:${window}`
  if (!rateLimiters.has(key)) {
    rateLimiters.set(key, new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix,
    }))
  }

  return rateLimiters.get(key)
}

function limitLocally(identifier, limit, windowMs) {
  const now = Date.now()
  const timestamps = (localBuckets.get(identifier) || []).filter(
    (timestamp) => now - timestamp < windowMs
  )

  if (timestamps.length >= limit) {
    localBuckets.set(identifier, timestamps)
    return {
      success: false,
      limit,
      remaining: 0,
      reset: timestamps[0] + windowMs,
    }
  }

  timestamps.push(now)
  localBuckets.set(identifier, timestamps)

  if (localBuckets.size > 1000) {
    for (const [key, values] of localBuckets) {
      if (values.every((timestamp) => now - timestamp >= windowMs)) {
        localBuckets.delete(key)
      }
    }
  }

  return {
    success: true,
    limit,
    remaining: limit - timestamps.length,
    reset: timestamps[0] + windowMs,
  }
}

export async function enforceRateLimit(request, response, {
  limit,
  window,
  prefix,
  identifier,
}) {
  const isProduction = process.env.NODE_ENV === 'production'
  let rateLimiter

  try {
    rateLimiter = getRateLimiter({ limit, window, prefix })
  } catch {
    response.status(503).json({
      error: 'This service is temporarily unavailable because rate limiting is not configured correctly.',
    })
    return false
  }

  if (!rateLimiter && isProduction) {
    response.status(503).json({
      error: 'This service is temporarily unavailable because rate limiting is not configured.',
    })
    return false
  }

  const key = identifier || getClientIp(request)
  if (!key) {
    response.status(503).json({ error: 'Could not identify the client for rate limiting.' })
    return false
  }

  let result
  try {
    result = rateLimiter
      ? await rateLimiter.limit(key)
      : limitLocally(`${prefix}:${key}`, limit, parseWindow(window))
  } catch {
    response.status(503).json({
      error: 'This service is temporarily unavailable because the rate-limit service could not be reached.',
    })
    return false
  }

  response.setHeader('X-RateLimit-Limit', String(result.limit))
  response.setHeader('X-RateLimit-Remaining', String(result.remaining))
  if (!result.success) {
    response.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))))
    response.status(429).json({
      error: 'Rate limit reached. Please try again shortly.',
    })
    return false
  }

  return true
}

function parseWindow(window) {
  const match = /^(\d+)\s+(ms|s|m|h|d)$/.exec(window)
  if (!match) throw new Error('Unsupported rate-limit window.')

  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return Number(match[1]) * units[match[2]]
}
