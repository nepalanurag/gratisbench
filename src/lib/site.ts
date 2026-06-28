// Site URL / base-path helpers. Used by layouts and pages so the site works
// both at a domain root and under a subpath (e.g. GitHub Pages /gratisbench/).
// Never hardcode absolute internal links like "/pdf-tools" — use basePath().

/** Prefix an internal path with the configured base path. */
export function basePath(p: string): string {
  const base: string = import.meta.env.BASE_URL; // always ends with '/'
  const clean = p.startsWith('/') ? p.slice(1) : p;
  return base + clean;
}

/** Absolute site URL from the Astro config (SITE_URL env). No trailing slash. */
export function siteUrl(site: URL | undefined): string {
  return (site?.toString() ?? 'https://www.gratisbench.com').replace(/\/$/, '');
}

// Donation page URL shown as the "Donate" button in the site header (desktop
// and mobile menu) and as the Ko-fi link in the ad-block support notice.
// Leave empty to hide the Donate button entirely. Set this to the real
// donation page URL (Ko-fi, PayPal, etc.) before launch.
export const DONATE_URL = 'https://ko-fi.com/anuragnepal';

// Privacy-friendly analytics (GoatCounter: cookieless, no personal data).
// Set to your GoatCounter site code (the "xxxx" in xxxx.goatcounter.com) to
// count pageviews per tool page. Leave empty to disable analytics entirely.
export const ANALYTICS_CODE = '';

// GitHub repo used by the /feedback page to open prefilled issues.
export const GITHUB_REPO = 'nepalanurag/gratisbench';
