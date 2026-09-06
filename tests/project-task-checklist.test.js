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
    '通过外部诊断的真实健康、禁用和恢复状态验收',
  ]) {
    assert.match(checklist, new RegExp(`^- \\[x\\] ${completed.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'm'));
  }
  assert.match(checklist, /^- \[ \] 通过 clean install、重复安装、repair、自动加载和 uninstall 生命周期 smoke$/m);
  assert.match(checklist, /^- \[ \] 在受支持环境中通过纵向产品闭环验收$/m);
  assert.match(checklist, /^- \[ \] 通过官方渠道发布签名的 FormulaBridge 1\.0$/m);

  assert.doesNotMatch(checklist, /^- \[[^x ]\]/m);
});
