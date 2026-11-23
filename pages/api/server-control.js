import net from 'node:net'
import { spawn } from 'node:child_process'
import fs from 'node:fs'

function portIsOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 3000 })
    socket.setTimeout(800)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  if (await portIsOpen()) {
    return response.status(200).json({ running: true, url: 'http://localhost:3000' })
  }

  if (request.method === 'GET') {
    return response.status(200).json({ running: false, url: 'http://localhost:3000' })
  }

  const logPath = '/tmp/pixel-next.log'
  const logFile = fs.openSync(logPath, 'a')
  const child = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--hostname', '0.0.0.0', '--port', '3000'],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', logFile, logFile],
      env: process.env,
    }
  )
  child.unref()

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (await portIsOpen()) {
      fs.closeSync(logFile)
      return response.status(200).json({ running: true, url: 'http://localhost:3000' })
    }
  }

  fs.closeSync(logFile)
  return response.status(503).json({
    running: false,
    error: 'Pixel did not start on port 3000.',
  })
}
