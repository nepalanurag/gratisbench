# FreeKit

Free browser-based tools. 32 tools, zero signup, zero uploads: every file is processed locally in the visitor's browser and never touches a server.

Test site: https://nepalanurag.github.io/freekit/

## Tools

**PDF** (9): Merge PDF, Split PDF, Images to PDF, Compress PDF, PDF to JPG, Redact PDF, Sign PDF, Unlock PDF, PDF to Word

**Image** (5): Image compressor, Image converter, Background remover, Image OCR, Image tracer

**Media** (7): Audio trimmer, Audio merger, Audio converter, Video compressor, Video trimmer, Video converter, Screen recorder

**Business** (3): Invoice generator, Email signature generator, Business profile

**Money** (2): Budget planner, Subscription tracker

**Design** (3): Logo maker, OG image generator, Device mockup generator

**Career** (1): Resume builder

**Generators** (2): QR code generator, Fake data generator

## Privacy

No accounts, no cookies, no server-side processing. Optional analytics uses GoatCounter (cookieless, no personal data). See "Analytics" below.

## Tech

Astro 5 static site, TypeScript. Heavy lifting is client-side: pdf-lib, pdf.js, Pyodide (pypdf) for Unlock PDF, FFmpeg WASM for media tools, Tesseract.js for OCR, @imgly/background-removal.

## Local development

```bash
npm ci
npm run dev
```

Build and run the automated checks:

```bash
npm run build
npm run verify
```

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and deploys to GitHub Pages. Two environment variables control the output:

- `SITE_URL`: absolute site URL (production default `https://www.freekit.app`)
- `BASE_PATH`: subpath the site is served from (e.g. `/freekit/` for GitHub Pages testing)

Always push the source tree, never `dist/`. The tree-push helper replaces the whole branch, so verify `.github/workflows/deploy.yml` still exists after pushing.

## Analytics

Usage stats are off by default. To enable them:

1. Create a free site at [GoatCounter](https://www.goatcounter.com/) (cookieless, GDPR-friendly, no personal data collected).
2. Set `ANALYTICS_CODE` in `src/lib/site.ts` to your GoatCounter site code (the `xxxx` in `xxxx.goatcounter.com`).
3. Rebuild and deploy.

Pageviews are then counted per tool page, which shows which tools get used. No events, no fingerprinting.

## Feedback

The `/feedback` page on the site opens a prefilled GitHub issue on this repo, so feedback lands here as issues. No backend needed.

## Project structure

- `src/pages/`: one `.astro` file per tool plus category index pages
- `src/layouts/`: `BaseLayout.astro` (head, header, footer), `ToolPage.astro` (tool page template with SEO structured data)
- `src/components/`: shared UI (command palette, support notice)
- `src/lib/`: tool logic, `tools.ts` (canonical tool index), `site.ts` (URLs, analytics, donate link)
- `scripts/verify-tools.mjs`: automated checks (run with `npm run verify`)
- `public/`: static files (`robots.txt`, `llms.txt`, OG image)

## License

MIT.
