# Unreleased

<!-- One line per change a user would notice. Moved into docs/releases/<version>.md on release. -->

- Website citations now open the page scrolled to the cited passage and highlight it, in Ask Knot's sources and in saved source blocks ("Open passage"), in browsers that support text links.
- Website citations point to the sentence an answer used, not the whole section: Ask Knot's sources show that sentence (with the full passage a click away), saved source blocks highlight it, and passage links open the site at it.
- Ask Knot can now read websites that build their pages with JavaScript, including addresses with #/ routes, by loading them in a hidden page first.
- Note banners laid out as tables on websites (like "This tutorial needs a review") are captured as plain text, and table cells no longer carry the page's source line breaks.
- Website captures read more cleanly: Wikipedia captions and notes stay whole instead of splitting at every link, [edit] links and category footers are gone, w3schools code examples stay together, and tutorials with demo password fields are no longer mistaken for sign-in pages.
- Ask Knot can read PDF links: paste a link to a PDF (up to 10 MiB) and it reads the text, cites the page, and opens citations at that page.
