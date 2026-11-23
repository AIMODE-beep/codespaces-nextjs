import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'

const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')
const textModel = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b'
const visionModel = process.env.OLLAMA_VISION_MODEL || 'llava:7b'

function portIsOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
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

async function getOllamaStatus() {
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/tags`, {
      headers: process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : undefined,
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return { available: false, error: `Ollama returned HTTP ${response.status}.`, models: [] }
    const data = await response.json().catch(() => ({}))
    const models = (data.models || []).map((item) => String(item.name || item.model || '')).filter(Boolean)
    return { available: true, models, textModelInstalled: models.some((name) => name === textModel || name.startsWith(`${textModel}:`)), visionModelInstalled: models.some((name) => name === visionModel || name.startsWith(`${visionModel}:`)) }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Could not reach Ollama.',
      models: [],
    }
  }
}

async function pollinationsAnalyze(issue, status) {
  if (!process.env.POLLINATIONS_API_KEY) return null
  try {
    const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}`,
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: process.env.POLLINATIONS_MODEL || 'openai/gpt-5.4-nano',
        messages: [
          {
            role: 'system',
            content: 'Diagnose this Pixel application problem. Return only JSON with keys summary and action. Allowed actions: restart_ollama, pull_text_model, pull_vision_model, none. Do not return shell commands.',
          },
          { role: 'user', content: JSON.stringify({ issue, status, textModel, visionModel }) },
        ],
      }),
    })
    if (!response.ok) return null
    const data = await response.json().catch(() => ({}))
    return parseAnalysis(data?.choices?.[0]?.message?.content)
  } catch {
    return null
  }
}

async function localAnalyze(issue, status) {
  if (!status.ollama.available) return null
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: status.ollama.textModelInstalled ? textModel : status.ollama.models[0],
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'Diagnose this Pixel application problem. Return only JSON with keys summary and action. Allowed actions: restart_ollama, pull_text_model, pull_vision_model, none. Do not return shell commands.',
          },
          { role: 'user', content: JSON.stringify({ issue, status, textModel, visionModel }) },
        ],
      }),
    })
    if (!response.ok) return null
    const data = await response.json().catch(() => ({}))
    return parseAnalysis(data?.message?.content)
  } catch {
    return null
  }
}

function parseAnalysis(content) {
  if (typeof content !== 'string') return null
  try {
    const match = content.match(/\{[\s\S]*\}/)
    const parsed = match ? JSON.parse(match[0]) : null
    if (!parsed || !['restart_ollama', 'pull_text_model', 'pull_vision_model', 'none'].includes(parsed.action)) return null
    return { summary: String(parsed.summary || 'Pixel found an issue and created a repair plan.').slice(0, 500), action: parsed.action }
  } catch {
    return null
  }
}

function deterministicAnalysis(issue, status) {
  if (!status.ollama.available) {
    return { summary: `Ollama is not reachable at ${ollamaBaseUrl}. The text model is not currently usable.`, action: 'restart_ollama' }
  }
  if (!status.ollama.textModelInstalled) {
    return { summary: `${textModel} is not installed in Ollama.`, action: 'pull_text_model' }
  }
  if (/screenshot|image|vision/i.test(issue || '') && !status.ollama.visionModelInstalled) {
    return { summary: `${visionModel} is not installed for image and screenshot questions.`, action: 'pull_vision_model' }
  }
  return { summary: 'The provider is healthy now. Pixel found no code-specific repair to apply.', action: 'none' }
}

function getOllamaExecutable() {
  const candidates = [
    process.env.OLLAMA_BINARY,
    path.join(os.homedir(), '.local', 'ollama-runtime', 'bin', 'ollama'),
    process.platform === 'win32' ? 'ollama.exe' : 'ollama',
  ].filter(Boolean)
  return candidates.find((candidate) => candidate.includes(path.sep) ? fs.existsSync(candidate) : true) || null
}

function runOllama(args, timeout = 120_000) {
  const executable = getOllamaExecutable()
  if (!executable) return Promise.resolve({ ok: false, error: 'The Ollama executable was not found.' })
  return new Promise((resolve) => {
    const child = execFile(executable, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, error: String(stderr || stdout || error.message).slice(0, 1000) })
      else resolve({ ok: true, output: String(stdout || stderr).slice(0, 1000) })
    })
    child.unref?.()
  })
}

async function executeRepair(action) {
  if (action === 'restart_ollama') {
    const executable = getOllamaExecutable()
    if (!executable) return { ok: false, error: 'The Ollama executable was not found.' }
    const child = spawn(executable, ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
      windowsHide: true,
    })
    child.unref()
    await new Promise((resolve) => setTimeout(resolve, 2500))
    return { ok: true }
  }
  if (action === 'pull_text_model') return runOllama(['pull', textModel])
  if (action === 'pull_vision_model') return runOllama(['pull', visionModel])
  return { ok: true }
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  const pixelPortOpen = await portIsOpen(3000)
  const ollama = await getOllamaStatus()
  const status = {
    pixel: { available: pixelPortOpen, url: 'http://localhost:3000' },
    ollama: { ...ollama, baseUrl: ollamaBaseUrl },
    models: { text: textModel, vision: visionModel },
    timestamp: new Date().toISOString(),
  }

  if (request.method === 'GET') {
    const healthy = status.pixel.available && status.ollama.available && status.ollama.textModelInstalled
    return response.status(healthy ? 200 : 503).json({ healthy, status })
  }

  const issue = typeof request.body?.issue === 'string' ? request.body.issue.slice(0, 2000) : ''
  const execute = request.body?.execute === true
  let analysis = await localAnalyze(issue, status)
  analysis ||= await pollinationsAnalyze(issue, status)
  analysis ||= deterministicAnalysis(issue, status)

  let repair = null
  if (execute && analysis.action !== 'none') repair = await executeRepair(analysis.action)

  await new Promise((resolve) => setTimeout(resolve, repair?.ok ? 1200 : 0))
  const refreshedOllama = await getOllamaStatus()
  const refreshed = {
    ...status,
    ollama: { ...refreshedOllama, baseUrl: ollamaBaseUrl },
    timestamp: new Date().toISOString(),
  }

  return response.status(200).json({ analysis, repair, status: refreshed })
}
