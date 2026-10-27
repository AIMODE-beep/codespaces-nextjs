import { readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import formidable from 'formidable'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import { enforceRateLimit } from '../../lib/request-limit'

const maxFileSize = 4 * 1024 * 1024
const maxExtractedCharacters = 20_000
const supportedExtensions = new Set(['.txt', '.md', '.pdf', '.docx'])

function getUploadedFile(files) {
  const uploaded = files.document
  return Array.isArray(uploaded) ? uploaded[0] : uploaded
}

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('This text file is not valid UTF-8.')
  }
}

async function extractDocumentText(file, extension) {
  const buffer = await readFile(file.filepath)

  if (extension === '.txt' || extension === '.md') {
    return decodeText(buffer)
  }

  if (extension === '.docx') {
    if (buffer.subarray(0, 2).toString() !== 'PK') {
      throw new Error('This does not appear to be a valid DOCX document.')
    }
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  if (buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('This does not appear to be a valid PDF document.')
  }

  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText({ first: 40 })
    return result.text
  } finally {
    await parser.destroy()
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  if (!await enforceRateLimit(request, response, {
    limit: 10,
    window: '1 m',
    prefix: 'nova:requests',
  })) {
    return
  }

  let uploadedFile
  try {
    const form = formidable({
      uploadDir: os.tmpdir(),
      maxFiles: 1,
      maxFields: 0,
      maxFileSize,
      maxTotalFileSize: maxFileSize,
      allowEmptyFiles: false,
      keepExtensions: true,
    })
    form.on('file', (_fieldName, file) => {
      uploadedFile = file
    })
    const [, files] = await form.parse(request)
    uploadedFile = getUploadedFile(files)

    if (!uploadedFile) {
      return response.status(400).json({ error: 'Choose a document to upload.' })
    }

    const filename = path.basename(uploadedFile.originalFilename || 'document')
    const extension = path.extname(filename).toLowerCase()
    if (!supportedExtensions.has(extension)) {
      return response.status(415).json({
        error: 'Supported document types are PDF, DOCX, TXT, and Markdown.',
      })
    }

    const extractedText = (await extractDocumentText(uploadedFile, extension))
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()

    if (!extractedText) {
      return response.status(422).json({
        error: extension === '.pdf'
          ? 'No selectable text was found. Scanned PDFs need OCR, which is not supported yet.'
          : 'No readable text was found in that document.',
      })
    }

    const text = extractedText.slice(0, maxExtractedCharacters)
    return response.status(200).json({
      filename,
      text,
      truncated: extractedText.length > maxExtractedCharacters,
    })
  } catch (error) {
    if (error?.code === 1009 || error?.code === 1016 || error?.httpCode === 413) {
      return response.status(413).json({ error: 'Documents must be 4 MB or smaller.' })
    }

    return response.status(422).json({
      error: error instanceof Error ? error.message : 'Could not read that document.',
    })
  } finally {
    if (uploadedFile?.filepath) {
      try {
        await rm(uploadedFile.filepath, { force: true })
      } catch (cleanupError) {
        console.error('Failed to remove temporary document upload.', cleanupError)
      }
    }
  }
}

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
}
