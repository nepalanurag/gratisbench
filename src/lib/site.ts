// Site URL / base-path helpers. Used by layouts and pages so the site works
// both at a domain root and under a subpath (e.g. GitHub Pages /freekit/).
// Never hardcode absolute internal links like "/pdf-tools" — use basePath().

/** Prefix an internal path with the configured base path. */
export function basePath(p: string): string {
  const base: string = import.meta.env.BASE_URL; // always ends with '/'
  const clean = p.startsWith('/') ? p.slice(1) : p;
  return base + clean;
}

/** Absolute site URL from the Astro config (SITE_URL env). No trailing slash. */
export function siteUrl(site: URL | undefined): string {
  return (site?.toString() ?? 'https://www.freekit.app').replace(/\/$/, '');
}
