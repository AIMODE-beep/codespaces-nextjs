export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Method not allowed.' })
  }
  const latitude = Number(request.query.lat)
  const longitude = Number(request.query.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return response.status(400).json({ error: 'Choose a valid location on Earth.' })
  }
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(latitude))
    url.searchParams.set('longitude', String(longitude))
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m')
    url.searchParams.set('hourly', 'temperature_2m,apparent_temperature,precipitation_probability,weather_code')
    url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max')
    url.searchParams.set('temperature_unit', 'celsius')
    url.searchParams.set('wind_speed_unit', 'kmh')
    url.searchParams.set('timezone', 'auto')
    url.searchParams.set('forecast_days', '7')
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!upstream.ok) throw new Error(`Weather service returned HTTP ${upstream.status}.`)
    const data = await upstream.json()
    if (!data?.current || !data?.hourly || !data?.daily) throw new Error('The weather service returned incomplete data.')
    return response.status(200).json({ ...data, latitude, longitude })
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : 'Could not load weather data.' })
  }
}