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
  assert.match(checklist, /^- \[x\] 安装并核对 Microsoft 365 Monthly Enterprise Channel x64 的版本与通道$/m);
  assert.match(checklist, /^- \[x\] 在支持窗口内的 TeX Live 与 MiKTeX 矩阵上重复隔离验证$/m);
  assert.match(checklist, /^- \[x\] 清理 Office 2024 补充矩阵临时对象并重启验证原 UAC 设置恢复$/m);
  assert.match(checklist, /^- \[x\] 完成十二行执行结果裁决：一行通过、十一行失败，阶段 1 门禁保持关闭$/m);

  assert.match(checklist, /\[阶段 0 支持矩阵\]\(phase0-support-matrix\.md\)/);
  assert.match(checklist, /^- \[x\] 明确完整 TeX 支持窗口为 TeX Live 2024、2025、2026 和当前稳定 MiKTeX$/m);
  const matrix = fs.readFileSync(path.join(root, 'docs', 'phase0-support-matrix.md'), 'utf8');
  assert.match(matrix, /实际 Word `16\.0\.20228\.20188`、x64，通道 ID `55336b82-a18d-4dd6-b5f6-9e5095c314a6`/);
  assert.match(matrix, /固定被测提交：`7e36332c61ab780c7ad13e61cdc3354071d6d45f`/);
  const rows = [...matrix.matchAll(/^\| (Office 2024|Microsoft 365 Current Channel|Microsoft 365 Monthly Enterprise Channel) \| (TeX Live 2024|TeX Live 2025|TeX Live 2026|MiKTeX) \| (passed|failed|pending) \| ([A-F0-9]{64}|—) \|$/gm)];
  assert.equal(rows.length, 12, 'all supported Word/TeX combinations must remain visible');
  assert.equal(new Set(rows.map(row => `${row[1]}/${row[2]}`)).size, 12);
  for (const [, word, tex, status, hash] of rows) {
    const hasAcceptedEvidence = word === 'Office 2024' && tex === 'TeX Live 2026';
    const currentHashes = {
      'TeX Live 2024': 'F56F298E20728ADCEF3E685BDBC940C8E0540F4130379BB82955C13778F92830',
      'TeX Live 2025': 'FD3803354FC0CE16822DA7E501BFBE5F52097582A92566051227831CAF5C5445',
      'TeX Live 2026': '4BB2676FE33CF0B44D5B4283630F5EF9CB1ABC1FACCC07ACF944B89FF6750C71',
      MiKTeX: 'A9BFAED298B0D7135F780768FEE81C1FEB4C1C2A2DD871018F0EC3CE092DDD72',
    };
    const monthlyHashes = {
      'TeX Live 2024': '9C6C5153440E3C330430D80E7604175E29C6B18EDA7BDE17AD5E3BEA934E7695',
      'TeX Live 2025': 'BD9C1983FDF7734FD6A16F6D1A03178020C0412E63D0C55860A130A8256FA6A9',
      'TeX Live 2026': '2C02912591B4E63285C1F70AF3FD066C0568D1B2686BECCA226634D1714A0827',
      MiKTeX: '9AEAB9B63F8E2EA37D496FD5F57F7E160E3293B6726974A63859CA266FF70EA6',
    };
    const officeHashes = {
      MiKTeX: '732DBF3E17616999650C4F50A5E70DEB892BA16B9978CD913D053A8084744EB5',
      'TeX Live 2024': 'E385DEB4A3A18CCE461C831B5B0C14D99B4CD92A8C5773E3E0AEF5AA552A9FC9',
      'TeX Live 2025': 'ECA19F019B7F033069713F18B559E38503376DACCEA912948EBAE5ED0DA21CFD',
    };
    const failedHash = word === 'Microsoft 365 Current Channel' ? currentHashes[tex]
      : word === 'Microsoft 365 Monthly Enterprise Channel' ? monthlyHashes[tex] : officeHashes[tex];
    const hasFailedEvidence = Boolean(failedHash);
    assert.equal(status, hasAcceptedEvidence ? 'passed' : hasFailedEvidence ? 'failed' : 'pending');
    const expectedHash = hasAcceptedEvidence
      ? '44EC59BEC6CD5E365E642772B5F92C3647415B86C77C44313C118AFFE88A5EB1'
      : hasFailedEvidence ? failedHash : '—';
    assert.equal(hash, expectedHash);
  }
  assert.match(matrix, /报告校验通过不等于报告中的检查通过/);
  assert.match(matrix, /Office 2024 补充矩阵清理完成/);
  assert.match(checklist, /^- \[x\] 完成 Monthly Enterprise 四个 TeX 组合的十二项 Word 检查$/m);
  assert.match(checklist, /^- \[x\] 完成 Monthly Enterprise／TeX Live 2024、2025、2026 首次四项运行并独立校验失败报告$/m);
  assert.match(checklist, /^- \[x\] 完成 Monthly Enterprise／MiKTeX 四项运行并独立校验失败报告$/m);
  assert.match(checklist, /^- \[x\] 清理 Monthly Enterprise 环境临时对象并重启验证原 UAC 设置恢复$/m);
  assert.match(checklist, /^- \[x\] 在独立验收虚拟机恢复 Office 2024 原验收版本以补齐年度版与 MiKTeX 矩阵$/m);
  assert.match(checklist, /^- \[x\] 完成 Office 2024／TeX Live 2024、2025 和 MiKTeX 的九项 Word 检查$/m);
  assert.match(checklist, /^- \[x\] 完成 Office 2024／TeX Live 2024、2025 四项运行并独立校验失败报告$/m);
  assert.match(checklist, /^- \[x\] 完成 Office 2024／MiKTeX 四项运行并独立校验失败报告$/m);
  assert.equal(rows.filter(row => row[3] === 'failed').length, 11);
  assert.equal(rows.filter(row => row[3] === 'passed').length, 1);
  assert.match(matrix, /Office 2024／TeX Live 2024、2025 和 MiKTeX 的九项 Word 检查全部通过/);
  assert.match(matrix, /实际版本 `16\.0\.17932\.20076`、x64、`ProPlus2024Volume`，通道 ID `7983bac0-e531-40cf-be00-fd24fe66619c`/);
  assert.match(matrix, /Monthly Enterprise 环境清理完成：临时证书、打印机、任务、测试进程、profile 和对应 SID ACL 均无残留/);
  assert.match(matrix, /Monthly Enterprise 四个组合的报告现已齐全，完整门禁仍未通过/);
  assert.match(checklist, /^- \[x\] 清理 Current Channel 环境临时对象并重启验证原 UAC 设置恢复$/m);
  assert.match(matrix, /恢复原 `EnableLUA=0`，重启后确认启动时间变化及注册表值为 `0`/);
  assert.match(matrix, /`openin_any=p` 拒绝读取请求的绝对输入路径/);
  assert.match(checklist, /^- \[x\] 完成 Current Channel／TeX Live 2026 普通优先级复测、独立报告校验和超时残留清理$/m);
  assert.match(matrix, /普通优先级没有解决该门禁问题/);
  assert.match(matrix, /新报告 SHA-256：`4BDB7EE8AB74AB9F41A8A4D4B6BD09B3F44A04F9BDEEF3B5552639B3C6CA2218`/);
  assert.match(matrix, /TeX 片段 SHA-256：`0C77DAB5C056CFFB2A825E718C5778D0CC317DE81E04383500D9DCFA635DCE94`/);
  assert.match(checklist, /^- \[x\] 完成 Current Channel／TeX Live 2024、2025 和 MiKTeX 的 VSTO、源码复制及双格式检查$/m);
  const partialRows = [...matrix.matchAll(/^\| (vsto-installation|source-portable-copy|dual-format-roundtrip) \| ([A-F0-9]{64}) \| ([A-F0-9]{64}) \| ([A-F0-9]{64}) \|$/gm)];
  assert.equal(partialRows.length, 3, 'three Word checks must identify evidence for every remaining Current TeX row');
  assert.equal(new Set(partialRows.flatMap(row => row.slice(2))).size, 9);
  assert.match(matrix, /这九项 Word 检查不能单独满足四项统一门禁/);
  assert.match(checklist, /^- \[x\] 完成 Current Channel／TeX Live 2024、2025 和 MiKTeX 首次四项运行并独立校验失败报告$/m);
  assert.match(checklist, /^- \[x\] 完成 Current Channel／TeX Live 2026 首次四项运行并独立校验失败报告$/m);
  assert.match(matrix, /Issue #8.*保持开放/);
  assert.match(checklist, /^- \[ \] 在受支持环境中通过纵向产品闭环验收$/m);
  assert.match(checklist, /^- \[ \] 通过官方渠道发布签名的 FormulaBridge 1\.0$/m);

  assert.doesNotMatch(checklist, /^- \[[^x ]\]/m);
});
