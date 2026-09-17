import { test, expect } from '@playwright/test';
import { cases } from './adversarial-cases.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
});

test('configured item limit admits its boundary and rejects the next item', async ({ page }) => {
  for (const [limit, accepted] of [[10001, true], [10000, false], [0, false], [-1, false], [1.5, false], ['20000', false]]) {
    await page.evaluate(async limit => {
      await window.pureref.mountComponent('adv-item-limit.pur', { pur_item_limit: limit });
      window.componentTest.start();
      window.componentTest.resolve(0);
    }, limit);
    if (accepted) {
      await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
      await expect(page.locator('[data-item-id]')).toHaveCount(10001);
    } else {
      await expect(page.locator('.pureref-error')).toContainText('10,000 items');
    }
    await page.evaluate(() => window.componentTest.close());
  }
  await page.evaluate(async () => {
    await window.pureref.mountComponent('two-images.pur', { pur_item_limit: 1 });
    window.componentTest.start();
    window.componentTest.resolve(0);
  });
  await expect(page.locator('.pureref-error')).toContainText('1 items');
});

for (const entry of cases) {
  test(`${entry.name}: ${entry.title}`, async ({ page }, testInfo) => {
    await testInfo.attach('Inspection contract', { body: entry.check, contentType: 'text/plain' });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://example.invalid/**', route => {
      requests.push(route.request().url());
      return route.abort();
    });
    // Real bytes -> pinned reader -> plugin component, including its error UI.
    await page.evaluate(async name => {
      await window.pureref.mountComponent(`adv-${name}.pur`);
      window.componentTest.start();
      window.componentTest.resolve(0);
    }, entry.name);
    if (entry.error) {
      await expect(page.locator('.pureref-error')).toBeVisible();
      if (typeof entry.error === 'string')
        await expect(page.locator('.pureref-error')).toContainText(entry.error);
      expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
    } else {
      await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
      await expect(page.locator('svg image')).toHaveCount(entry.images);
      await expect(page.locator('svg foreignObject')).toHaveCount(entry.notes);
      const geometry = await page.locator('.pureref-viewport > svg').evaluate(svg => {
        const box = svg.getAttribute('viewBox').split(/\s+/).map(Number);
        const bad = [...svg.querySelectorAll('*')].flatMap(el => [...el.attributes])
          .filter(a => /(?:NaN|Infinity)/.test(a.value)).map(a => `${a.name}=${a.value}`);
        return { box, bad };
      });
      expect(geometry.box.every(Number.isFinite)).toBe(true);
      expect(geometry.box[2]).toBeGreaterThan(0);
      expect(geometry.box[3]).toBeGreaterThan(0);
      expect(geometry.bad).toEqual([]);
      if (entry.name === 'graph' || entry.name === 'resources')
        await expect(page.locator('.pureref-note')).toContainText('SURVIVOR');
      if (entry.name === 'graph') {
        // Text presence and Playwright visibility don't detect SVG siblings
        // painting over a note. Check the actual hit target at its centre.
        const note = page.locator('.pureref-note');
        await note.scrollIntoViewIfNeeded();
        expect(await note.evaluate(el => {
          const box = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        })).toBe(true);
        await expect(page.locator('.pureref-group-background')).toHaveCount(0);
      }
      if (entry.name === 'typography') {
        expect(await page.locator('foreignObject').evaluateAll(nodes => nodes.every(node =>
          Number(node.getAttribute('height')) > 12 &&
          node.firstElementChild.scrollHeight <= Number(node.getAttribute('height')) + 1))).toBe(true);
      }
      if (entry.name === 'hostile-note') {
        await expect(page.locator('.pureref-note').last()).toContainText('VISIBLE SAFE TEXT');
        await expect(page.locator('foreignObject').locator('script,img,iframe,object,video,source,svg,style,a,form,input,button,[onclick]')).toHaveCount(0);
        expect(await page.evaluate(() => window.purerefPwned)).toBeUndefined();
      }
      if (entry.name === 'shared-400')
        expect(await page.evaluate(() => window.pureref.urls())).toBe(1);
      const viewport = page.locator('.pureref-viewport');
      if (entry.name === 'geometry') {
        for (let index = 0; index < 3; index++) {
          await viewport.press('ArrowRight');
          // Independent screen-space check: all four crop corners, composed
          // through nested rotation, reflection and nonuniform scale.
          await expect.poll(() => page.locator('svg image').nth(index).evaluate(image => {
            const group = image.closest('g[data-bounds]');
            const b = JSON.parse(group.dataset.bounds), m = group.getScreenCTM();
            const points = [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]
              .map(([x,y]) => new DOMPoint(x,y).matrixTransform(m));
            const xs = points.map(p => p.x), ys = points.map(p => p.y);
            const left = Math.min(...xs), right = Math.max(...xs);
            const top = Math.min(...ys), bottom = Math.max(...ys);
            const v = image.closest('.pureref-viewport').getBoundingClientRect();
            return Math.abs((left+right)/2 - (v.x+v.width/2)) < 1 &&
              Math.abs((top+bottom)/2 - (v.y+v.height/2)) < 1 &&
              Math.abs(Math.max((right-left)/v.width, (bottom-top)/v.height)-1) < .01;
          })).toBe(true);
        }
      }
      await viewport.press('+');
      await viewport.press('ArrowRight');
      await viewport.press('f');
      expect(await page.evaluate(() => window.componentTest.state().scale)).toBe(1);
    }
    // Every case must recover, remove its listeners, and release URLs.
    await page.evaluate(() => window.componentTest.close());
    expect(await page.evaluate(() => window.componentTest.activeListeners())).toBe(0);
    expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
    await page.evaluate(() => window.pureref.load('two-images.pur'));
    await expect(page.locator('svg image')).toHaveCount(2);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('failure racing a replacement cannot erase the replacement or resurrect after close', async ({ page }) => {
  await page.evaluate(async () => {
    await window.pureref.mountComponent();
    window.componentTest.start();
    window.componentTest.start();
    window.componentTest.resolve(1);
  });
  await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.componentTest.resolve(0, new ArrayBuffer(7)));
  await expect(page.locator('svg image')).toHaveCount(3);
  await expect(page.locator('.pureref-error')).toHaveCount(0);
  await page.evaluate(() => {
    window.componentTest.start();
    window.componentTest.close();
    window.componentTest.resolve(2, new ArrayBuffer(7));
  });
  await expect(page.locator('.pureref-viewer, .pureref-error')).toHaveCount(0);
  expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
});

test('truncation at envelope and database boundaries always recovers cleanly', async ({ page }) => {
  for (const length of [0, 1, 16, 90, 512, 4096]) {
    await page.evaluate(async length => {
      await window.pureref.mountComponent();
      const bytes = await window.pureref.fixture('adv-geometry.pur');
      window.componentTest.start();
      window.componentTest.resolve(0, bytes.slice(0, length));
    }, length);
    await expect(page.locator('.pureref-error')).toBeVisible();
    expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
    await page.evaluate(() => {
      window.componentTest.start();
      window.componentTest.resolve(1);
    });
    await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.pureref-error')).toHaveCount(0);
    await page.evaluate(() => window.componentTest.close());
    expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
  }
});

test('twelve good/bad replacement cycles leave no image URLs or listeners', async ({ page }) => {
  for (let i = 0; i < 12; i++) {
    await page.evaluate(async () => {
      await window.pureref.mountComponent('adv-shared-400.pur');
      window.componentTest.start();
      window.componentTest.resolve(0);
    });
    await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
    expect(await page.evaluate(() => window.pureref.urls())).toBe(1);
    await page.evaluate(() => {
      window.componentTest.start();
      window.componentTest.resolve(1, new ArrayBuffer(7));
    });
    await expect(page.locator('.pureref-error')).toBeVisible();
    await page.evaluate(() => window.componentTest.close());
    expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
    expect(await page.evaluate(() => window.componentTest.activeListeners())).toBe(0);
  }
});
