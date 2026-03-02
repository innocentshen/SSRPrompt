import { test, expect } from 'playwright/test';

test('smoke open app', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await expect(page).toHaveURL(/127\.0\.0\.1:5173/);
});
