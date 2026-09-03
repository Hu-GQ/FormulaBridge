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
  assert.match(checklist, /^- \[x\] 通过当前提交的默认测试：135 项、129 通过、0 失败、6 跳过$/m);
  assert.match(checklist, /^- \[ \] 生成与待验收提交匹配的签名 MSI 和 `build-metadata\.json`$/m);
  assert.match(checklist, /^- \[ \] 在受支持环境中通过纵向产品闭环验收$/m);
  assert.match(checklist, /^- \[ \] 通过官方渠道发布签名的 FormulaBridge 1\.0$/m);

  assert.doesNotMatch(checklist, /^- \[[^x ]\]/m);
});
