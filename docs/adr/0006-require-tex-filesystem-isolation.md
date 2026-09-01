---
status: accepted
---

# Require TeX filesystem isolation for release

FormulaBridge 1.0 does not ship until security tests demonstrate that a TeX job cannot read outside its explicitly allowed TeX-installation and per-job roots. Formula source cannot directly reference arbitrary document or user paths; a future resource-import feature may copy an explicitly selected file into a controlled root. Missing packages produce distribution-specific installation guidance, but FormulaBridge 1.0 never invokes a package manager to modify the user's TeX installation. Engine and converter executables require explicit local-user approval of absolute paths plus version and minimal-render health checks; identity changes revoke approval, and document data can never select an executable. Disabling shell escape is necessary but insufficient, so each job must combine a restricted child-process identity, Job Object limits, filesystem ACLs, TeX input/output policy, network blocking, and adversarial tests. Initial product-controlled ceilings are 256 KiB input, 30 seconds interactive or 120 seconds per batch item, 1 GiB memory, and 64 output files totaling at most 64 MiB; a document cannot relax them.

阶段 0 在 Windows 11 x64 上把这个组合固定为每次作业新建的 AppContainer、零网络 capability、受控 ACL 和不可变 Job Object。宿主只接受用户本地配置中已批准且哈希匹配的 `lualatex.exe`，清洗继承环境并固定 `--no-shell-escape`、输入和输出参数；文档不能选择可执行文件、参数、环境变量、capability 或资源上限。宿主先挂起创建进程，核验 AppContainer token 后把进程加入 Job Object，最后才恢复线程。Job Object 限制单进程、1 GiB 进程/作业内存、关闭即终止和 UI，宿主同时强制墙钟及 64 文件/64 MiB 输出上限。

受信读取面只包括已批准 TeX 安装和随机作业目录，写入面只包括作业输出目录；路径解析、绝对路径、搜索路径、环境变量、link、junction 和 reparse point 均由对抗语料验证。AppContainer 不声明网络 capability，测试还必须尝试连接受控本地 listener。所有临时 ACL 必须恢复，作业目录必须清理，临时 AppContainer profile 及其私有存储必须删除；任一清理或证据隐私检查失败都会使门禁失败。

边界仍依赖 Windows 运行库正确落实 AppContainer token、零 capability 语义、Job Object 和 ACL，也包含执行期间存在的临时 profile 私有存储。样机必须记录 token、Job 分配、引擎身份、资源终止和 profile 删除证据，而不是从进程退出码推断隔离有效。若支持的 Windows 环境不能建立或证明上述机制，本地 TeX 路径不得发布；产品只能保持该路径不可用，不能改用普通用户进程或仅依赖 TeX 配置降级运行。
