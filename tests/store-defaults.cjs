const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.route('https://**/*', route => route.abort());
    const source = 'file://' + path.resolve(__dirname, '..', 'index.html');

    await page.goto(source + '?store=daiso');
    assert.equal(await page.locator('#backup-list .card').count(), 4, 'DAISO has four official travel picks');
    assert.equal(await page.locator('#shopping-list .card').count(), 7, 'DAISO has seven official travel picks in the shopping list');
    assert.match(await page.locator('#shopping-list').textContent(), /₩3,000 ≈ ¥16/);
    assert.match(await page.locator('#shopping-list').textContent(), /₩1,000 ≈ ¥5/);
    assert.match(await page.locator('#backup-list').textContent(), /旅行压缩收纳包/);
    assert.match(await page.locator('#backup-list').textContent(), /立式洗漱包/);
    assert.equal(await page.locator('#backup-list .card a.btn').count(), 4);
    await page.locator('#manage-items').click();
    await page.locator('[data-id="default-daiso-compression-pouch"] .select-item').check();
    await page.locator('#delete-selected').click();
    await page.reload();
    assert.equal(await page.locator('#backup-list .card').count(), 3, 'A deleted default card stays deleted');
    await page.locator('#undo-delete').click();
    assert.equal(await page.locator('#backup-list .card').count(), 4, 'A deleted default card can be restored');

    await page.goto(source + '?store=nyunyu');
    assert.equal(await page.locator('#backup-list .card').count(), 5, 'NYUNYU has five travel-photo style picks');
    assert.equal(await page.locator('#shopping-list .card').count(), 0);
    assert.match(await page.locator('#backup-list').textContent(), /小圈耳环/);
    assert.match(await page.locator('#backup-list').textContent(), /棒球帽/);
    assert.equal(await page.locator('#backup-list .card a.btn').count(), 5);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('PASS DAISO and NYUNYU default backup cards, links, mobile width');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
