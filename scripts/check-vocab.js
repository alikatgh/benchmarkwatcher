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
const IGNORE_DIRS = [
    'node_modules',
    'dist',
    'build',
    '.git',
    'venv',
    '.venv',
    '__pycache__',
    '.pytest_cache',
    'playwright-report',
    'test-results',
    'coverage'
];

// File extensions to check
const CHECK_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.html', '.jinja', '.jinja2', '.md', '.py'];

// Default scan scope: user-facing web/mobile sources. Use --all for a broad repo scan.
const DEFAULT_SCAN_PATHS = [
    'app/templates',
    'app/static/js',
    'mobile/App.tsx',
    'mobile/app.json',
    'mobile/components',
    'mobile/context',
    'mobile/data',
    'mobile/hooks',
    'mobile/screen',
    'product_copy.md'
];

// Build word-boundary regex (case-insensitive)
const pattern = new RegExp(
    `\\b(${FORBIDDEN_UI.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi'
);

const ROOT = process.cwd();
const matches = [];
const scanAll = process.argv.includes('--all');

function normalizePath(filePath) {
    return filePath.split(path.sep).join('/');
}

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
    const normalizedPath = normalizePath(relativePath);
    // Check explicit skip list
    if (SKIP_FILES.some(skip => normalizedPath.includes(skip))) return true;
    // Check allowlist
    if (allowlist.some(allowed => normalizedPath.includes(normalizePath(allowed)))) return true;
    // Check ignored directories
    if (IGNORE_DIRS.some(dir => normalizedPath.includes(`/${dir}/`) || normalizedPath.startsWith(`${dir}/`))) return true;
    return false;
}

function shouldScan(relativePath) {
    if (scanAll) return true;
    const normalizedPath = normalizePath(relativePath);
    return DEFAULT_SCAN_PATHS.some(target => (
        normalizedPath === target || normalizedPath.startsWith(`${target}/`)
    ));
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
                if (CHECK_EXTENSIONS.includes(ext) && shouldScan(relativePath) && !shouldSkip(relativePath)) {
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
