export default function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  return response.status(200).json({
    image: { configured: true, name: 'Pollinations images' },
    video: {
      configured: Boolean(process.env.VIDEO_GENERATION_URL),
      name: 'Pollinations video',
    },
    music: {
      configured: Boolean(process.env.MUSIC_GENERATION_URL),
      name: 'Pollinations music',
    },
    threeD: { configured: Boolean(process.env.THREE_D_GENERATION_URL), name: '3D provider' },
  })
}
