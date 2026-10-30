# 实施依据

- 原规划已复制到 docs/PLANNING.md；主程序仓库不作新增修改。
- 主程序使用 ClearScript V8，完整脚本支持模块导入及受限文件读写。
- 内置分解表达式并非完整脚本入口；不调用整个内置分解任务。
- macOS 可运行 Bun 离线验证，无法证明 Windows 游戏扫描准确。

- ArtifactScore 独立模块所在仓库无许可证，已移除；改由自写生成器从 miao-plugin（MIT）固定提交 929269ce 生成数据。
- OCRArtifacts 1.0.1 blob 5d069763637c695308fe0ef895edb0cd72cedf92 的固定网格参数可供实验参考；本项目重写扫描器，保留原始观测，不复制猜星级逻辑。
- 实验扫描器每件保存进度、两次面板读取核对，仍不能证明无漏扫或锁定状态，因此始终标记未验证。
- 配置采用独立规则与逐篇来源字段，未知角色不允许落入上游默认通用双暴评分。

## 2026-10-29 安装与订阅

- 实际新项目已由用户提交并推送，origin 为 xm-evanguo/bettergi-artifact-manager，HEAD cf6ba27。评分已改为 MIT 数据生成。
- 在线核对官方 main 的 ScriptRepoUpdater：自定义源、固定 release 分支、repo.json 索引；订阅 URI 导入当前源的相对路径，不接受任意 GitHub 项目作脚本。
- 本地主程序 875a941e 另有 Pulonia 多仓库管理，允许添加远程并指定分支；索引与 repo/ 结构仍须有效。不要把该本地能力泛称为官方版本能力。
- 当前项目不具备脚本仓库索引。提供可提交的 packages/ZIP，解压复制到 User/JsScript，不声称支持仓库 ZIP 导入按钮。
- 一次搜索误用了新项目 cwd 下的宿主路径，另一次 shell 通配符无匹配；已使用正确宿主路径直接核对。

## 2026-10-30 远程脚本仓库改造

- 在线核对 babalae/bettergi-scripts-list 的 build/build.js 与 build_release_branch.yml：根索引含 time/url/file/indexes；JS 目录节点使用 version/description/author/authors/tags/lastUpdated，项目作为叶节点，正文在 repo/js/。
- 官方主线及本地 ScriptRepoUpdater.GetRepoSubdirectoryTree 都读取 Git 提交中的 repo/ 子树；只检出 repo.json 并不表示代码放在 Git 根目录。
- 本地 PuloniaTaskResourceCatalog 同样解析 name/type/children/version，ScriptRepositorySnapshot 使用 repo/js/ 路径。
- 用户要求改为远程导入并取消安装包。采用 main 保留开发工具、release 快进到同一验证过的提交的方案，不用覆盖历史的孤儿分支或重复源码。
- 大型上游 release/repo.json 被 GitHub 读取工具拒绝，改查其索引生成器、发布工作流和宿主消费者；几次错误目录或通配符搜索已通过真实路径纠正。

- 已迁移到 repo/js/ArtifactManager；上游记录与 MIT 许可随脚本一起分发。索引正文指纹涵盖整个脚本目录，排除真实 saved_files；正文不变保持时间稳定，变化则严格递增。
- 添加 LF 换行约定，避免 Windows 的自动换行转换造成正文指纹失配。
- GitHub 工作流仅在 main 的测试与检查通过后，将同一提交以非强推方式快进到 release；PR 不发布。

- 提交前发现 MIT LICENSE 使用 CRLF，Git 的 LF 规则会转换正文并使原工作树指纹失配。已将本地许可证及数据生成器统一为 LF；上游 source.files 仍保存原始下载哈希。Git 导入测试增加带 .gitattributes 的完整提交导出与索引校验。
