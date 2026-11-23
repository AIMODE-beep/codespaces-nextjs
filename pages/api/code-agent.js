import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const workspaceRoot = path.resolve(process.cwd())
const ignoredDirectories = new Set(['.git', '.next', 'node_modules', 'coverage', '.turbo'])

function resolveWorkspacePath(relativePath = '') {
  const normalized = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '')
  const resolved = path.resolve(workspaceRoot, normalized)
  if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error('Path is outside the Pixel workspace.')
  }
  return resolved
}

async function listFiles(directory = workspaceRoot, output = [], depth = 0) {
  if (depth > 6 || output.length >= 300) return output
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await listFiles(path.join(directory, entry.name), output, depth + 1)
    } else if (!entry.name.startsWith('.env.local')) {
      output.push(path.relative(workspaceRoot, path.join(directory, entry.name)).replace(/\\/g, '/'))
    }
    if (output.length >= 300) break
  }
  return output.sort((left, right) => left.localeCompare(right))
}

async function inspectRepository() {
  const files = await listFiles()
  const packageJsonPath = resolveWorkspacePath('package.json')
  let scripts = {}
  try {
    scripts = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')).scripts || {}
  } catch {}

  let gitStatus = ''
  try {
    const result = await execFileAsync('git', ['status', '--short', '--branch'], { cwd: workspaceRoot, timeout: 10_000 })
    gitStatus = result.stdout.trim()
  } catch {}

  return { root: path.basename(workspaceRoot), files, scripts, gitStatus }
}

async function readFiles(requestedPaths) {
  const pathsToRead = Array.isArray(requestedPaths) ? requestedPaths.slice(0, 20) : []
  const files = []
  for (const requestedPath of pathsToRead) {
    try {
      const resolved = resolveWorkspacePath(requestedPath)
      const stat = await fs.stat(resolved)
      if (!stat.isFile() || stat.size > 500_000) continue
      files.push({
        path: String(requestedPath).replace(/\\/g, '/'),
        content: await fs.readFile(resolved, 'utf8'),
      })
    } catch {}
  }
  return files
}

async function searchFiles(query) {
  const needle = String(query || '').trim()
  if (!needle || needle.length > 200) return []
  const files = await listFiles()
  const matches = []
  for (const relativePath of files) {
    if (!/\.(js|jsx|ts|tsx|json|css|md|html|yml|yaml)$/i.test(relativePath)) continue
    try {
      const content = await fs.readFile(resolveWorkspacePath(relativePath), 'utf8')
      if (content.toLowerCase().includes(needle.toLowerCase())) {
        const index = content.toLowerCase().indexOf(needle.toLowerCase())
        const start = Math.max(0, index - 120)
        const end = Math.min(content.length, index + needle.length + 240)
        matches.push({ path: relativePath, snippet: content.slice(start, end).replace(/\s+/g, ' ').trim() })
      }
    } catch {}
    if (matches.length >= 40) break
  }
  return matches
}

async function applyPatch(patch) {
  if (!Array.isArray(patch)) throw new Error('Patch must be an array.')
  const applied = []
  for (const change of patch.slice(0, 50)) {
    if (!change || typeof change.path !== 'string') throw new Error('Every patch needs a path.')
    if (!['write', 'delete'].includes(change.operation || 'write')) throw new Error('Unsupported patch operation.')
    const resolved = resolveWorkspacePath(change.path)
    if (change.operation === 'delete') {
      await fs.rm(resolved, { force: true })
      applied.push(change.path)
      continue
    }
    if (typeof change.content !== 'string') throw new Error(`Missing content for ${change.path}.`)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, change.content, 'utf8')
    applied.push(change.path)
  }
  return applied
}

async function gitDiff() {
  const result = await execFileAsync('git', ['diff', '--stat', '--', '.'], { cwd: workspaceRoot, timeout: 10_000 })
  const patch = await execFileAsync('git', ['diff', '--', '.'], { cwd: workspaceRoot, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })
  return { stat: result.stdout, patch: patch.stdout.slice(0, 500_000) }
}

async function runScript(script) {
  const packageJson = JSON.parse(await fs.readFile(resolveWorkspacePath('package.json'), 'utf8'))
  if (!packageJson.scripts || typeof packageJson.scripts[script] !== 'string') {
    throw new Error(`Package script "${script}" is not configured.`)
  }
  const result = await execFileAsync('npm', ['run', script], {
    cwd: workspaceRoot,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  })
  return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  try {
    const { action, ...payload } = request.body || {}
    if (action === 'inspect') return response.status(200).json(await inspectRepository())
    if (action === 'read') return response.status(200).json({ files: await readFiles(payload.paths) })
    if (action === 'search') return response.status(200).json({ matches: await searchFiles(payload.query) })
    if (action === 'diff') return response.status(200).json(await gitDiff())
    if (action === 'patch') return response.status(200).json({ applied: await applyPatch(payload.patch) })
    if (action === 'run') return response.status(200).json(await runScript(payload.script))
    return response.status(400).json({ error: 'Unknown repository action.' })
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).slice(-20_000) : ''
    const stdout = error?.stdout ? String(error.stdout).slice(-20_000) : ''
    if (error?.code === 'ENOENT') return response.status(404).json({ error: error.message })
    if (error?.code === 1 && error?.stdout !== undefined) {
      return response.status(200).json({ exitCode: 1, stdout, stderr: stderr || String(error.message) })
    }
    return response.status(400).json({ error: error instanceof Error ? error.message : 'Repository action failed.' })
  }
}
