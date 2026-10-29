import { chromium } from 'playwright'
import { validatePublicUrl } from '../../lib/web-page'

const sessions = globalThis.__novaBrowserSessions || new Map()
globalThis.__novaBrowserSessions = sessions
const maxSessions = 20

async function getSession(id) {
  let session = sessions.get(id)
  if (!session) {
    if (sessions.size >= maxSessions) {
      const oldestId = sessions.keys().next().value
      await sessions.get(oldestId)?.browser.close()
      sessions.delete(oldestId)
    }
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      colorScheme: 'light',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
    const page = await context.newPage()
    session = { browser, context, page, url: 'about:blank', lastActive: Date.now(), history: [] }
    sessions.set(id, session)
  }
  session.lastActive = Date.now()
  return session
}

async function snapshot(session) {
  await session.page.waitForTimeout(80)
  const screenshot = await session.page.screenshot({ type: 'jpeg', quality: 82, fullPage: false })
  const viewport = session.page.viewportSize() || { width: 1280, height: 720 }
  return {
    screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
    url: session.page.url(),
    title: await session.page.title(),
    viewport,
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  const id = typeof request.cookies?.['nova-browser-id'] === 'string'
    ? request.cookies['nova-browser-id']
    : typeof request.body?.sessionId === 'string'
      ? request.body.sessionId
      : null
  const sessionId = id || 'default'

  if (request.method === 'DELETE') {
    const session = sessions.get(sessionId)
    if (session) await session.browser.close()
    sessions.delete(sessionId)
    return response.status(200).json({ closed: true })
  }

  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  try {
    const session = await getSession(sessionId)
    if (request.method === 'GET') return response.status(200).json(await snapshot(session))

    const { action = 'screenshot', url, x, y, text, key, selector } = request.body || {}

    if (action === 'navigate') {
      if (typeof url !== 'string' || !url.trim()) throw new Error('Enter a webpage URL.')
      const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`
      const publicUrl = await validatePublicUrl(normalizedUrl)
      await session.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
      await session.page.route('**/*', async (route) => {
        const targetUrl = route.request().url()
        try {
          if (/^https?:\/\//i.test(targetUrl)) await validatePublicUrl(targetUrl)
          await route.continue()
        } catch {
          await route.abort('blockedbyclient')
        }
      })
      await session.page.goto(publicUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await session.page.waitForTimeout(350)
    } else if (action === 'click') {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Choose a browser position to click.')
      await session.page.mouse.click(x, y)
    } else if (action === 'doubleClick') {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Choose a browser position to double-click.')
      await session.page.mouse.dblclick(x, y)
    } else if (action === 'type') {
      if (typeof text !== 'string') throw new Error('Enter text to type.')
      if (selector) await session.page.locator(selector).fill(text)
      else await session.page.keyboard.insertText(text)
    } else if (action === 'press') {
      if (typeof key !== 'string' || !key.trim()) throw new Error('Choose a key to press.')
      await session.page.keyboard.press(key)
    } else if (action === 'back') {
      await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    } else if (action === 'forward') {
      await session.page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    } else if (action === 'reload') {
      await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    } else if (action === 'scroll') {
      await session.page.mouse.wheel(0, Number.isFinite(y) ? y : 600)
    } else if (action !== 'screenshot') {
      throw new Error('Choose a supported browser action.')
    }

    await session.page.waitForTimeout(150)
    return response.status(200).json(await snapshot(session))
  } catch (error) {
    return response.status(422).json({ error: error instanceof Error ? error.message : 'The browser action failed.' })
  }
}

export const config = { maxDuration: 45 }
