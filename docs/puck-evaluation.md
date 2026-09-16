# Puck evaluation for vorti-blog

Evaluated on 2026-09-16 in a separate native Ubuntu clone. No Puck package is installed in the deployable repository.

- Tested `@delmaredigital/payload-puck` 0.9.2 with `@puckeditor/core` 0.23.0, Payload 3.87.0, Next 16.3.3, React 19.2.6, and Node 22.16.0. The integration's declared direct peer ranges accept these versions, but its dependency `react-from-json` 0.8.0 declares React and React DOM support only through 18. pnpm reported both peer mismatches.
- Registering Puck before the existing official SEO plugin caused `DuplicateFieldName: meta`. Registering Puck after SEO avoided the duplicate because Puck detects the existing field.
- With that order, Payload type generation, import-map generation, TypeScript, the Next build, the OpenNext Worker build, and a Wrangler deployment dry run passed. The dry run reported a gzip upload of about 4.1 MiB.
- These checks did not establish that the visual editor works in a Cloudflare Worker with D1, the existing Nested Docs page hierarchy, and the production admin session. No such runtime test was performed.
- The package is actively maintained. Versions before 0.6.23 had a [critical built-in API access-control vulnerability](https://github.com/advisories/GHSA-65w6-pf7x-5g85), and versions before 0.9.0 had a [high-severity standalone route access-control vulnerability](https://github.com/delmaredigital/payload-puck/security/advisories/GHSA-957g-hmmp-rchg). Both advisories say 0.9.2 is patched.

Decision: defer production installation. The unresolved React 19 peer mismatch and the absence of a proven editor runtime path on this Cloudflare/D1 stack do not satisfy the requirement to install Puck only when compatible and safe. Keep Pages' current rich-text editor and Nested Docs behavior. Revisit Puck after its transitive React peer range is corrected and an isolated Worker preview proves authenticated editing, published rendering, D1 persistence, and SEO/Nested Docs coexistence.

Sources: [npm package](https://www.npmjs.com/package/%40delmaredigital/payload-puck), [plugin repository](https://github.com/delmaredigital/payload-puck), [Puck editor](https://www.npmjs.com/package/%40puckeditor/core).
