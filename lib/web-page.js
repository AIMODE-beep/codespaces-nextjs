import { lookup } from 'node:dns/promises'

const privateAddressPatterns = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^224\./,
  /^240\./,
  /^::1$/i,
  /^::$/,
  /^fc/i,
  /^fd/i,
  /^fe[89ab]/i,
]

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
}

function isPrivateAddress(address) {
  return privateAddressPatterns.some((pattern) => pattern.test(address)) || address === '[::1]'
}

export async function validatePublicUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a valid webpage URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS webpages are supported.')
  }
  if (url.username || url.password) {
    throw new Error('Webpage URLs cannot contain credentials.')
  }

  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Local and private webpages cannot be accessed.')
  }

  let addresses
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('The webpage host could not be resolved.')
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Local and private webpages cannot be accessed.')
  }

  return url
}

export function htmlToText(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : ''
  const cleaned = html
    .replace(/<(script|style|noscript|svg|canvas)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<(br|hr|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeHtmlEntities(cleaned).replace(/[\t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').replace(/\s+\n/g, '\n').trim()
  return { title, text }
}

export async function fetchPublicWebPage(inputUrl, { maxCharacters = 20_000 } = {}) {
  let currentUrl = await validatePublicUrl(inputUrl)

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const result = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'Nova-WebReader/1.0',
        Accept: 'text/html,text/plain;q=0.9,application/xhtml+xml;q=0.8,*/*;q=0.5',
      },
    })

    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.get('location')
      if (!location) throw new Error('The webpage returned a redirect without a destination.')
      currentUrl = await validatePublicUrl(new URL(location, currentUrl).toString())
      if (redirectCount === 5) throw new Error('The webpage redirected too many times.')
      continue
    }

    if (!result.ok) throw new Error(`The webpage returned HTTP ${result.status}.`)
    const contentType = result.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error('This URL does not return readable webpage text.')
    }

    const body = await result.text()
    if (contentType.includes('text/html')) {
      const page = htmlToText(body)
      return {
        url: currentUrl.toString(),
        title: page.title,
        text: page.text.slice(0, maxCharacters),
        truncated: page.text.length > maxCharacters,
      }
    }

    const text = body.replace(/\s+/g, ' ').trim()
    return { url: currentUrl.toString(), title: '', text: text.slice(0, maxCharacters), truncated: text.length > maxCharacters }
  }

  throw new Error('The webpage could not be loaded.')
}

export function extractWebUrls(text, limit = 3) {
  const matches = text.match(/https?:\/\/[^\s<>"')\]}]+/gi) || []
  const unique = [...new Set(matches.map((match) => match.replace(/[.,;!]+$/, '')))]
  return unique.slice(0, limit)
}
