# Site Template rendering

The public root layout reads Site Settings and Navigation once per render request. `Site Settings.defaultSiteTemplate` is the only assignment source. The resolver separately queries that ID through public collection access with `_status = published`. Draft, missing, inaccessible, invalid, and unreadable templates use the compatibility header and footer.

CSS order is the existing frontend stylesheet, compiled Site Template tokens and responsive node rules, then validated Additional CSS. Additional CSS is emitted last and rejects `@import`, closing style tags, and oversized input. The renderer never evaluates scripts or raw HTML.

Header `sticky` positioning is supported. Stored `fixed` positioning remains static because the renderer cannot infer a safe content offset from arbitrary responsive shell content. Search and unresolvable image/button references are omitted. Preview and draft mode shell rendering remain deferred.
