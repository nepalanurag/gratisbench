import { defineConfig } from 'astro/config';

// Deploy configuration via environment:
//   SITE_URL   — absolute site URL (default: https://www.gratisbench.com)
//   BASE_PATH  — subpath the site is served from, e.g. /gratisbench/ for GitHub Pages testing (default: /)
const site = process.env.SITE_URL || 'https://www.gratisbench.com';
let base = process.env.BASE_PATH || '/';
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base = base + '/';

export default defineConfig({
  site,
  base,
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
