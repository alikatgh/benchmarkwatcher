const { execSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = process.cwd();
const blockers = [];
const warnings = [];
let detectedApiUrl = null;

function addBlocker(message, fix) {
  blockers.push({ message, fix });
}

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
      addBlocker(
        `Placeholder value detected in ${filePath}`,
        detectedApiUrl
          ? `Run: npm run api:set -- ${detectedApiUrl}`
          : 'Run: npm run api:set -- https://YOUR_REAL_API_DOMAIN'
      );
      return;
    }
  }
}

function detectApiUrlFromEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return null;
  const content = readFileSync(envPath, 'utf8');
  const match = content.match(/^EXPO_PUBLIC_API_URL=(.+)$/m);
  if (!match) return null;
  const value = match[1].trim().replace(/^['"]|['"]$/g, '');
  if (!/^https:\/\//i.test(value)) return null;
  if (/your-api-domain\.example/i.test(value)) return null;
  return value;
}

console.log('=== Mobile Release Preflight ===');
detectedApiUrl = detectApiUrlFromEnv();

// 1) Build/test checks
if (!runCheck('TypeScript check', 'npx tsc --noEmit')) {
  addBlocker('TypeScript check failed', 'Run: npm run typecheck');
}
if (!runCheck('Jest test suite', 'npm run test:ci --silent')) {
  addBlocker('Test suite failed', 'Run: npm run test:ci');
}
if (!runCheck('Expo public config resolves', 'npx expo config --type public')) {
  addBlocker('Expo config failed to resolve', 'Run: npx expo config --type public');
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
    addBlocker(
      'EAS CLI is not logged in (developer publishing account)',
      'Run: npm run eas:login'
    );
    console.log('❌ EAS login status');
  } else {
    console.log(`✅ EAS login status (${whoami})`);
  }
} catch {
  addBlocker(
    'EAS CLI is not logged in (developer publishing account)',
    'Run: npm run eas:login'
  );
  console.log('❌ EAS login status');
}

console.log('\n=== Preflight Result ===');
if (warnings.length) {
  console.log('Warnings:');
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (blockers.length) {
  console.log('Blockers:');
  for (const blocker of blockers) {
    console.log(`- ${blocker.message}`);
    if (blocker.fix) console.log(`  Fix: ${blocker.fix}`);
  }
  console.log('\nNext steps:');
  if (detectedApiUrl) {
    console.log(`- Detected .env API URL: ${detectedApiUrl}`);
    console.log(`- Apply it everywhere: npm run api:set -- ${detectedApiUrl}`);
  } else {
    console.log('- Set production API URL in app.json/.env.example and EAS secret');
  }
  console.log('- Authenticate Expo maintainer account');
  console.log('- Re-run: npm run preflight:release');
  process.exitCode = 1;
} else {
  console.log('No blockers found. Ready for build/submit.');
}
