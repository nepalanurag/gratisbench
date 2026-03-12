# FreeKit Design Brief (v4)

Written 2026-09-24 after the v3 redesign was rejected as looking AI-generated.
Based on a web-research pass on human vs. AI-looking web design (report:
research_notes/human-vs-ai-web-design-lessons-20260924-0540/report.md).

## The finding that set the direction

Warm cream + editorial serif was supposed to escape the AI look. The
research said it is itself the current AI tell: it is a cluster of
defaults (default font pairing, default color story, default texture,
default badge), not one forbidden choice. A site that is recognizable
only by its defaults reads as generated. A site where every visible
choice has a product reason reads as made by a person.

## The prompt the site is built from

Write a prompt for a human-friendly website. Not a prompt for an image
of a website. The answer:

1. **No webfonts.** System type stack only. Every AI-looking site loads
   the same three Google Fonts. A person who cares about load speed uses
   what is already on the device.
2. **Black on white, blue links.** No cream background, no brand color,
   no brick red. Links are the blue everyone recognizes. One dark button
   for primary actions. If you cannot say why a color is there, it goes.
3. **No texture, no badges, no stamps.** Grain, "field manual" badges,
   dotted leaders, stamped labels, numbered sections: decoration without
   a job. All cut.
4. **Commit to an extreme.** The middle of the tasteful-quirky-to-boring
   spectrum is where slop lives. Go brutally plain and dense: a simple
   index page, not a marketing page.
5. **Copy in first person.** "I built them because I kept needing them."
   Name the actual task in every headline. Numbers, not adjectives. No
   witty taglines, no triads, no "not just X, it's Y".
6. **Visible authorship.** The footer says who made it. A site with a
   name on it reads as someone's work.
7. **The tool is the hero.** Tool pages open with a breadcrumb, a plain
   title, one line of description, then the working tool. No plates, no
   tabs, no ceremony. The working product is the first thing that matters.
8. **Keep what users asked for.** Dark mode and the reading-comfort
   settings stay. They are functional, restyled to match, not decorative.

## What this rules out

- Editorial serifs, cream/paper themes, noise textures, gradient accents
- Eyebrow labels, giant clever headlines, paired CTAs, three-card feature
  rows, "manual / dossier / terminal" metaphors
- Forced quips, "seamless", "robust", "delve", meaningless participial
  endings ("empowering users...")

## Kept from earlier work (non-negotiable)

- 31 working tools, one domain, on-device file processing
- "Your files never leave your device." on applicable tools
- Responsive + mobile-first behavior (iOS focus-zoom guard, hamburger
  nav, icon-only buttons on small screens, stacked layouts)
- Dark mode: early theme init (no light flash), system fallback,
  localStorage persistence
- Reading-comfort panel: larger text, higher contrast, reduce motion,
  underline links
- SEO + LLM-citation structure: plain HTML, schema.org markup, real FAQ
  content, honest limitations
- No cookies, no accounts, no tracking

## v4.1 addendum (2026-09-24): the recommended mix

From the "five web design styles" video Anurag shared, applied two:

- Type-focused: a bigger, tighter homepage headline in system type only.
  No webfont, just scale and weight used with intent.
- Product front and center: a real working QR generator on the homepage.
  Visitors use a tool before they read about the site.

Neutral palette kept from v4. Deliberately skipped:

- Glow effects: gradients and glow sit on the AI-tell list from the
  research. Decoration without a job.
- Bento grids: visual noise for 31 tools. The plain index scans faster.
