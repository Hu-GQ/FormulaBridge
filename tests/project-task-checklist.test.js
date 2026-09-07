const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const checklist = fs.readFileSync(
  path.join(root, 'docs', 'project-task-checklist.md'),
  'utf8',
);
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('project task checklist separates completed evidence from remaining delivery work', () => {
  assert.match(readme, /\[项目任务清单\]\(docs\/project-task-checklist\.md\)/);

  for (const heading of [
    '产品与技术基线',
    '阶段 0：前置可行性样机',
    '阶段 1：纵向产品闭环',
    '阶段 2：FormulaBridge 1.0 完整范围',
    '发布验证与 FormulaBridge 1.0 正式发行',
  ]) {
    assert.match(checklist, new RegExp(`^## ${heading}$`, 'm'));
  }

  assert.match(checklist, /^- \[x\] 建立统一检查集、证据 schema、执行入口和独立报告校验$/m);
  assert.match(checklist, /^- \[x\] 通过当前提交的默认测试：138 项、132 通过、0 失败、6 跳过$/m);
  for (const completed of [
    '在有效的已批准 TeX 路径上完成 AppContainer 路径 API 诊断',
    '根据诊断结果修复并验证 TeX 隔离的真实环境问题',
    '准备 Windows 11 x64 和受支持 Word x64 的干净验收账户',
    '准备 VSTO、MSBuild、WiX、Mage、SignTool 和授权代码签名证书',
    '生成与待验收提交匹配的签名 MSI 和 `build-metadata.json`',
    '通过 clean install、重复安装、repair、自动加载和 uninstall 生命周期 smoke',
    '通过外部诊断的真实健康、禁用和恢复状态验收',
    '在 Windows 11 上通过 TeX 文件、网络、进程和资源隔离 smoke',
    '通过运行中取消、完整 Job 清理、同宿主恢复和 Word 响应验收',
    '在 Office 2024 Word x64 上通过阶段 0 统一门禁',
  ]) {
    assert.match(checklist, new RegExp(`^- \\[x\\] ${completed.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'm'));
  }
  assert.match(checklist, /验收提交：`7e36332c61ab780c7ad13e61cdc3354071d6d45f`/);
  assert.match(checklist, /统一报告 SHA-256：`44EC59BEC6CD5E365E642772B5F92C3647415B86C77C44313C118AFFE88A5EB1`/);
  assert.match(checklist, /验收环境恢复记录：临时代码签名证书在 `My`、`Root` 和 `TrustedPublisher` 中的计数均为 0；临时打印机不存在；`EnableLUA=0`/);
  assert.match(checklist, /^- \[ \] 在 Microsoft 365 Current Channel x64 上通过阶段 0 统一门禁$/m);
  assert.match(checklist, /^- \[ \] 在 Microsoft 365 Monthly Enterprise Channel x64 上通过阶段 0 统一门禁$/m);
  assert.match(checklist, /^- \[ \] 在支持窗口内的 TeX Live 与 MiKTeX 矩阵上重复隔离验证$/m);
  assert.match(checklist, /\[阶段 0 支持矩阵\]\(phase0-support-matrix\.md\)/);
  assert.match(checklist, /^- \[x\] 明确完整 TeX 支持窗口为 TeX Live 2024、2025、2026 和当前稳定 MiKTeX$/m);
  const matrix = fs.readFileSync(path.join(root, 'docs', 'phase0-support-matrix.md'), 'utf8');
  assert.match(matrix, /固定被测提交：`7e36332c61ab780c7ad13e61cdc3354071d6d45f`/);
  const rows = [...matrix.matchAll(/^\| (Office 2024|Microsoft 365 Current Channel|Microsoft 365 Monthly Enterprise Channel) \| (TeX Live 2024|TeX Live 2025|TeX Live 2026|MiKTeX) \| (passed|failed|pending) \| ([A-F0-9]{64}|—) \|$/gm)];
  assert.equal(rows.length, 12, 'all supported Word/TeX combinations must remain visible');
  assert.equal(new Set(rows.map(row => `${row[1]}/${row[2]}`)).size, 12);
  for (const [, word, tex, status, hash] of rows) {
    const hasAcceptedEvidence = word === 'Office 2024' && tex === 'TeX Live 2026';
    const hasFailedEvidence = word === 'Microsoft 365 Current Channel' && tex === 'TeX Live 2026';
    assert.equal(status, hasAcceptedEvidence ? 'passed' : hasFailedEvidence ? 'failed' : 'pending');
    const expectedHash = hasAcceptedEvidence
      ? '44EC59BEC6CD5E365E642772B5F92C3647415B86C77C44313C118AFFE88A5EB1'
      : hasFailedEvidence ? '4BB2676FE33CF0B44D5B4283630F5EF9CB1ABC1FACCC07ACF944B89FF6750C71' : '—';
    assert.equal(hash, expectedHash);
  }
  assert.match(matrix, /报告校验通过不等于报告中的检查通过/);
  assert.match(checklist, /^- \[x\] 完成 Current Channel／TeX Live 2026 首次四项运行并独立校验失败报告$/m);
  assert.match(matrix, /Issue #8.*保持开放/);
  assert.match(checklist, /^- \[ \] 在受支持环境中通过纵向产品闭环验收$/m);
  assert.match(checklist, /^- \[ \] 通过官方渠道发布签名的 FormulaBridge 1\.0$/m);

  assert.doesNotMatch(checklist, /^- \[[^x ]\]/m);
});
