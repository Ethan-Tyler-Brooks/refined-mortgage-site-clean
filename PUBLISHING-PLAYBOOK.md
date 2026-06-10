# Autonomous Publishing Playbook — Refined Mortgage Group Blog

Runbook for the scheduled Cowork task (Mon/Wed/Fri). Goal: one SEO + AI-optimized
blog post per run, published live (GitHub Ethan-Tyler-Brooks/refined-mortgage-site-clean
→ Netlify, https://www.ethanbrooks.mortgage). Work in the sandbox shell; the Cowork
mount cannot run git.

## 0. Auth & checkout
- TOKEN from the Cowork mount: `.rcs-publish/gh_token_pinedandy_rmg`.
- Clone to the sandbox FS (e.g. /tmp/rmg), NOT the mount:
  `git clone https://x-access-token:<TOKEN>@github.com/Ethan-Tyler-Brooks/refined-mortgage-site-clean.git`
- `git config user.name "Refined Mortgage Bot"` / `user.email "ethan@ethantbrooks.com"`.
- Never print the token; mask with sed. Pass the tokened URL only on push.

## 1. Topic
- Read CONTENT-CALENDAR.md; take the first `⬜` row. If none, generate a fresh
  Wisconsin-buyer topic not already covered by existing /blog or /learn pages.

## 2. Write the post — copy `blog/do-you-really-need-20-percent-down.html` as the template
Keep the exact head/nav/footer and CSS. Swap the per-post parts. Required:
- Unique <title>, meta description, canonical for the new URL, robots meta.
- Open Graph (og:type=article, title, description, url) + twitter:card.
- TWO JSON-LD blocks: a `BlogPosting` (headline, description, author Person =
  Ethan Brooks with jobTitle + identifier "NMLS #1639987", publisher Organization,
  mainEntityOfPage = post URL, datePublished + dateModified = today) AND a `FAQPage`
  built from the post's 3 FAQ questions.
- One <h1> = headline; <h2>s phrased as real buyer questions; 700–1,000 words;
  one concrete dollar example; a "Frequently asked questions" section with 3 Q&As
  matching the FAQPage schema; a CTA block linking the Calendly
  (https://calendly.com/ethan-brooks/15min); one internal link to another /blog or
  /learn page.
- Byline line: "<b>Ethan Brooks</b> · Mortgage Advisor, NMLS #1639987 · N min read".
- COMPLIANCE footer in every post: Equal Housing Opportunity + "This is not a
  commitment to lend. Rates and terms subject to change without notice." Never state
  a specific interest rate as guaranteed.
- Voice: plain-English, candid, helpful — never hypey. Clean keyword-rich slug.

## 3. Update surfaces
- New `blog/<slug>.html`.
- `blog/index.html` — add a `.pcard` at the TOP of the `.posts` grid (tag = category,
  excerpt, meta date, "Read article →"). Match an existing card's markup exactly.
- `sitemap.xml` — add `<url><loc>https://www.ethanbrooks.mortgage/blog/<slug>.html</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>` before `</urlset>`.
- (No homepage change needed — the homepage only links to /blog/.)

## 4. Calendar
- Flip the chosen row's status from `⬜` to `✅ Published`.

## 5. Validate → commit → push → verify
- Both JSON-LD blocks must json.loads cleanly; sitemap.xml must parse as XML. Fix before push.
- Commit, then `git push https://x-access-token:<TOKEN>@github.com/Ethan-Tyler-Brooks/refined-mortgage-site-clean.git HEAD:main` (mask token).
- Wait ~40s, fetch the live post URL to confirm Netlify deployed.
- Report headline, live URL, word count, remaining ⬜ count.

## Notes
- Static site, no build step; Netlify auto-deploys pushes to main.
- A Decap CMS exists in /admin but the live posts are flat HTML in /blog — follow the
  flat-HTML pattern, ignore the CMS markdown path.
- If the org/account rejects the token, stop and surface the error; do not retry blindly.
