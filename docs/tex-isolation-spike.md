# 阶段 0 TeX 隔离样机

本样机实现 Issue #6 的本地 LuaLaTeX 安全门禁：在受支持的 Windows 11 x64 环境中，证明文档提供的 TeX 只能读取已批准的 TeX 安装与随机作业目录，只能写入受控输出目录，不能访问网络、创建额外进程或放宽产品资源策略。它不实现正式渲染服务，也不依赖或修改 `src/web/editor` 原型。

## 固定隔离机制

宿主使用 .NET 10 的 x64 Windows helper。每个探针创建全新的 AppContainer profile，不授予任何网络 capability；给 profile SID 仅添加 TeX 根的读取/执行 ACL、随机作业根的读取 ACL和输出目录的修改 ACL。可执行文件必须是本地配置批准的 `lualatex.exe`，位于批准 TeX 根内且 SHA-256 与 `FORMULABRIDGE_TEX_ENGINE_SHA256` 一致。

进程以清洗后的固定环境和 `--no-shell-escape --interaction=nonstopmode --halt-on-error` 参数挂起创建。宿主核验 AppContainer token 及零 capability，配置只允许一个活动进程、1 GiB 内存并关闭即终止的 Job Object，把进程加入 Job Object 后才恢复线程。宿主另行强制 30 秒交互墙钟、120 秒批项上限，以及最多 64 个、合计 64 MiB 的输出文件；进程退出时仍执行一次最终输出计量。

运行前拒绝位于受控根外的输入、输出或可执行文件，拒绝受信路径上的 link、junction 和 reparse point。对抗探针还分别尝试从输出目录写入只读作业根和沙箱外路径，并同时覆盖 junction 与文件 symbolic link。运行后重新核验引擎身份，恢复每个 case 的临时 ACL，删除各自的 AppContainer profile 及其临时私有存储，并删除全部随机作业目录。任一 token、Job Object、ACL、身份、资源限制、清理或证据隐私条件不成立，检查都不能成为 `passed`。

这里的安全边界包括 Windows 运行库对 AppContainer、零 capability、Job Object 和 ACL 的正确实现，也包括 profile 删除前短暂存在的 AppContainer 私有存储。样机不把 LuaLaTeX 的内部配置当作操作系统隔离的替代品。

## 构建与执行

先固定已批准引擎及当前 Git 提交：

```powershell
npm run tex:build
$env:FORMULABRIDGE_TEX_ENGINE = 'C:\approved-tex\bin\windows\lualatex.exe'
$env:FORMULABRIDGE_TEX_ROOT = 'C:\approved-tex'
$env:FORMULABRIDGE_TEX_ENGINE_SHA256 = (Get-FileHash $env:FORMULABRIDGE_TEX_ENGINE -Algorithm SHA256).Hash
npm run phase0 -- execute --input C:\phase0-run\execution.json --output C:\phase0-run\report
```

也可以直接调用 smoke runner 并指定证据目录；`ExpectedCommit` 必须是当前 checkout 的完整 40 位提交号：

```powershell
npm run tex:smoke -- `
  -EnginePath $env:FORMULABRIDGE_TEX_ENGINE `
  -TexRoot $env:FORMULABRIDGE_TEX_ROOT `
  -ExpectedEngineSha256 $env:FORMULABRIDGE_TEX_ENGINE_SHA256 `
  -EvidenceDirectory C:\phase0-run\tex-smoke `
  -ExpectedCommit (git rev-parse HEAD)
```

预检要求 Windows 11 x64、.NET 10、可用且身份匹配的已批准 LuaLaTeX，以及与运行清单相同的 Git commit。缺一项即生成 `blocked` 结果，不会启动普通用户权限的 TeX 作为降级方案。

## 对抗语料与判定

版本化 corpus 包含正常公式，以及相对遍历、绝对路径、受控输出外写入、父进程环境、Kpathsea 搜索路径、junction/symbolic-link reparse point、Lua 文件与受控 listener 网络连接、shell escape/子进程、无限循环、文件数洪泛、字节洪泛和内存分配探针。正常公式必须在隔离中生成 PDF；恶意文件/网络探针必须写出 `blocked` 标记且不能读取 canary、写出受控位置或连接 listener；墙钟、文件数和字节探针必须在运行中被宿主终止，内存探针必须以 Job Object 记录的不超过 1 GiB 峰值失败。runner 还必须用良性公式证明恰好 120 秒的 batch-item 策略可运行，并证明 256 KiB 以上输入与 120 秒以上 batch-item 请求在启动 TeX 前被拒绝。

只要正常公式无法在完整 AppContainer + Job Object + ACL 策略下运行，后续恶意探针就不会被误当作成功。探针运行失败、未运行、机制不可用或证据不全都不能产生 `passed`。

## 证据与隐私

统一 runner 归档以下相对路径：

- `evidence/tex-isolation/result/result.json`：七项固定断言的状态；
- `evidence/tex-isolation/log/smoke.log`：去除用户名和绝对路径的摘要日志；
- `evidence/tex-isolation/security-trace/security-trace.json`：token、capability、Job 分配、身份与攻击探针结果；
- `evidence/tex-isolation/resource-report/resource-report.json`：固定资源上限与终止结果。

证据不保存 TeX 原始控制台输出、用户目录、盘符或 UNC 绝对输入路径、canary 内容。任一 case 的作业目录、ACL 或 AppContainer profile 删除失败会把清理断言标为 `failed`，因此带残留的运行不能通过阶段 0 门禁。
