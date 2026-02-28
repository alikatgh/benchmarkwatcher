const { execSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = process.cwd();
const blockers = [];
const warnings = [];

function runCheck(label, cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log(`✅ ${label}`);
    return true;
  } catch (error) {
    console.log(`❌ ${label}`);
    const out = [error.stdout?.toString(), error.stderr?.toString()].filter(Boolean).join('\n').trim();
    if (out) console.log(out.split('\n').slice(0, 4).join('\n'));
    return false;
  }
}

function checkPlaceholders(filePath, patterns) {
  const abs = join(root, filePath);
  if (!existsSync(abs)) {
    warnings.push(`Missing file: ${filePath}`);
    return;
  }
  const content = readFileSync(abs, 'utf8');
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      blockers.push(`Placeholder value detected in ${filePath}`);
      return;
    }
  }
}

console.log('=== Mobile Release Preflight ===');

// 1) Build/test checks
if (!runCheck('TypeScript check', 'npx tsc --noEmit')) {
  blockers.push('TypeScript check failed');
}
if (!runCheck('Jest test suite', 'npm run test:ci --silent')) {
  blockers.push('Test suite failed');
}
if (!runCheck('Expo public config resolves', 'npx expo config --type public')) {
  blockers.push('Expo config failed to resolve');
}

// 2) Placeholder checks
checkPlaceholders('app.json', [/your-api-domain\.example/i]);
checkPlaceholders('.env.example', [/your-api-domain\.example/i]);
checkPlaceholders('APP_STORE_METADATA_TEMPLATE.md', [/your-domain\.example/i]);
checkPlaceholders('PLAY_STORE_METADATA_TEMPLATE.md', [/your-domain\.example/i, /support@your-domain\.example/i]);

// 3) Expo auth check (developer-side)
try {
  const whoami = execSync('npx eas whoami', { stdio: 'pipe' }).toString().trim();
  if (!whoami || /not logged in/i.test(whoami)) {
    blockers.push('EAS CLI is not logged in (developer publishing account)');
    console.log('❌ EAS login status');
  } else {
    console.log(`✅ EAS login status (${whoami})`);
  }
} catch {
  blockers.push('EAS CLI is not logged in (developer publishing account)');
  console.log('❌ EAS login status');
}

console.log('\n=== Preflight Result ===');
if (warnings.length) {
  console.log('Warnings:');
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (blockers.length) {
  console.log('Blockers:');
  for (const blocker of blockers) console.log(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log('No blockers found. Ready for build/submit.');
}
