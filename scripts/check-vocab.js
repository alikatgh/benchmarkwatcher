#!/usr/bin/env node
/**
 * scripts/check-vocab.js
 * 
 * Scans UI template files for forbidden terms defined in docs/ui-vocabulary.md
 * Focuses on templates (HTML/Jinja) which contain actual user-facing text
 * 
 * Usage: node scripts/check-vocab.js [--fail-on-warn] [--all]
 *   --fail-on-warn: Exit with error code if violations found
 *   --all: Scan all files, not just templates
 * 
 * Exits with non-zero code if forbidden terms are found (in CI or with --fail-on-warn)
 */

const fs = require('fs');
const path = require('path');

// Forbidden terms for UI text - from docs/ui-vocabulary.md
// Note: 'return' is excluded since it's rarely UI-facing and causes many false positives
const FORBIDDEN_UI = [
    'performance',
    'trend',
    'signal',
    'forecast',
    'prediction',
    'outperform',
    'underperform',
    'recommend',
    'suggest',
    'profit',
    'loss'
];

// Files/patterns to always skip (e.g., this script itself, vocabulary doc)
const SKIP_FILES = [
    'scripts/check-vocab.js',
    'docs/ui-vocabulary.md',
    'docs/vocab-allowlist.txt',
    'tests/e2e/disclaimer-safety.spec.ts',
    '__tests__/commodity.test.js'
];

// Directories to ignore
const IGNORE_DIRS = ['node_modules', 'dist', 'build', '.git', 'venv', '__pycache__', '.pytest_cache'];

// File extensions to check
const CHECK_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.html', '.jinja', '.jinja2', '.md', '.py'];

// Build word-boundary regex (case-insensitive)
const pattern = new RegExp(
    `\\b(${FORBIDDEN_UI.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi'
);

const ROOT = process.cwd();
const matches = [];

// Load allowlist if exists
let allowlist = [];
const allowlistPath = path.join(ROOT, 'docs', 'vocab-allowlist.txt');
if (fs.existsSync(allowlistPath)) {
    allowlist = fs.readFileSync(allowlistPath, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
}

function shouldSkip(relativePath) {
    // Check explicit skip list
    if (SKIP_FILES.some(skip => relativePath.includes(skip))) return true;
    // Check allowlist
    if (allowlist.some(allowed => relativePath.includes(allowed))) return true;
    // Check ignored directories
    if (IGNORE_DIRS.some(dir => relativePath.includes(`/${dir}/`) || relativePath.startsWith(`${dir}/`))) return true;
    return false;
}

function walkDir(dir) {
    let results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(ROOT, fullPath);

            if (entry.isDirectory()) {
                if (!IGNORE_DIRS.includes(entry.name)) {
                    results = results.concat(walkDir(fullPath));
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (CHECK_EXTENSIONS.includes(ext) && !shouldSkip(relativePath)) {
                    results.push({ fullPath, relativePath });
                }
            }
        }
    } catch (e) {
        // Ignore permission errors
    }
    return results;
}

// Scan files
const files = walkDir(ROOT);
files.forEach(({ fullPath, relativePath }) => {
    let text;
    try {
        text = fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
        return;
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
        const lineMatches = line.match(pattern);
        if (lineMatches) {
            matches.push({
                file: relativePath,
                line: i + 1,
                terms: [...new Set(lineMatches.map(m => m.toLowerCase()))],
                context: line.trim().substring(0, 100)
            });
        }
    });
});

// Output results
if (matches.length === 0) {
    console.log('✅ Vocabulary check passed — no forbidden terms found.');
    process.exit(0);
}

console.error(`\n🚨 Vocabulary check found ${matches.length} violation(s):\n`);
matches.forEach(m => {
    console.error(`  ${m.file}:${m.line}`);
    console.error(`    Terms: ${m.terms.join(', ')}`);
    console.error(`    Context: ${m.context}\n`);
});
console.error('See docs/ui-vocabulary.md for allowed/forbidden terms.\n');

const failOnWarn = process.argv.includes('--fail-on-warn') || process.env.CI === 'true';
process.exit(failOnWarn ? 2 : 0);
