import type { APIRoute } from 'astro';

// Build-time sitemap generated from the actual page files, so new pages
// are never missing. 404 and this endpoint are excluded.
// import.meta.glob keys are relative paths like './merge-pdf.astro';
// only the keys are used, so no page modules are loaded.
const pageFiles = import.meta.glob('./*.astro');

export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? 'https://www.freekit.app/').replace(/\/$/, '');

  const urls = Object.keys(pageFiles)
    .map((p) => p.replace(/^\.\//, '').replace(/\.astro$/, ''))
    .filter((name) => name !== '404')
    .map((name) => {
      const path = name === 'index' ? '/' : '/' + name;
      const isHome = name === 'index';
      const isCategory = name.endsWith('-tools');
      return {
        loc: base + path,
        changefreq: isHome || isCategory ? 'weekly' : 'monthly',
        priority: isHome ? '1.0' : isCategory ? '0.9' : '0.8',
      };
    })
    .sort((a, b) => a.loc.localeCompare(b.loc));

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
      )
      .join('\n') +
    '\n</urlset>\n';

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
