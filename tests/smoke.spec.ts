import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Landing Page Smoke Tests', () => {

  test('1. Page loads with HTTP 200', async ({ request }) => {
    const response = await request.get(BASE_URL);
    expect(response.status()).toBe(200);
  });

  test('2. Hero section is visible', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const hero = page.locator(
      'section[data-testid="hero"], #hero, .hero, [class*="hero"], h1'
    ).first();
    await expect(hero).toBeVisible();
  });

  test('3. Primary CTA button is present and clickable', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const cta = page.locator(
      'button[data-testid="cta"], a[data-testid="cta"], .cta, [class*="cta"], button[type="submit"], a[href*="sign"], a[href*="get-started"], a[href*="start"], button'
    ).first();
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
    // Verify it is clickable without navigation errors
    await cta.click({ trial: true });
  });

  test('4. No console errors on load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const criticalErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('net::ERR_ABORTED')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('5. Mobile viewport renders without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const bodyScrollWidth = await page.evaluate(
      () => document.body.scrollWidth
    );
    const viewportWidth = await page.evaluate(
      () => window.innerWidth
    );
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test('6. All internal links resolve without 404', async ({ page, request }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const links = await page.$$eval('a[href]', (anchors) =>
      anchors
        .map((a) => (a as HTMLAnchorElement).href)
        .filter(
          (href) =>
            href &&
            !href.startsWith('mailto:') &&
            !href.startsWith('tel:') &&
            !href.startsWith('javascript:') &&
            !href.includes('#')
        )
    );
    const internalLinks = [...new Set(links)].filter((href) =>
      href.startsWith(BASE_URL)
    );
    if (internalLinks.length === 0) {
      console.warn('No internal links found on the page.');
    }
    for (const link of internalLinks) {
      const response = await request.get(link);
      expect(
        response.status(),
        `Expected 200 but got ${response.status()} for ${link}`
      ).not.toBe(404);
    }
  });

  test('7. Health API endpoint returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/health`);
    expect(response.status()).toBe(200);
  });

});
