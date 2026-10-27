# GitHub Codespaces ♥️ Next.js

Welcome to your shiny new Codespace running Next.js! We've got everything fired up and running for you to explore Next.js.

You've got a blank canvas to work on from a git perspective as well. There's a single initial commit with the what you're seeing right now - where you go from here is up to you!

Everything you do here is contained within this one codespace. There is no repository on GitHub yet. If and when you’re ready you can click "Publish Branch" and we’ll create your repository and push up your project. If you were just exploring then and have no further need for this code then you can simply delete your codespace and it's gone forever.

To run this application:

```
npm run dev
```

## Local AI model

For local development, Nova connects to Ollama on the same environment. Install
[Ollama](https://ollama.com/download), then start its server and download the default model:

```
~/.local/ollama-runtime/bin/ollama serve
~/.local/ollama-runtime/bin/ollama pull qwen2.5:1.5b
```

Keep Ollama running while using Nova. The model runs on the Codespace, so responses
use its compute and storage.

## Public deployment

Nova can be deployed to Vercel, but production needs two services in addition to
the website:

1. A persistent Ollama server running the model. The Ollama instance currently
   installed in a Codespace is not a production server and will not be reachable
   from Vercel. Put Ollama behind an HTTPS reverse proxy that requires the
   `Authorization: Bearer ...` secret configured as `OLLAMA_API_KEY`. Do not
   expose Ollama's unauthenticated port (`11434`) directly to the internet.
2. An Upstash Redis database with REST access. The chat API requires it to enforce
   a shared limit of 10 requests per minute per visitor IP. If the limiter is not
   configured or available, the API rejects chat requests rather than allowing
   unprotected public usage.

To deploy:

1. Push this repository to GitHub and import it into Vercel as a Next.js project.
2. Create an Upstash Redis database and set `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` in the Vercel project's server-side environment
   variables.
3. Set `OLLAMA_BASE_URL` to the HTTPS URL of the authenticated Ollama reverse
   proxy, `OLLAMA_API_KEY` to its shared secret, and `OLLAMA_MODEL` to a model
   installed on that server (default: `qwen2.5:1.5b`).
4. Deploy and test chat. Keep all credentials in Vercel environment variables;
   never add real secrets to Git or client-side variables.
5. To use a custom address, register a domain that is available, add it in
   Vercel's project **Settings → Domains**, and apply the DNS records Vercel
   provides. `nova.com` may already be registered; a different available domain
   may be needed.

The website's public chat endpoint allows anyone to use it, subject to the rate
limit. Hosting the model publicly also requires monitoring server capacity and
keeping the proxy secret private. Vercel and the model server are separate
services and may have separate costs and usage limits.

Nova's chat prompt is designed to support school learning with step-by-step
explanations, study questions, and writing feedback. Students should verify
answers and follow their school's rules for AI assistance.

## Study documents

Upload PDF, DOCX, TXT, or Markdown documents up to 4 MB using the paperclip
button. You can also paste text directly into the message box (up to 20,000
characters). For larger documents, split out only the relevant pages or
sections. Nova includes up to 20,000 extracted characters with your question.
PDF support reads selectable text from up to the first 40 pages; scanned PDFs
that need OCR are not supported. Uploaded files are processed temporarily on the
server and removed after extraction. Extracted text stays in the current browser
conversation and is sent to the configured Ollama model when you ask Nova about it.
