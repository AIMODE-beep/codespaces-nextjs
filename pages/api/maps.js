export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 200) : ''
  const limit = Math.max(1, Math.min(8, Number.parseInt(request.query.limit, 10) || 6))
  if (!query) return response.status(400).json({ error: 'Enter a place to search.' })

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', String(limit))
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Pixel-Assistant/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12_000),
    })
    if (!upstream.ok) throw new Error(`Map search returned HTTP ${upstream.status}.`)
    const results = await upstream.json()
    return response.status(200).json({ results: Array.isArray(results) ? results : [] })
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : 'Map search failed.' })
  }
}
