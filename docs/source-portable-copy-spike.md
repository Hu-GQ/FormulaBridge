# 阶段 0 源码可移植复制样机

本样机验证 FormulaBridge 公式通过普通 Word 剪贴板迁移时，LaTeX 源码和必要元数据能够随对象到达目标位置，并在粘贴后获得独立身份。它只覆盖 Issue #4 的前置可行性门槛，不实现阶段 1 的生产级 `DocumentStore`、事件调度或广泛公式功能。

## 载体结论

文档级 Custom XML 继续保存权威 LaTeX 源码。它适合保存、重开和离线恢复，但不把“单个 Word 对象复制时，整个文档级数据部件会自动迁移”当作前提。

每个受管公式因此组合两种载体：

- 外层富文本内容控件保存可见表示，并用 `FormulaBridge.Formula:<UUID>` 标识公式身份；
- 内层隐藏的纯文本内容控件使用 `FormulaBridge.CopyCarrier:v1` Tag，保存 Base64 编码的 UTF-8 JSON；
- JSON 固定包含 `schemaVersion`、`formulaId`、`label`、`latex` 和基于这些字段计算的 SHA-256；
- Custom XML 是文档内权威存储，隐藏载体只是普通对象复制所需的冗余传输数据。

普通 `Word.Selection.Copy/Paste` 后，样机验证载体的版本、UUID 和校验值，为粘贴实例生成新 UUID、清除标签及随对象带来的书签，再把记录写入目标文档的 Custom XML。`Word.Selection.Cut/Paste` 作为移动路径，不重写 UUID 或标签；原生 `REF` 字段仍指向随对象移动的原书签。

写回 Custom XML 前先只读解析全部受管对象与既有权威记录；载体缺失、重复、校验失败或与同身份权威记录分歧时立即失败且不删除旧存储。候选 Custom XML 成功创建后才替换旧部件，避免用损坏的复制载体静默覆盖权威源码。

隐藏载体不是保密边界。与 Custom XML 一样，它随未加密 DOCX 明文保存；隐藏格式只防止传输内容成为普通可见公式文本。

## 自动化范围

[`tools/test-source-portable-copy.ps1`](../tools/test-source-portable-copy.ps1)启动隐藏的真实 Microsoft Word 实例，只创建合成临时文档，并依次验证：

1. 最小受管公式具有可见表示、LaTeX、UUID、标签和两种元数据载体；
2. 同文档普通复制保留源码，副本获得新 UUID 并清除标签，原实例不变；
3. 跨文档普通复制保留源码，目标副本获得新 UUID 并清除标签；
4. 剪切移动保留 UUID、标签、书签和 `REF` 字段；
5. 两份文档分别保存、关闭、重开后，源码、身份和标签仍正确；
6. [`tools/source-portable-copy/inspect-docx.js`](../tools/source-portable-copy/inspect-docx.js)离线检查重开后的 DOCX，交叉验证外层对象、隐藏载体和 Custom XML。

保存前由 Word 清除个人信息，离线检查器还会拒绝 Author、Last Saved By、Company、Manager 或自定义文档属性，防止真实 Office 配置泄露到证据包。统一 provider 对 Word 自动化设置 180 秒硬超时；超时生成结构化失败证据，不能无限占用阶段 0 门禁。

Word 自动化是 Windows 选择加入测试；普通 `npm test` 会跳过它。显式运行：

```powershell
$evidence = Join-Path $PWD "artifacts\source-portable-copy"
$fragment = Join-Path $evidence "source-portable-copy-check-fragment.json"
$commit = git rev-parse HEAD

npm run copy:smoke -- `
  -EvidenceDirectory $evidence `
  -ExpectedCommit $commit `
  -FragmentPath $fragment
```

也可以通过阶段 0 统一入口执行。执行输入声明 Word `available` 时，`tools/phase0-providers/source-portable-copy.js`调用真实 Word；声明 `unavailable` 时返回 `blocked`，不会生成模拟通过结果。

## 证据

通过运行固定生成：

- `evidence/source-portable-copy/result/result.json`：七项验收断言及总状态；
- `evidence/source-portable-copy/log/word-automation.log`：不含用户路径的步骤日志；
- `evidence/source-portable-copy/docx-package/package-evidence.zip`：两份重开 DOCX 与包检查结果；
- `evidence/source-portable-copy/word-automation/word-automation.json`：Word 版本、剪贴板路径和身份结果。

失败时会在关闭 Word 前尽力保存两份已去个人信息的现场 DOCX，并把结构化失败上下文、日志和现场文档写入非空复现包。只有复现包确认可读后才删除合成工作目录；归档失败则保留原目录，不得删除唯一复现材料或缩小产品契约。正式发布仍需在 Word 支持窗口的完整版本、通道、位数和语言矩阵上重复同一契约。
