import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postcss from 'postcss';
import prefix from 'postcss-prefix-selector';

const scratch = await mkdtemp(path.join(tmpdir(), 'bw-reui-build-'));
try {
  const license = '/*! ReUI components and Nova styles\n' + await readFile('frontend/reui/LICENSE', 'utf8') + '\n*/';
  await build({
    entryPoints: ['frontend/reui/index.tsx'], bundle: true, minify: true,
    outfile: 'app/static/js/components/reui.js', target: ['es2022'],
    jsx: 'automatic', legalComments: 'eof', banner: { js: license }, define: { 'process.env.NODE_ENV': '"production"' },
  });
  const cssFile = path.join(scratch, 'reui.css');
  execFileSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'frontend/reui/styles.css', '-o', cssFile, '--minify'], { stdio: 'inherit' });
  const result = await postcss([{
    postcssPlugin: 'reui-island-layers',
    // Legacy Tailwind 3 is unlayered. Scoped v4 utilities must have equal cascade priority.
    AtRule: { layer(rule) { if (rule.nodes) rule.replaceWith(...rule.nodes); else rule.remove(); } },
  }, prefix({
    prefix: ':where(.reui)',
    // Theme variables are declared on each island, never the document root.
    transform(prefix, selector, prefixed) {
      if (selector === ':root' || selector === ':host') return prefix;
      if (selector.startsWith('.reui')) return selector;
      if (selector.startsWith('.style-nova')) return selector.replace('.style-nova', ':where(.reui).style-nova');
      return prefixed;
    },
  })]).process(await readFile(cssFile, 'utf8'), { from: undefined });
  await writeFile('app/static/css/reui.css', license + '\n' + result.css);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
