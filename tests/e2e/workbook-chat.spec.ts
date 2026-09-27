import { test, expect, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const question = 'Show Operating Income across the available periods.';
const dock = (page: Page) => page.getByRole('complementary', { name: 'Workbook AI chat' });

async function openWorkbook(page: Page) {
  await page.goto('/workspace/register');
  await page.getByLabel('Username', { exact: true }).fill(`chat-${randomUUID().slice(0, 8)}`);
  await page.locator('#password').fill('synthetic browser test password');
  await page.getByRole('button', { name: 'Create private workspace' }).click();
  await page.getByRole('link', { name: 'Continue to workspace' }).click();
  await expect(dock(page)).toBeVisible();
  await page.getByRole('button', { name: 'Minimize AI chat' }).click();
  await expect(page.getByRole('button', { name: 'Open AI chat' })).toBeVisible();
  await page.locator('.workspace-nav').getByRole('link', { name: 'AI settings' }).click();
  for (const provider of ['typesafe', 'deepseek']) {
    const form = page.locator(`form:has(#key-${provider})`);
    await form.locator('input[type=password]').fill(`fixture-${provider}-key`);
    await form.locator('input[type=checkbox]').check();
    await form.getByRole('button', { name: 'Test and save key' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Connection tested.' })).toBeVisible();
  }
  await page.locator('.workspace-nav').getByRole('link', { name: 'Workbook studio' }).click();
  await page.locator('.workbook-list').getByRole('link', { name: /Sample Company/ }).click();
  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await expect(dock(page)).toBeVisible();
}

async function expectConversationRail(page: Page) {
  await expect(dock(page)).toBeInViewport();
  await expect(dock(page)).toHaveCSS('position', 'fixed');
  const viewport = page.viewportSize()!;
  const box = (await dock(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(viewport.width - box.x - box.width).toBeLessThanOrEqual(1);
  expect(viewport.height - box.y - box.height).toBeLessThanOrEqual(1);
  expect(box.y).toBeLessThanOrEqual(80);
  expect(box.height).toBeGreaterThan(viewport.height - 81);
  await expect(dock(page).getByRole('button', { name: 'Send and save' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ context, baseURL }) => {
  // No third-party requests or real provider usage, even if a page regresses.
  await context.route('**/*', route => new URL(route.request().url()).origin === baseURL
    ? route.continue() : route.abort());
});

test('AI answer keeps its chat through saved analysis, navigation, refresh, and intentional minimize', async ({ page }, testInfo) => {
  await openWorkbook(page);
  const modelURL = page.url();
  await dock(page).getByRole('button', { name: question, exact: true }).click();
  await expect(dock(page).getByLabel('Your question', { exact: true })).toHaveValue(question);
  await dock(page).locator('.studio-chat-options > summary').click();
  await dock(page).locator('#provider-model').selectOption('typesafe:jev-latest');
  await dock(page).locator('[name=consent]').check();
  await dock(page).getByRole('button', { name: 'Send and save' }).click();
  await expect(page).toHaveURL(/\/workspace\/analyses\//);
  const analysisURL = page.url();
  const table = page.getByRole('region', { name: 'Calculated values and source cells' });
  await expect(table.getByRole('row').filter({ hasText: 'Q124' })).toContainText('10.00');
  await expect(table).toContainText('Model!C3');
  // This is the original failure: the result page dropped the chat entirely.
  await expect(dock(page)).toBeVisible();
  await expectConversationRail(page);
  await expect(dock(page).locator('form')).toHaveAttribute('action', new URL(modelURL).pathname);
  await page.reload();
  await expect(dock(page).getByLabel('Your question', { exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expectConversationRail(page);
  await page.screenshot({ path: testInfo.outputPath('analysis-chat.png') });

  const toggle = page.getByRole('button', { name: 'Minimize AI chat' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Open AI chat' })).toHaveAttribute('aria-expanded', 'false');
  await expect(dock(page).getByLabel('Your question', { exact: true })).toBeHidden();
  await page.locator('.workspace-nav').getByRole('link', { name: 'Workbook studio' }).click();
  await expect(page.getByRole('button', { name: 'Open AI chat' })).toBeVisible();
  await page.reload();
  await expect(dock(page).getByLabel('Your question', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await expect(dock(page).getByLabel('Your question', { exact: true })).toBeFocused();
  await expect(dock(page).locator('form')).toHaveAttribute('action', new URL(modelURL).pathname);
  await page.getByRole('button', { name: 'Minimize AI chat' }).click();
  await page.locator('.workspace-nav').getByRole('link', { name: 'AI settings' }).click();
  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await expect(dock(page).getByLabel('Your question', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(dock(page).getByLabel('Your question', { exact: true })).toBeVisible();
  await page.goto(analysisURL);
  await expect(table).toContainText('Model!C3');
  await expect(dock(page).getByLabel('Your question', { exact: true })).toBeVisible();
});

test('Jev selection and a DeepSeek explanation work together, including a follow-up from the result', async ({ page }, testInfo) => {
  await openWorkbook(page);
  await dock(page).getByLabel('Your question', { exact: true }).fill(question);
  await dock(page).locator('.studio-chat-options > summary').click();
  await dock(page).locator('#provider-model').selectOption('typesafe:jev-latest');
  await dock(page).getByLabel('Add a DeepSeek explanation', { exact: false }).check();
  await dock(page).getByLabel('Explanation model', { exact: true }).selectOption('fixture-chat');
  await dock(page).locator('[name=consent]').check();
  await dock(page).getByRole('button', { name: 'Send and save' }).click();
  await expect(page).toHaveURL(/\/workspace\/analyses\//);
  const log = dock(page).getByRole('log', { name: 'Workbook conversation' });
  await expect(log.getByLabel('Your message', { exact: true })).toContainText(question);
  await expect(log.locator('.explanation')).toContainText('10 (Model!C3) and 15 (Model!D3)');
  await expect(page.locator('.workspace > section.workspace-panel .explanation')).toHaveCount(0);
  await expectConversationRail(page);
  const composerBefore = await dock(page).getByLabel('Your question', { exact: true }).boundingBox();
  await log.evaluate(el => { el.scrollTop = 0; });
  const pageScrollBefore = await page.evaluate(() => scrollY);
  await log.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => log.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageScrollBefore);
  expect((await dock(page).getByLabel('Your question', { exact: true }).boundingBox())!.y).toBe(composerBefore!.y);
  await page.screenshot({ path: testInfo.outputPath('conversation-explanation.png') });
  await page.reload();
  await expect(log.locator('.explanation')).toContainText('10 (Model!C3) and 15 (Model!D3)');
  const firstURL = page.url();
  await dock(page).getByLabel('Your question', { exact: true }).fill(question);
  await dock(page).locator('.studio-chat-options > summary').click();
  await expect(dock(page).getByLabel('Add a DeepSeek explanation', { exact: false })).toBeChecked();
  await dock(page).getByLabel('Add a DeepSeek explanation', { exact: false }).uncheck();
  await dock(page).locator('#provider-model').selectOption('deepseek:fixture-chat');
  await dock(page).locator('[name=consent]').check();
  await dock(page).getByRole('button', { name: 'Send and save' }).click();
  await expect(page).not.toHaveURL(firstURL);
  await expect(log.getByLabel('Your message', { exact: true })).toHaveCount(2);
  await expect(log.getByLabel('AI response', { exact: true })).toHaveCount(2);
  await expect(log.locator('.explanation')).toContainText('10 (Model!C3)');
  await expect(page).toHaveURL(/\/workspace\/analyses\//);
  await expect(dock(page)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Calculated values and source cells' })).toContainText('Model!C3');
});

test('unsupported questions retain the draft and a usable chat with feedback in Notifications', async ({ page }) => {
  await openWorkbook(page);
  await dock(page).getByLabel('Your question', { exact: true }).fill('Are earnings good?');
  await dock(page).locator('.studio-chat-options > summary').click();
  await dock(page).locator('#provider-model').selectOption('typesafe:jev-latest');
  await dock(page).locator('[name=consent]').check();
  await dock(page).getByRole('button', { name: 'Send and save' }).click();
  await expect(page.locator('.workspace-notifications').getByRole('alert')).toContainText('Ask for one metric');
  await expect(dock(page).getByRole('log')).toContainText('Ask for one metric');
  await expect(dock(page).getByLabel('Your question', { exact: true })).toHaveValue('Are earnings good?');
  await expect(dock(page).getByRole('button', { name: 'Send and save' })).toBeEnabled();
});
