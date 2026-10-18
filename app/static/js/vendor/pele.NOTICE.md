# Pele 1.6.0

`pele.v1.6.0.min.js` is the unmodified browser-global build from the published
[`pele@1.6.0`](https://www.npmjs.com/package/pele/v/1.6.0) package
(`package/dist/pele.global.js`). Source: <https://github.com/obsidianmd/pele>.
The MIT license and included Lucide icon notice are in `pele.LICENSE`.

The npm archive was checked against the registry's SHA-512 integrity value before
the two files were extracted. SHA-256 of the browser build:
`b82d1bcd435302779a945e1e0f4a54ea56fb26e010ce3f2122f4216fcfc095d7`.

Pele enhances source and methodology flows. Existing numerical charts,
sparklines, comparisons, maps and graphic exports continue to use D3.
`core/diagrams.js` loads this local build only when a diagram disclosure opens;
there are no CDN requests or provider calls. It accepts short structured stage
labels, never raw Mermaid or author-supplied render options. The server-rendered
ordered steps remain available to assistive technology and when rendering fails.
