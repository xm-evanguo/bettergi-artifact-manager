# 进度

2026-10-29：在 ~/Code/bettergi-artifact-manager 建立独立 Git 仓库，复制原始规划。

实现 0.1.0 本地原型：评分适配、快照导入与校验、多角色保留、冗余判断、强化队列、只读 HTML/JSON 报告、实验扫描器、设置及打包。

验证结果：
- bun test：46 pass / 0 fail，113 次断言，覆盖 4 个测试文件。
- bun run check：模块依赖、manifest 引用、JSON、设置及编码检查通过。
- bun run demo：虚构 9 件，保留 6 / 优先试强化 1 / 可清理 2 / 待复查 0。
- bun run package：生成 dist/ArtifactManager，保存目录不含真实库存。
- 评分数据改为从 miao-plugin（MIT）固定提交生成；参考分与旧模块 63 例中 60 例一致，3 例差异来自 miao-plugin 新的杯子上限算法。

Windows 实际导入、游戏扫描及真实清理效果尚未验收。浏览器工具不可用，视觉验收未完成；报告交互脚本用 DOM 替身验证。未启动 BetterGI、未修改 C#、未执行分解或强化。没有提交或推送。

2026-10-30：核对官方远程脚本仓库机制与本地多仓库能力。补充 packages/ArtifactManager-0.1.0.zip（36,908 字节）、SHA-256 文件与跨平台打包命令，README 提供下载和安装说明。

验证：47 pass / 0 fail，117 次断言；bun run check 通过；ZIP 完整性、解压 18 个文件与打包目录逐字节比对、层级、saved_files 隔离、SHA-256、解压后浏览器目标模块检查通过。PowerShell 打包分支未在 Windows 执行，BetterGI 实机导入仍待验收。本轮未提交或推送。

2026-10-30：按用户要求取消 ZIP 交付，改造为 BetterGI 远程脚本仓库。唯一源码迁到 repo/js/ArtifactManager，版本 0.1.1，生成根 repo.json；上游记录与许可证在脚本内。新增内容指纹和索引一致性检查、LF 换行约定、main 验证后同步 release 的工作流与远程安装步骤。

验证：52 pass / 0 fail，137 次断言；bun run check 通过；真实临时 Git release 提交、只检出 repo.json 的 clone、从 Git 对象中导入脚本、完整入口依赖解析通过；工作流 YAML 解析与发布依赖检查通过；demo 仍为保留 6 / 优先试强化 1 / 可清理 2。demo 首次因工作区写权限 EPERM 失败，使用已授权的提权执行后通过。Windows 实际导入尚未验收。新增工作流尚未在 GitHub 执行，本轮未提交、未推送、未创建远程 release。

2026-10-30：用户明确授权推送。已核对 origin/main 与本地基线一致，推送前重新运行测试（52 pass / 0 fail，137 次断言）及 bun run check，全部通过。开始提交并推送 main，随后核对工作流和 release。

发布前检查发现许可证 CRLF 经 Git 转换会使远程索引失配，已在提交前修正；数据生成器保留上游原始 SHA-256，同时统一本地许可文本为 LF。补充对 Git 实际导出正文的索引验证，重新构建索引后回归。
