import { decodeHtmlEntities } from './web-page.js'
import { validatePublicUrl } from './web-page.js'

function stripTags(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

export async function searchPublicWeb(query, { limit = 5 } = {}) {
  const url = new URL('https://www.bing.com/search')
  url.searchParams.set('q', query.slice(0, 500))
  url.searchParams.set('count', String(Math.max(limit, 1)))
  url.searchParams.set('setlang', 'en-US')

  await validatePublicUrl(url.toString())
  const result = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Pixel-WebSearch/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!result.ok) throw new Error(`Web search returned HTTP ${result.status}.`)

  const html = await result.text()
  const results = []
  const blocks = html.match(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi) || []
  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!link) continue
    let sourceUrl
    try {
      sourceUrl = new URL(decodeHtmlEntities(link[1])).toString()
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(new URL(sourceUrl).protocol)) continue
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<div[^>]+class="[^"]*\bb_caption\b[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
    results.push({
      url: sourceUrl,
      title: stripTags(link[2]),
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : '',
    })
    if (results.length >= limit) break
  }
  return results
}

export async function searchPublicImages(query, { limit = 3 } = {}) {
  const url = new URL('https://www.bing.com/images/search')
  url.searchParams.set('q', query.slice(0, 500))
  url.searchParams.set('form', 'HDRSC2')

  await validatePublicUrl(url.toString())
  const result = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Pixel-WebSearch/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!result.ok) throw new Error(`Image search returned HTTP ${result.status}.`)

  const html = await result.text()
  const images = []
  for (const match of html.matchAll(/m="([^"]+)"/gi)) {
    let metadata
    try {
      metadata = JSON.parse(decodeHtmlEntities(match[1]))
    } catch {
      continue
    }
    const imageUrl = metadata.murl || metadata.turl
    if (!imageUrl) continue
    let normalized
    try {
      normalized = new URL(imageUrl).toString()
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(new URL(normalized).protocol)) continue
    images.push({
      url: normalized,
      pageUrl: metadata.purl || '',
      title: stripTags(metadata.t || metadata.tn || ''),
    })
    if (images.length >= limit) break
  }
  return images
}
