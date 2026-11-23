import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const profilePath = path.join('/tmp', 'pixel-user-profiles.json')

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return request.socket?.remoteAddress || 'unknown'
}

function getProfileKey(request) {
  return crypto.createHash('sha256')
    .update(getClientIp(request))
    .digest('hex')
}

async function readProfiles() {
  try {
    return JSON.parse(await fs.readFile(profilePath, 'utf8')) || {}
  } catch {
    return {}
  }
}

async function writeProfiles(profiles) {
  await fs.writeFile(profilePath, JSON.stringify(profiles), { mode: 0o600 })
}

function validateDisplayName(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .replace(/[\s'-]+/g, ' ')
    .trim()
    .toLowerCase()

  if (normalized.length < 2) return 'Enter a name with at least 2 characters.'
  if (normalized.length > 50) return 'Your name must be 50 characters or fewer.'
  if (!/[a-z\u00c0-\u024f\u0400-\u04ff\u0600-\u06ff]/i.test(normalized)) {
    return 'Enter a real name using letters.'
  }

  const compact = normalized
    .replace(/[0]/g, 'o')
    .replace(/[1!]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z]/g, '')
  const blockedTerms = [
    'ass', 'bitch', 'bastard', 'cock', 'dick', 'fuck', 'shit', 'slut',
    'whore', 'porn', 'sex', 'nigger', 'nigga', 'fag', 'faggot',
    'cunt', 'rape', 'retard', 'nazi',
  ]
  const nameParts = normalized.split(/[^a-z]+/)
  const blocked = nameParts.some((part) =>
    blockedTerms.some((term) => term === 'ass' ? part === term : part.includes(term))
  ) || compact === 'ass'

  return blocked ? 'Please choose an appropriate name.' : ''
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  const key = getProfileKey(request)
  const profiles = await readProfiles()

  if (request.method === 'GET') {
    const name = typeof profiles[key]?.name === 'string' ? profiles[key].name.slice(0, 50) : ''
    return response.status(200).json({ name: validateDisplayName(name) ? '' : name })
  }

  const name = typeof request.body?.name === 'string'
    ? request.body.name.trim().replace(/\s+/g, ' ').slice(0, 50)
    : ''
  if (!name) return response.status(400).json({ error: 'Enter a name.' })
  const validationError = validateDisplayName(name)
  if (validationError) return response.status(400).json({ error: validationError })

  profiles[key] = { name, updatedAt: new Date().toISOString() }
  await writeProfiles(profiles)
  return response.status(200).json({ name })
}
