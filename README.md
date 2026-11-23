# GitHub Codespaces ♥️ Next.js

Welcome to your shiny new Codespace running Next.js! We've got everything fired up and running for you to explore Next.js.

You've got a blank canvas to work on from a git perspective as well. There's a single initial commit with the what you're seeing right now - where you go from here is up to you!

Everything you do here is contained within this one codespace. There is no repository on GitHub yet. If and when you’re ready you can click "Publish Branch" and we’ll create your repository and push up your project. If you were just exploring then and have no further need for this code then you can simply delete your codespace and it's gone forever.

To run this application:

```
npm run dev
```

## Local AI model

For local development, Pixel connects to Ollama on the same environment. Install
[Ollama](https://ollama.com/download), then start its server and download the default model:

```
~/.local/ollama-runtime/bin/ollama serve
~/.local/ollama-runtime/bin/ollama pull qwen2.5:1.5b
```

Keep Ollama running while using Pixel. For screenshot questions, install a vision
model too:

```
~/.local/ollama-runtime/bin/ollama pull llava:7b
```

Pixel automatically switches between `OLLAMA_MODEL` for text and
`OLLAMA_VISION_MODEL` (default `llava:7b`) for image attachments. The models run
on the Codespace, so responses use its compute and storage.

## Vercel deployment with OpenRouter

For hosted chat fallback, configure `OPENROUTER_API_KEY` as a server-side
environment variable. Optionally set `OPENROUTER_MODEL`; the default is
`openrouter/free`, which lets OpenRouter route to an available free model.
Set `OPENROUTER_SITE_URL` and `OPENROUTER_APP_NAME` to identify the app.
Never expose the key in browser code or commit it to Git.

OpenRouter usage is subject to the selected model's limits, provider availability,
and account billing or free credits. User messages and extracted document text
are sent to OpenRouter only when the configured Ollama provider fails.

Production also requires an Upstash Redis database with REST access. Set
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel to enforce a
shared limit of 10 requests per minute per visitor IP. If the limiter is not
configured or available, the API rejects chat requests rather than allowing
unprotected public usage.

After adding the environment variables, deploy or redeploy the Vercel project.
The deployment uses configured Ollama first, with optional OpenRouter fallback.
Each service may have separate costs and usage limits.

## Music generation

Set `MUSIC_GENERATION_URL` and, if required, `MUSIC_GENERATION_API_KEY` in the
server environment to connect a music generation provider. Pixel sends the prompt,
genre, output channel selection, duration, and quality to that provider and
expects audio bytes or a JSON response with a downloadable audio URL, such as
`audio_url`. Until a provider URL is configured, music generation is unavailable.
Generated audio can be played in Pixel and downloaded in its matching format.

Music requests do not have an app-side rate limit. The provider can still enforce
its own quotas, availability, and billing, and an unauthenticated public app can
incur provider costs. Keep provider credentials server-side.

## Optional hosted Ollama and OpenRouter fallback

If configured Ollama is unavailable, Pixel can fall back to OpenRouter only when
`OPENROUTER_API_KEY` is set. Without it, Pixel returns a clear Ollama
availability error instead of contacting another hosted provider. Hosted
Ollama requires a separate, persistent server; the Ollama instance in a
Codespace is not reachable from Vercel.

For production failover, set `OLLAMA_BASE_URL` to the server's HTTPS URL,
`OLLAMA_MODEL` to an installed model, and optionally `OLLAMA_API_KEY` for the
authenticated reverse proxy. Keep the model server available and do not expose
its unauthenticated Ollama port to the internet.

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

Keeping both providers configured on independent services can reduce outages,
but continuous AI responses cannot be guaranteed if every configured provider
is unavailable or its credentials, balance, or rate limits prevent requests.

Pixel's chat prompt is designed to support school learning with step-by-step
explanations, study questions, and writing feedback. Students should verify
answers and follow their school's rules for AI assistance.

## Appearance settings

Open **Settings** in the chat header to choose the Notebook, Chalkboard,
Library, or Lavender theme, customize the accent color, and turn off the subtle
animated notebook background. You can also choose a personal GIF, JPG, PNG, or
WebP background up to 1 MB. Appearance preferences and the selected image stay
in that browser's local storage; they are not sent to Pixel or shared across
devices. Restore the default appearance from Settings at any time.

Choose **Fast**, **Balanced**, or **Deep thinking** in the message composer to
adjust response detail. This changes the answer guidance and output length for
the configured AI provider; it does not switch to a different underlying model.
Hover over or focus a sent message and choose its edit control to revise that
prompt and retry the conversation from that point.

## Code mode

Open **Code mode** from the navigation menu to generate, edit, copy, download,
and preview code. Choose a common language or enter a custom one; Pixel can
generate code for any language. HTML and CSS have a static browser preview.
Standalone JavaScript runs in a temporary Web Worker with network APIs disabled
and a five-second execution limit. Other languages need an appropriate local or
project runtime; Pixel includes setup and run instructions when generating code.

## Webpage access

Enable **Web access** in the Pixel composer, then include one or more public
`http://` or `https://` URLs in your message. Pixel reads up to three webpages,
uses up to 20,000 characters per page, and treats webpage text as untrusted
reference material. Source URLs are requested in the answer when that content is
used.

Pixel blocks credentials in URLs, local/private hosts, private network IP ranges,
unsupported file types, and unsafe redirects. Web content is not saved after the
request, but URLs and extracted text are sent to the configured AI provider with
the question.

## Browser workspace

Open **Browser workspace** from the composer tools menu. Pixel opens Chromium in a
live, headless browser session that can navigate public webpages, go back,
reload, scroll, click, type, and press keyboard keys. Click positions in the
browser screenshot to control the page manually.

Private/local addresses, credential URLs, unsupported redirect targets, and
private-network IP ranges are blocked. Browser activity is temporary and the
session closes when the workspace is closed. Playwright must be installed and
its compatible Chromium runtime downloaded on the server for this feature.

## Study documents

Upload PDF, DOCX, TXT, or Markdown documents up to 4 MB using the paperclip
button. You can also paste text directly into the message box (up to 20,000
characters). For larger documents, split out only the relevant pages or
sections. Pixel includes up to 20,000 extracted characters with your question.
PDF support reads selectable text from up to the first 40 pages; scanned PDFs
that need OCR are not supported. Uploaded files are processed temporarily on the
server and removed after extraction. Extracted text stays in the current browser
conversation and is sent to the configured AI provider when you ask Pixel about it.
