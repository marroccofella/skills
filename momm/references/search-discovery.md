# Public-page search and answer-engine checks

The public MOMM guide is static HTML on the existing GitHub Pages site. Search
titles, descriptions, canonical URLs and structured page information are produced
by `scripts/momm-site-search.mjs`, through the normal public renderer. All version
notes receive their own identity and cite their source; current software identity
comes from the version manifest. Historical evidence is not relabeled current.

The overview defines MOMM directly. The reference page has visible, linked answers
about reviewers, privacy, costs, setup, dashboards and the limits of agreement.
These are ordinary content for people and crawlers, not hidden instructions to an
answer engine. SoftwareSourceCode, WebPage and BreadcrumbList information describes
the page, with no invented ratings, free-provider claims or unpublished VideoObject.

## Before publication

The homepage now contains three approved films with playable poster thumbnails:
`watch/overview.html`, `watch/setup.html` and `watch/trailer.html`. Each has its own
caption file, transcript, poster, VideoObject and share links. Check all three
watch pages and both sitemaps before publishing, and verify each live media hash
after deployment. Chapter thumbnails seek inside the homepage introduction.
The separate multi-voice ledger film is not published; its audio gate remains open.

Run the public renderer and `node scripts/check-momm-site.mjs`. The search tests
check all generated guides and version pages for unique titles/descriptions,
canonical URLs in the sitemap, parseable structured information, visible answer
content and safe escaping. They also check repeat rendering of the public ledger.
Keep privacy scans, MOMM review and the existing OS/Node matrix as separate gates.

After publication, fetch the live pages, metadata and sitemap and compare them to
the tested files. An HTTP 200 and valid markup are technical checks, not proof that
a search engine has indexed or cited the site.

## Crawler policy and measurement

The effective robots file is at the origin root:
`https://marroccofella.github.io/robots.txt`. A file at `/skills/robots.txt` cannot
set policy for this origin. Do not create a misleading project-level substitute,
change training permissions, or alter another repository's root policy as part of
a documentation update. Read the live root policy before claiming crawling is
allowed. The project sitemap is at `https://marroccofella.github.io/skills/sitemap.xml`.
Its canonical locations are deterministic; unverified last-modified dates are
omitted rather than replaced with a build time or the historical data date.

An authorized site owner can submit that sitemap through Google Search Console
and Bing Webmaster Tools and inspect actual indexing, search queries, clicks and
AI citation reports where available. These account actions are not performed by
the renderer, and no analytics or tracking is added to the public site.

Do not promise rankings, rich results or answer-engine citations. Do not treat an
`llms.txt` file or special "AEO" schema as a search requirement. Keep definitions,
source links, visible evidence limitations and current-version claims consistent.

## Attribution and claim register

The site owner requested a Promptus credit and Dominic Marrocco background.
The public wording deliberately distinguishes the optional Promptus voice
workflow from the portable CLI review engine. The factual owner is Dominic
Marrocco; the page maintainer must recheck the linked sources and generated data
when changing a claim. A backlink is attribution, not an independent endorsement.

| Claim | Supported wording and source | Verification / limitation |
| --- | --- | --- |
| Promptus relationship | Local voice workflows powered by [Promptus](https://www.promptus.ai/); project alongside Marrocco's Promptus work, as identified by the owner | The local narration workflow uses Promptus/F5. Do not imply the reviewer CLIs require a Promptus backend. |
| Technology commercialisation expertise | [A 2016 Equiinet announcement in Nevada Business](https://nevadabusiness.com/2016/08/equiinet-chairman-address-roundtable-local-innovation-future-las-vegas-tech/) described Marrocco as a serial entrepreneur and professor of technology commercialisation at Peking University | Company announcement, not independent confirmation of a present appointment. Keep the date and attribution. |
| Practical entrepreneurship background | [UNLV's 2014 account](https://www.unlv.edu/news/release/unlv-engineering-students-take-top-prize-2014-southern-nevada-business-plan) describes engineering students developing a drone business through the competition bearing his name | University account of that event; not evidence of an endorsement of MOMM or a claim he developed the drone. |
| Two-year MOMM history | Awaiting owner clarification and a dated prototype, announcement or other primary record | Portable predecessor release history begins on 17 August 2026. The Promptus MoMM article's search listing and live page have conflicting dates; neither establishes a two-year project history. Do not state an origin year until resolved. |
| Improvements from review | Generated development snapshot: [current recorded counts and denominators](../../docs/momm/data/public-stats.json) | Recompute from the sanitized export. Counts are governor decisions, not unique bugs, independently confirmed fixes, users or a controlled accuracy measurement. The page reads these values from the renderer's statistics. |
| Benefit versus AI alone | Potential additional defects found, unsupported advice filtered and an inspectable record | No controlled AI-alone versus AI-plus-MOMM comparison is included. Do not promise a percentage accuracy, productivity, cost or ROI improvement. |

The sources were checked on 13 September 2026. Preserve historical dates rather
than presenting them as current affiliations. The evidence page includes a
comparison-study outline so future benefit claims can be supported by actual
task outcomes, sample sizes, costs and uncertainty, not reviewer confidence.

## Approved video discovery and sharing

The accepted film has a dedicated [watch page](../../docs/momm/watch/overview.html), full visible transcript, timed Clip links, an approved-file hash gate and a downloadable caption MediaObject. The main sitemap contains its video entry; the dedicated [video sitemap](../../docs/video-sitemap.xml) is also available for video-only tooling. Both are generated from the same manifest. Share controls require user actions and add no tracking. Blocking clipboard access reveals a selectable link rather than claiming it was copied. Publishing markup does not establish indexing, virality or improved ranking.

## Primary guidance

- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: structured data and visible content](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
- [Google: root robots.txt scope](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)
- [Bing webmaster guidelines](https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a)
- [Bing: AI performance reports](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)
