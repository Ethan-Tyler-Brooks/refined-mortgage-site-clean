#!/usr/bin/env python3
"""Generate /mortgage-lender/* and /loans/* landing pages from data/local-pages/*.json.

Run from the repo root:  python3 scripts/gen_local_pages.py
Content lives in the JSON files; layout, schema, CTAs and disclosures live here.
Re-running is idempotent. Edit the JSON, re-run, commit both.
"""
import glob, html, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://www.ethanbrooks.mortgage"
UPDATED_ISO = "2026-10-07"
UPDATED_TXT = "October 2026"
CAL = "https://calendly.com/ethan-brooks/15min"
APPLY = "https://mtgpro.co/dr/c/nroce"
BUSINESS_ID = BASE + "/#business"
PERSON_ID = BASE + "/#ethan"

LEGAL = ("This information is not intended to be an indication of loan qualification, loan approval or commitment to lend. "
         "This is not an offer to enter into an agreement. Not all customers will qualify. Information, rates and programs are "
         "subject to change without notice. All products are subject to credit and property approval. Ethan Brooks, NMLS #1639987 · "
         "Refined Mortgage Group, a branch of Fairway Home Mortgage NMLS ID #2289. Equal Housing Opportunity.")

e = lambda s: html.escape(s, quote=True)


def load():
    pages = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data/local-pages/*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        d["path"] = f"/{d['section']}/" + (f"{d['slug']}/" if d["slug"] else "")
        pages.append(d)
    return pages


def short_name(d):
    if d["kind"] == "hub":
        return "Wisconsin mortgage lenders" if d["section"] == "mortgage-lender" else "All Wisconsin loan programs"
    if d["kind"] == "city":
        return f"{d['city']['name']}, WI"
    return d.get("about") or d["h1"]


def post_title(path):
    f = os.path.join(ROOT, path.lstrip("/"))
    m = re.search(r"<title>([^<]*)", open(f, encoding="utf-8").read())
    t = html.unescape(m.group(1)) if m else path
    return re.split(r"\s+[|—-]\s+(Refined|Ethan)", t)[0].strip()


def jsonld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "</script>"


def schema(d, by_path):
    url = BASE + d["path"]
    crumbs = [{"@type": "ListItem", "position": 1, "name": "Home", "item": BASE + "/"}]
    if d["kind"] != "hub":
        hub = by_path[f"/{d['section']}/"]
        crumbs.append({"@type": "ListItem", "position": 2, "name": short_name(hub), "item": BASE + hub["path"]})
    crumbs.append({"@type": "ListItem", "position": len(crumbs) + 1, "name": short_name(d), "item": url})
    page = {
        "@context": "https://schema.org", "@type": "WebPage", "@id": url + "#webpage", "url": url,
        "name": d["title"], "description": d["description"], "inLanguage": "en-US",
        "datePublished": UPDATED_ISO, "dateModified": UPDATED_ISO,
        "author": {"@id": PERSON_ID}, "publisher": {"@id": BUSINESS_ID},
        "breadcrumb": {"@type": "BreadcrumbList", "itemListElement": crumbs},
    }
    svc = {
        "@context": "https://schema.org", "@type": "Service", "@id": url + "#service",
        "name": d["h1"], "description": d["description"], "url": url,
        "serviceType": d.get("about") or "Residential mortgage lending",
        "provider": {"@type": ["MortgageBroker", "LocalBusiness"], "@id": BUSINESS_ID,
                     "name": "Refined Mortgage Group — Ethan Brooks Mortgage Team", "url": BASE + "/",
                     "telephone": "+1-414-488-0438"},
        "areaServed": ({"@type": "City", "name": d["city"]["name"],
                        "containedInPlace": {"@type": "AdministrativeArea", "name": d["city"]["county"] + ", Wisconsin"}}
                       if d.get("city") else {"@type": "State", "name": "Wisconsin"}),
    }
    faq = {"@context": "https://schema.org", "@type": "FAQPage", "@id": url + "#faq",
           "mainEntity": [{"@type": "Question", "name": q["q"],
                           "acceptedAnswer": {"@type": "Answer", "text": q["a"]}} for q in d["faqs"]]}
    return "\n".join(jsonld(x) for x in (page, svc, faq))


def nav():
    return f'''<div class="bar"><nav class="nav">
  <a href="/" class="logo"><img class="logo-mark" src="/images/logo-nav.png" alt="Refined Mortgage Group"><span>Refined<small>Mortgage Group</small></span></a>
  <ul class="nav-links">
    <li><a href="/loans/">Loans</a></li>
    <li><a href="/mortgage-lender/">Areas</a></li>
    <li><a href="/about">About</a></li>
    <li><a href="/resources/">Resources</a></li>
    <li><a href="/blog/">Blog</a></li>
  </ul>
  <div class="nav-cta"><a href="tel:4144880438" class="phone">414·488·0438</a><a href="{CAL}" class="btn btn-lime">Schedule a Call</a></div>
</nav></div>'''


def footer():
    f = open(os.path.join(ROOT, "scripts/_footer_base.html"), encoding="utf-8").read()
    f = re.sub(r'<div class="legal">.*?</div>', f'<div class="legal">{e(LEGAL)}</div>', f, flags=re.S)
    return f


def build(d, pages, by_path):
    url = BASE + d["path"]
    out = []
    out.append(f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e(d["title"])}</title>
<meta name="description" content="{e(d["description"])}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:title" content="{e(d["title"])}">
<meta property="og:description" content="{e(d["description"])}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/og-image.jpg">
<meta property="og:site_name" content="Refined Mortgage Group">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(d["title"])}">
<meta name="twitter:description" content="{e(d["description"])}">
<meta name="twitter:image" content="{BASE}/og-image.jpg">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,400..600&family=Hanken+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles/rmg-pages.css">
<link rel="stylesheet" href="/styles/rmg-local.css">
{schema(d, by_path)}
</head>
<body>
{nav()}
<div class="wrap">''')
    # breadcrumbs
    cr = ['<a href="/">Home</a>']
    if d["kind"] != "hub":
        hub = by_path[f"/{d['section']}/"]
        cr.append(f'<a href="{hub["path"]}">{e(short_name(hub))}</a>')
    cr.append(e(short_name(d)))
    out.append(f'  <nav class="crumbs" aria-label="Breadcrumb">{"<span>/</span>".join(cr)}</nav>')
    facts = "".join(f'<div class="fact"><b>{e(f["value"])}</b><span>{e(f["label"])}</span></div>' for f in d["quick_facts"])
    out.append(f'''  <header class="hero lp">
    <p class="eyebrow">{e(d["eyebrow"])}</p>
    <h1>{e(d["h1"])}</h1>
    <p class="lead">{e(d["lead"])}</p>
    <p class="byline"><b>Ethan Brooks</b> · Mortgage Advisor &amp; Branch Manager, NMLS #1639987 · Updated {UPDATED_TXT}</p>
    <div class="facts">{facts}</div>
    <div class="row"><a href="{CAL}" class="btn btn-lime">Book a 15-minute call</a><a href="tel:4144880438" class="btn btn-ghost">Call 414-488-0438</a></div>
  </header>''')
    out.append('  <div class="prose">')
    for i, s in enumerate(d["sections"]):
        out.append(f'    <section><h2>{e(s["h2"])}</h2>\n{s["html"]}\n    </section>')
        if i == 2:
            out.append(f'''  </div>
  <div class="midcta"><p>Want a straight answer for your situation?</p><div class="row"><a href="{CAL}" class="btn btn-lime">Book a call</a><a href="/#contact" class="btn btn-ghost">Send a message</a></div></div>
  <div class="prose">''')
    out.append('  </div>')
    # hub child grid
    if d["kind"] == "hub":
        kids = [p for p in pages if p["section"] == d["section"] and p["kind"] != "hub"]
        cards = "".join(f'<a href="{p["path"]}">{e(short_name(p))}<small>{e(p["eyebrow"])}</small></a>' for p in kids)
        label = "Cities I lend in most" if d["section"] == "mortgage-lender" else "Loan programs"
        out.append(f'  <section><div class="sec-head"><p class="eyebrow">{label}</p><h2>Pick your starting point.</h2></div><div class="linkgrid">{cards}</div></section>')
    # FAQ
    accs = "\n".join(f'    <details class="acc"><summary>{e(q["q"])}<span class="pl"></span></summary><div class="body">{e(q["a"])}</div></details>' for q in d["faqs"])
    out.append(f'  <section class="faqwrap"><div class="sec-head"><p class="eyebrow">FAQ</p><h2>Questions I hear most.</h2></div>\n{accs}\n  </section>')
    # related
    rel = "".join(f'<a href="{p}">{e(short_name(by_path[p]))}<small>{e(by_path[p]["eyebrow"])}</small></a>' for p in d["related_pages"] if p in by_path)
    posts = "".join(f'<li><a href="{p}">{e(post_title(p))}</a></li>' for p in d["related_posts"])
    out.append(f'  <section><div class="sec-head"><p class="eyebrow">Keep going</p><h2>Related guides.</h2></div><div class="linkgrid">{rel}</div><ul class="postlist">{posts}</ul></section>')
    if d.get("sources"):
        src = "".join(f'<li><a href="{e(s["url"])}" rel="nofollow noopener" target="_blank">{e(s["name"])}</a></li>' for s in d["sources"])
        out.append(f'  <div class="sources"><b>Sources</b> (checked {UPDATED_TXT}; program rules and limits change — confirm current terms before you rely on them)<ol>{src}</ol></div>')
    where = f"in {d['city']['name']}" if d.get("city") else "anywhere in Wisconsin"
    out.append(f'''  <section>
    <div class="cta">
      <p class="eyebrow" style="color:var(--brass-lt);justify-content:center">Let's get started</p>
      <h2>Buying {e(where)}? Let's map it out.</h2>
      <p>Book a 15-minute call. You'll get clear answers, the program that fits, and a team that moves fast — 450+ five-star Google reviews say we pick up the phone.</p>
      <div class="row"><a href="{CAL}" class="btn btn-lime">Book a 15-minute call</a><a href="{APPLY}" class="btn btn-ghost">Start your application</a></div>
    </div>
  </section>
</div>
{footer()}
<script>document.getElementById('yr').textContent=new Date().getFullYear();</script>
</body>
</html>
''')
    return "\n".join(out)


def main():
    pages = load()
    by_path = {p["path"]: p for p in pages}
    for d in pages:
        dest = os.path.join(ROOT, d["path"].lstrip("/"), "index.html")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "w", encoding="utf-8").write(build(d, pages, by_path))
        print("wrote", d["path"])
    return pages


if __name__ == "__main__":
    main()
