import { enforceRateLimit } from '../../lib/request-limit'
import { fetchPublicWebPage } from '../../lib/web-page'

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  if (!await enforceRateLimit(request, response, {
    limit: 10,
    window: '1 m',
    prefix: 'nova:web',
  })) return

  const url = request.body?.url
  if (typeof url !== 'string' || !url.trim()) {
    return response.status(400).json({ error: 'Enter a webpage URL.' })
  }
  if (url.length > 2048) {
    return response.status(413).json({ error: 'The webpage URL is too long.' })
  }

  try {
    const page = await fetchPublicWebPage(url)
    if (!page.text) return response.status(422).json({ error: 'No readable text was found on this webpage.' })
    return response.status(200).json(page)
  } catch (error) {
    return response.status(422).json({ error: error instanceof Error ? error.message : 'Could not read this webpage.' })
  }
}

export const config = { maxDuration: 30 }
