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
    const browser = await chromium.launch({
      headless: true,
      channel: 'chromium',
      args: [
        '--disable-dev-shm-usage',
        '--disable-features=Translate,BackForwardCache',
      ],
    })
    const context = await browser.newContext({
      viewport: { width: 3840, height: 2160 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      colorScheme: 'light',
      hasTouch: false,
      isMobile: false,
      acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
    const page = await context.newPage()
    session = { browser, context, page, url: 'about:blank', lastActive: Date.now(), history: [] }
    sessions.set(id, session)
    const cdp = await context.newCDPSession(page)
    session.cdp = cdp
    session.latestFrame = null
    await cdp.send('Page.enable')
    cdp.on('Page.screencastFrame', async (event) => {
      session.latestFrame = event.data
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
      } catch {}
    })
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 96,
      maxWidth: 3840,
      maxHeight: 2160,
      everyNthFrame: 1,
    })
  }
  session.lastActive = Date.now()
  return session
}

async function snapshot(session) {
  if (session.latestFrame) {
    const viewport = session.page.viewportSize() || { width: 3840, height: 2160 }
    return {
      screenshot: `data:image/jpeg;base64,${session.latestFrame}`,
      url: session.page.url(),
      title: await session.page.title(),
      viewport,
    }
  }
  const screenshot = await session.page.screenshot({
    type: 'jpeg',
    quality: 96,
    fullPage: false,
    animations: 'disabled',
    caret: 'initial',
  })
  const viewport = session.page.viewportSize() || { width: 3840, height: 2160 }
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
      : typeof request.query?.sessionId === 'string'
        ? request.query.sessionId
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
      const trimmedUrl = url.trim()
      const looksLikeUrl = /^https?:\/\//i.test(trimmedUrl)
        || /^(localhost|127(?:\.\d{1,3}){3}|[^\s]+\.[^\s]+)(?:[/:?#]|$)/i.test(trimmedUrl)
      const normalizedUrl = looksLikeUrl
        ? (/^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`)
        : `https://www.bing.com/search?q=${encodeURIComponent(trimmedUrl)}`
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
      await session.cdp?.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await session.cdp?.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    } else if (action === 'doubleClick') {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Choose a browser position to double-click.')
      await session.cdp?.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 })
      await session.cdp?.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 })
    } else if (action === 'type') {
      if (typeof text !== 'string') throw new Error('Enter text to type.')
      if (selector) await session.page.locator(selector).fill(text)
      else await session.cdp?.send('Input.insertText', { text })
    } else if (action === 'press') {
      if (typeof key !== 'string' || !key.trim()) throw new Error('Choose a key to press.')
      await session.page.keyboard.press(key)
    } else if (action === 'back') {
      await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    } else if (action === 'forward') {
      await session.page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    } else if (action === 'reload') {
      await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    } else if (action === 'wheel') {
      const viewportX = Number.isFinite(x) ? x : (session.page.viewportSize()?.width || 3840) / 2
      const viewportY = Number.isFinite(y) ? y : (session.page.viewportSize()?.height || 2160) / 2
      const delta = Number.isFinite(request.body?.deltaY) ? request.body.deltaY : 600
      await session.cdp?.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: viewportX,
        y: viewportY,
        deltaX: 0,
        deltaY: Math.max(-3000, Math.min(3000, delta)),
      })
    } else if (action === 'scroll') {
      const distance = Number.isFinite(y) ? y : 600
      await session.page.evaluate((scrollDistance) => {
        window.scrollBy({ top: scrollDistance, behavior: 'smooth' })
      }, distance)
    } else if (action !== 'screenshot') {
      throw new Error('Choose a supported browser action.')
    }

    if (action !== 'wheel' && action !== 'scroll') {
      await session.page.waitForTimeout(150)
    }
    return response.status(200).json(await snapshot(session))
  } catch (error) {
    return response.status(422).json({ error: error instanceof Error ? error.message : 'The browser action failed.' })
  }
}

export const config = { maxDuration: 45 }
