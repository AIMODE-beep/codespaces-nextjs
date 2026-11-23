import { enforceRateLimit } from '../../lib/request-limit'

function createPromptArtwork(prompt, width, height, seedText) {
  let seed = 0
  for (const character of seedText) seed = (seed * 31 + character.charCodeAt(0)) >>> 0
  const hue = seed % 360
  const hueTwo = (hue + 72 + (seed % 100)) % 360
  const safePrompt = prompt
    .replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character])
    .slice(0, 96)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 68% 56%)"/><stop offset="1" stop-color="hsl(${hueTwo} 72% 38%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${Math.round(width * 0.76)}" cy="${Math.round(height * 0.24)}" r="${Math.round(width * 0.18)}" fill="white" opacity=".18"/><circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.78)}" r="${Math.round(width * 0.28)}" fill="hsl(${hueTwo} 80% 24%)" opacity=".28"/><path d="M0 ${Math.round(height * 0.68)} Q ${Math.round(width * 0.5)} ${Math.round(height * 0.48)} ${width} ${Math.round(height * 0.66)}V${height}H0Z" fill="white" opacity=".12"/><rect x="${Math.round(width * .08)}" y="${Math.round(height * .68)}" width="${Math.round(width * .84)}" height="${Math.round(height * .19)}" rx="${Math.round(width * .025)}" fill="#101827" opacity=".76"/><text x="${Math.round(width * .12)}" y="${Math.round(height * .78)}" fill="white" font-family="system-ui,sans-serif" font-size="${Math.max(18, Math.round(width * .025))}" font-weight="700">${safePrompt}</text></svg>`
}

function createDarkChartArtwork(prompt, width, height, accentColor) {
  const safePrompt = prompt
    .replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character])
    .slice(0, 100)
  const numbers = [...prompt.matchAll(/\b\d+(?:\.\d+)?\b/g)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .slice(0, 12)
  const sourceValues = numbers.length >= 2 ? numbers : [55, 72, 48, 86, 64, 78]
  const maxValue = Math.max(...sourceValues, 1)
  const bars = sourceValues.map((value) => value / maxValue)
  const left = Math.round(width * 0.12)
  const bottom = Math.round(height * 0.82)
  const chartHeight = Math.round(height * 0.58)
  const chartWidth = Math.round(width * 0.76)
  const barWidth = chartWidth / (bars.length * 1.5)
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = Math.round(height * 0.24 + index * chartHeight / 4)
    return `<line x1="${left}" y1="${y}" x2="${left + chartWidth}" y2="${y}" stroke="#8ea6bd" stroke-opacity=".18"/>`
  }).join('')
  const barMarkup = bars.map((value, index) => {
    const barHeight = Math.round(chartHeight * value)
    const x = Math.round(left + index * chartWidth / bars.length + (chartWidth / bars.length - barWidth) / 2)
    const y = bottom - barHeight
    const opacity = 0.58 + index * 0.07
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${Math.round(barWidth * .12)}" fill="${accentColor}" opacity="${opacity.toFixed(2)}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#070b14"/><rect x="${Math.round(width * .045)}" y="${Math.round(height * .07)}" width="${Math.round(width * .91)}" height="${Math.round(height * .86)}" rx="${Math.round(width * .018)}" fill="#09111e" stroke="${accentColor}" stroke-opacity=".32"/><text x="${left}" y="${Math.round(height * .17)}" fill="#ffffff" font-family="system-ui,sans-serif" font-size="${Math.max(18, Math.round(width * .022))}" font-weight="700">${safePrompt}</text>${grid}${barMarkup}<line x1="${left}" y1="${bottom}" x2="${left + chartWidth}" y2="${bottom}" stroke="#dcecff" stroke-opacity=".42"/></svg>`
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  const { prompt, style, ratio, quality, mode = 'image', accentColor = '#67d8ff' } = request.body || {}
  if (!['image', 'video', 'music', '3d'].includes(mode)) {
    return response.status(400).json({ error: 'Choose a supported generation mode.' })
  }

  if (mode !== 'music' && !await enforceRateLimit(request, response, {
    limit: 8,
    window: '1 m',
    prefix: 'nova:generate:image',
  })) return

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return response.status(400).json({ error: `Enter a prompt for ${mode === '3d' ? '3D' : mode} generation.` })
  }

  if (mode !== 'image') {
    const pollinationsKey = process.env.POLLINATIONS_API_KEY
    if ((mode === 'video' || mode === 'music') && pollinationsKey) {
      try {
        let mediaResponse
        if (mode === 'video') {
          const durationSeconds = Math.min(120, Math.max(1, Number.parseInt(request.body.duration, 10) || 6))
          const videoUrl = new URL(`https://gen.pollinations.ai/video/${encodeURIComponent(prompt.trim())}`)
          videoUrl.searchParams.set('model', process.env.POLLINATIONS_VIDEO_MODEL || 'google/veo-3.1-fast')
          videoUrl.searchParams.set('duration', String(durationSeconds))
          videoUrl.searchParams.set('aspectRatio', ratio || '16:9')
          videoUrl.searchParams.set('quality', quality === 'Ultra' ? 'hd' : quality === 'High' ? 'high' : 'medium')
          videoUrl.searchParams.set('audio', 'true')
          videoUrl.searchParams.set('safe', 'true')
          mediaResponse = await fetch(videoUrl, {
            headers: { Authorization: `Bearer ${pollinationsKey}` },
            signal: AbortSignal.timeout(240_000),
          })
        } else {
          mediaResponse = await fetch('https://gen.pollinations.ai/v1/audio/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pollinationsKey}` },
            body: JSON.stringify({
              model: process.env.POLLINATIONS_MUSIC_MODEL || 'elevenlabs/music-v2.5',
              input: `${prompt.trim()}, ${style || 'cinematic'} style, finished instrumental track`,
              voice: 'nova',
              response_format: 'mp3',
              duration: Math.min(Math.max(Number.parseFloat(request.body.duration) || 30, 1), 300),
              instrumental: true,
              negative_prompt: 'vocals, singing, spoken words, glitches, clipping',
              safe: 'true',
            }),
            signal: AbortSignal.timeout(240_000),
          })
        }
        if (!mediaResponse.ok) {
          if (mediaResponse.status === 401) {
            return response.status(402).json({
              error: mode === 'video'
                ? 'Pollinations video generation requires a paid, video-enabled API key. Add Pollen credit at enter.pollinations.ai and replace POLLINATIONS_API_KEY.'
                : 'Pollinations music generation requires a paid, music-enabled API key. Add Pollen credit at enter.pollinations.ai and replace POLLINATIONS_API_KEY.',
            })
          }
          throw new Error(`Pollinations ${mode} generation returned HTTP ${mediaResponse.status}.`)
        }
        const mediaType = mediaResponse.headers.get('content-type') || (mode === 'video' ? 'video/mp4' : 'audio/mpeg')
        response.setHeader('Content-Type', mediaType)
        response.setHeader('Cache-Control', 'no-store')
        return response.status(200).send(Buffer.from(await mediaResponse.arrayBuffer()))
      } catch (error) {
        return response.status(502).json({ error: error instanceof Error ? error.message : `${mode} generation failed.` })
      }
    }

    if ((mode === 'video' || mode === 'music') && !pollinationsKey) {
      return response.status(503).json({ error: `${mode === 'video' ? 'Video' : 'Music'} generation needs POLLINATIONS_API_KEY in the server environment.` })
    }

    const providerConfig = {
      '3d': { url: process.env.THREE_D_GENERATION_URL, key: process.env.THREE_D_GENERATION_API_KEY },
    }
    const provider = providerConfig[mode]
    if (!provider?.url) {
      return response.status(503).json({ error: 'Configure the 3D provider URL in the server environment.' })
    }

    try {
      const providerResponse = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}) },
        body: JSON.stringify({ prompt: prompt.trim(), style, ratio, quality, duration: request.body.duration }),
        signal: AbortSignal.timeout(240_000),
      })
      const responseContentType = providerResponse.headers.get('content-type') || ''
      if (!providerResponse.ok) {
        throw new Error(`Generation provider returned HTTP ${providerResponse.status}.`)
      }

      let assetResponse = providerResponse
      if (responseContentType.includes('application/json')) {
        const payload = await providerResponse.json()
        const assetUrl = payload.url || payload.output_url || payload.video_url || payload.audio_url || payload.model_url || payload.output?.[0]?.url
        if (!assetUrl || typeof assetUrl !== 'string') throw new Error('The provider did not return an asset URL.')
        assetResponse = await fetch(assetUrl, { signal: AbortSignal.timeout(240_000) })
        if (!assetResponse.ok) throw new Error('The generated asset could not be downloaded.')
      }

      const assetType = assetResponse.headers.get('content-type') || responseContentType
      if (assetType.includes('application/json') || assetType.startsWith('text/')) {
        throw new Error('The provider returned text instead of generated media.')
      }
      if (mode === 'music' && !assetType.startsWith('audio/') && assetType !== 'application/octet-stream') {
        throw new Error('The music provider did not return an audio file.')
      }
      response.setHeader('Content-Type', assetType || 'application/octet-stream')
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).send(Buffer.from(await assetResponse.arrayBuffer()))
    } catch (error) {
      return response.status(502).json({ error: error instanceof Error ? error.message : 'Media generation failed.' })
    }
  }

  const [widthRatio, heightRatio] = String(ratio || '1:1').split(':').map(Number)
  let width = 1024
  let height = 1024
  if (widthRatio && heightRatio) {
    const scale = widthRatio >= heightRatio
      ? width / widthRatio
      : height / heightRatio
    width = Math.max(256, Math.round(widthRatio * scale / 64) * 64)
    height = Math.max(256, Math.round(heightRatio * scale / 64) * 64)
    if (width > 1536) {
      width = 1536
      height = Math.round(height * 1536 / width)
    }
  }

  const normalizedAccent = /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : '#67d8ff'
  const isChartPrompt = /\b(chart|graph|plot|bar|line|pie|scatter|histogram)\b/i.test(prompt)
  const chartPrompt = isChartPrompt
    ? 'dark mode chart, near-black background, white labels and title, accent-colored data series, high contrast gridlines, crisp typography, no white background, no watermark'
    : ''
  if (isChartPrompt) {
    const artwork = createDarkChartArtwork(prompt.trim(), width, height, normalizedAccent)
    response.setHeader('Content-Type', 'image/svg+xml')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Pixel-Chart-Theme', `dark:${normalizedAccent}`)
    return response.status(200).send(artwork)
  }
  const enhancedPrompt = `${prompt.trim()}, ${chartPrompt ? chartPrompt : `${style || 'Cinematic'} style, high detail, finished composition`}, accent color ${normalizedAccent}, no text or watermark`
  const encodedPrompt = encodeURIComponent(enhancedPrompt)
  const key = process.env.POLLINATIONS_API_KEY
  const publicProviderUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=flux&nologo=true`
  const providerRequests = key
    ? [{
        url: `https://gen.pollinations.ai/image/${encodedPrompt}?width=${width}&height=${height}&model=${encodeURIComponent(process.env.POLLINATIONS_IMAGE_MODEL || 'black-forest-labs/flux.1-schnell')}&enhance=true&safe=true`,
        headers: { Authorization: `Bearer ${key}` },
      }, {
        url: publicProviderUrl,
        headers: {},
      }]
    : [{ url: publicProviderUrl, headers: {} }]

  let lastProviderError = ''
  for (const providerRequest of providerRequests) {
    try {
      const imageResponse = await fetch(providerRequest.url, {
        headers: providerRequest.headers,
        signal: AbortSignal.timeout(120_000),
      })
      const contentType = imageResponse.headers.get('content-type') || ''
      if (!imageResponse.ok) {
        lastProviderError = imageResponse.status === 402
          ? 'The Pollinations account has no remaining image credits. Pixel tried the no-key fallback too.'
          : `Image provider returned HTTP ${imageResponse.status}.`
        continue
      }
      if (!contentType.startsWith('image/')) {
        lastProviderError = 'The image provider returned an invalid response.'
        continue
      }

      response.setHeader('Content-Type', contentType)
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).send(Buffer.from(await imageResponse.arrayBuffer()))
    } catch (error) {
      lastProviderError = error instanceof Error ? error.message : 'Image provider request failed.'
    }
  }

  const artwork = isChartPrompt
    ? createDarkChartArtwork(prompt.trim(), width, height, normalizedAccent)
    : createPromptArtwork(prompt.trim(), width, height, `${prompt.trim()}:${style || ''}`)
  response.setHeader('Content-Type', 'image/svg+xml')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Pixel-Image-Fallback', 'prompt-artwork')
  return response.status(200).send(artwork)
}

export const config = { maxDuration: 130 }
