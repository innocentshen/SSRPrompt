import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('output/playwright');
fs.mkdirSync(outDir, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  baseUrl: '',
  checks: [],
  screenshots: [],
  errors: [],
};

function addCheck(name, passed, detail = '') {
  report.checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} - ${name}${detail ? `: ${detail}` : ''}`);
}

async function saveShot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(file);
}

async function firstVisibleLocator(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        return loc;
      }
    } catch {
      // ignore invalid or stale selector
    }
  }
  return null;
}

async function clickFirstVisible(page, selectors) {
  const loc = await firstVisibleLocator(page, selectors);
  if (!loc) return false;
  await loc.click({ timeout: 4000 }).catch(() => {});
  return true;
}

async function resolveBaseUrl() {
  // Prefer localhost to match server CORS default (http://localhost:5173).
  const candidates = ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return url;
    } catch {
      // ignore
    }
  }
  throw new Error('No local frontend URL available on 5173/5174');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1680, height: 980 } });
  const page = await context.newPage();

  try {
    const baseUrl = await resolveBaseUrl();
    report.baseUrl = baseUrl;

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await saveShot(page, '01-home');

    // If on login page, enter demo mode first.
    const demoModeButton = await firstVisibleLocator(page, [
      'button:has-text("试用 Demo 模式")',
      'button:has-text("Demo")',
      'text="试用 Demo 模式"',
    ]);
    if (demoModeButton) {
      await demoModeButton.click().catch(() => {});
      await page.waitForTimeout(2500);
      addCheck('进入 Demo 模式', true);
      await saveShot(page, '01b-after-demo-login');
    }

    // Ensure demo account has at least one prompt so the editor panel is accessible.
    const promptBootstrap = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return { ok: false, reason: 'missing_token' };

      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const listRes = await fetch('http://localhost:3001/api/v1/prompts', { headers });
      if (!listRes.ok) return { ok: false, reason: `list_failed_${listRes.status}` };
      const listJson = await listRes.json();
      const prompts = Array.isArray(listJson?.data) ? listJson.data : [];
      if (prompts.length > 0) return { ok: true, created: false, count: prompts.length };

      const createRes = await fetch('http://localhost:3001/api/v1/prompts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'E2E-Optimizer-Check',
          content: '你是一个测试助手。请根据输入生成结构化回答。',
          messages: [
            { role: 'system', content: '你是一个测试助手。' },
            { role: 'user', content: '{{input}}' },
          ],
        }),
      });
      if (!createRes.ok) return { ok: false, reason: `create_failed_${createRes.status}` };
      return { ok: true, created: true, count: 1 };
    });
    addCheck(
      '准备测试 Prompt 数据',
      Boolean(promptBootstrap?.ok),
      promptBootstrap?.ok
        ? promptBootstrap.created
          ? '已创建测试 Prompt'
          : `已有 ${promptBootstrap.count} 条`
        : promptBootstrap?.reason || 'unknown'
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    await clickFirstVisible(page, [
      'a:has-text("Prompt 开发")',
      'button:has-text("Prompt 开发")',
      'text="Prompt 开发"',
    ]);
    await page.waitForTimeout(1200);

    // Ensure a prompt entry is selected from left tree.
    await clickFirstVisible(page, [
      'li:has-text("E2E-Optimizer-Check")',
      'div:has-text("E2E-Optimizer-Check")',
      'li:has-text("指令式操作-销售订单")',
      'div:has-text("指令式操作-销售订单")',
      'li:has-text("销售订单")',
      'div:has-text("销售订单")',
      '[data-testid="prompt-item"]',
    ]);
    await page.waitForTimeout(1000);

    let optimizerTab = await firstVisibleLocator(page, [
      'button:has-text("智能优化")',
      '[role="tab"]:has-text("智能优化")',
      'text="智能优化"',
      'button:has-text("AI Optimization")',
      'text="AI Optimization"',
    ]);

    if (!optimizerTab) {
      await clickFirstVisible(page, [
        'li:has-text("E2E-Optimizer-Check")',
        'div:has-text("E2E-Optimizer-Check")',
        'li:has-text("指令式操作-销售订单")',
        'div:has-text("指令式操作-销售订单")',
        'li:has-text("销售订单")',
        'div:has-text("销售订单")',
        '[data-testid="prompt-item"]',
      ]);
      await page.waitForTimeout(1200);
      optimizerTab = await firstVisibleLocator(page, [
        'button:has-text("智能优化")',
        '[role="tab"]:has-text("智能优化")',
        'text="智能优化"',
      ]);
    }

    if (optimizerTab) {
      await optimizerTab.click().catch(() => {});
      await page.waitForTimeout(1000);
      addCheck('进入智能优化页面', true);
    } else {
      addCheck('进入智能优化页面', false, '未找到智能优化入口');
    }
    await saveShot(page, '02-optimizer');

    await clickFirstVisible(page, [
      'button:has-text("分析 Prompt")',
      'button:has-text("Analyze Prompt")',
      'button:has-text("分析")',
    ]);
    await page.waitForTimeout(2500);

    const applyBtn = await firstVisibleLocator(page, [
      'button:has-text("应用")',
      'button:has-text("Apply")',
    ]);
    if (applyBtn) {
      await applyBtn.click().catch(() => {});
      await page.waitForTimeout(600);
      const appliedBadgeVisible = await firstVisibleLocator(page, ['text="已应用"', 'text="Applied"']);
      addCheck('应用建议按钮可生效', Boolean(appliedBadgeVisible));
    } else {
      addCheck('应用建议按钮可生效', false, '未找到应用按钮');
    }

    const dismissButtons = page.locator('button:has-text("忽略"), button:has-text("Dismiss")');
    const beforeDismissCount = await dismissButtons.count().catch(() => 0);
    const dismissBtn = await firstVisibleLocator(page, [
      'button:has-text("忽略")',
      'button:has-text("Dismiss")',
    ]);
    if (dismissBtn) {
      await dismissBtn.click().catch(() => {});
      await page.waitForTimeout(500);
      const afterDismissCount = await dismissButtons.count().catch(() => beforeDismissCount);
      addCheck('忽略建议按钮可生效', afterDismissCount <= Math.max(0, beforeDismissCount - 1));
    } else {
      addCheck('忽略建议按钮可生效', false, '未找到忽略按钮');
    }

    await saveShot(page, '03-analysis-actions');

    await clickFirstVisible(page, [
      'button:has-text("效果验证")',
      'button:has-text("验证")',
      'button:has-text("Verification")',
    ]);
    await page.waitForTimeout(1200);

    const promptPreviewVisible = Boolean(await firstVisibleLocator(page, [
      'text="优化后 Prompt 预览"',
      'text="Optimized Prompt Preview"',
    ]));
    addCheck('可见优化后整体 Prompt 预览', promptPreviewVisible);

    const executionPreviewVisible = Boolean(await firstVisibleLocator(page, [
      'text="执行预览（当前选中用例）"',
      'text="Execution Preview (Selected Case)"',
    ]));
    addCheck('可见执行 Prompt 预览', executionPreviewVisible);

    const cb = page.locator('input[type="checkbox"]').first();
    if ((await cb.count()) > 0) {
      await cb.check().catch(() => cb.click().catch(() => {}));
    }

    const runClicked = await clickFirstVisible(page, [
      'button:has-text("运行并评测")',
      'button:has-text("Run and Evaluate")',
      'button:has-text("运行")',
    ]);
    if (runClicked) {
      await page.waitForTimeout(7000);
      const summaryVisible = Boolean(await firstVisibleLocator(page, [
        'text="验证结果"',
        'text="Verification Results"',
      ]));
      addCheck('运行评测后产生结果面板', summaryVisible);
    } else {
      addCheck('运行评测后产生结果面板', false, '未找到运行按钮');
    }

    const detailsVisible = Boolean(await firstVisibleLocator(page, [
      'text="评测详情"',
      'text="Evaluation Details"',
    ]));
    addCheck('可见详细评测结果入口', detailsVisible);

    const expandBtn = await firstVisibleLocator(page, [
      'button:has-text("After")',
      'button:has-text("后")',
    ]);
    if (expandBtn) {
      await expandBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    const modelOutputVisible = Boolean(await firstVisibleLocator(page, [
      'text="模型输出"',
      'text="Model Output"',
    ]));
    addCheck('可见案例级评测细节（含模型输出）', modelOutputVisible);

    await saveShot(page, '04-verification-results');

    const autoClicked = await clickFirstVisible(page, [
      'button:has-text("自动优化循环")',
      'button:has-text("Auto Optimize Loop")',
    ]);
    if (autoClicked) {
      await page.waitForTimeout(1800);
      const statusVisible = Boolean(await firstVisibleLocator(page, [
        'text="自动流程状态"',
        'text="Auto pipeline status"',
      ]));
      addCheck('自动优化回归循环可触发', statusVisible);
    } else {
      addCheck('自动优化回归循环可触发', false, '未找到自动循环按钮');
    }

    await saveShot(page, '05-auto-pipeline');
  } catch (err) {
    report.errors.push(String(err?.stack || err));
    try {
      await saveShot(page, '99-error');
    } catch {}
  } finally {
    report.endedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outDir, 'optimizer-run-report.json'), JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
  }
})();
