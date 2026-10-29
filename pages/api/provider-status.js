export default function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  const pollinationsKey = Boolean(process.env.POLLINATIONS_API_KEY)
  return response.status(200).json({
    image: { configured: true, name: 'Pollinations images' },
    video: { configured: pollinationsKey, name: 'Pollinations video' },
    music: { configured: pollinationsKey, name: 'Pollinations music' },
    threeD: { configured: Boolean(process.env.THREE_D_GENERATION_URL), name: '3D provider' },
  })
}
