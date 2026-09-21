# MOMM discovery: controls, evidence and owner checks

## Public audit — 20 September 2026

- Host `https://marroccofella.github.io/robots.txt` returned HTTP 200 with `User-agent: *`, `Allow: /` and the host sitemap. No specific bot exclusions were present. This permits GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot and PerplexityBot; it does not prove they visited. No crawler-policy change was needed.
- The host sitemap includes the MOMM homepage. The project sitemap at `https://marroccofella.github.io/skills/sitemap.xml` returned HTTP 200 and lists the main guides and release notes.
- The homepage returned HTTP 200, a self-referencing canonical and `index,follow`, with no `X-Robots-Tag` restriction. Definitions, installation text and the written workflow are present in HTML without executing JavaScript or watching video.
- `/skills/momm/llms.txt` returned 404 before this change. The site renderer now generates this plain-text documentation from the current published version and links it from the homepage. A local test/build is not deployment evidence: verify the URL after publication.
- The new replacement film remains unapproved. This change does not remove preview restrictions or present an older film as a current-version demonstration.
- Google/Bing owner-side indexing records, real crawler visits, search performance and answer-engine citations have **not** been verified by this audit.

## Owner-side indexing checklist

1. Open [Google Search Console](https://search.google.com/search-console/) and [Bing Webmaster Tools](https://www.bing.com/webmasters/). Use the owner's account; do not share credentials with an agent. Confirm a verified property covering `https://marroccofella.github.io/skills/`. If absent, use an offered verification method such as an HTML file or tag; an agent may publish the exact supplied verification artifact after authorization, but cannot invent it.
2. Submit `https://marroccofella.github.io/skills/sitemap.xml`. Record submission date, processing result and any errors. Submission is not confirmation of indexing.
3. Inspect the homepage, `install.html`, `start.html`, `reference.html`, `evidence.html` and the current release page. Record indexed status, last crawl, restrictions and the engine-selected canonical. A live inspection tests present access; the indexed record establishes inclusion. Request indexing after substantive fixes, within the service's limits.
4. Keep any ownership files/tags in future deployments. Review search impressions, queries and clicks after the engines recrawl; do not diagnose failure from a single empty `site:` query.

## Answer-engine checks

Run dated, cold branded and unbranded questions such as "What is MOMM Mixture of Model Modality?" and "How can I get multiple AI tools to review a specification while keeping one agent in charge?" Do not supply the website URL for a discovery test. Separately supplying a URL tests retrieval, not discovery.

Record engine/product, date, locale, exact query, whether search was used, cited URLs and factual accuracy. Check for invented API-key setup, offline-only processing or universal modality support. Preserve a real answer/citation before claiming visibility. No saved answer-engine result is asserted here.

| Claim | Required evidence |
| --- | --- |
| Publicly accessible | Successful fetch of the actual published page |
| Crawling permitted | Applicable host robots rules plus page and response-header directives |
| Indexed | Owner-side Google/Bing indexing diagnostics |
| Appearing in search | Recorded results or impressions, queries and clicks |
| Cited by an answer engine | Saved answer citing the relevant URL |
| Useful discovery | Meaningful setup/usage outcomes, measured with appropriate consent |

`llms.txt` is optional reading material, not an indexing protocol. Bot-user-agent impersonation does not demonstrate a real crawler visit. Search inclusion and training permission are separate controls; allowing GPTBot training is not a prerequisite for ChatGPT search. No service can promise inclusion in all answer engines.

Sources: [Google AI search guidance](https://developers.google.com/search/docs/appearance/ai-features), [OpenAI crawler roles](https://developers.openai.com/api/docs/bots), [Google site-query limitations](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site), [Search Console ownership verification](https://support.google.com/webmasters/answer/9008080).
