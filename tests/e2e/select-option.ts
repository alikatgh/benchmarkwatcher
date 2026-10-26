import { expect, type Locator } from '@playwright/test';

/** Exercise the visible picker while retaining native fields as value oracles. */
export async function selectOption(select: Locator, value: string) {
  const page = select.page();
  await expect(page.locator('html')).toHaveAttribute('data-reui', 'ready');
  if (await select.getAttribute('data-reui-enhanced') !== 'true') {
    await select.selectOption(value);
    return;
  }
  const label = await select.evaluate((element, chosen) =>
    [...(element as HTMLSelectElement).options].find(option => option.value === chosen)?.text, value);
  expect(label, `Option ${value} exists in the source field`).toBeTruthy();
  const trigger = select.locator('xpath=following-sibling::*[1]').getByRole('combobox');
  await trigger.click();
  await page.getByRole('option', { name: label!, exact: true }).click();
  await expect(select).toHaveValue(value);
  await expect(trigger).toContainText(label!);
}

/** The native field stays hidden after enhancement; geometry belongs to its trigger. */
export function selectTrigger(select: Locator) {
  return select.locator('xpath=following-sibling::*[1]').getByRole('combobox');
}
