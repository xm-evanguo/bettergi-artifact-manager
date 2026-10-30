# 上游复用记录

上游来源与固定版本记录在 [upstream-lock.json](upstream-lock.json)。运行时不下载或执行外部代码，未引入外置 exe。

## miao-plugin 评分数据

- 来源：[miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin)，MIT 许可，固定提交 `929269ce17497bb4f6478f1dd785481744f05ee0`。
- 生成方式：`bun run data` 运行本项目自写的 `tools/build-miao-data.js`，生成 `script/ArtifactManager/vendor/miao-data.js`。生成器只按文本解析数据，不执行下载的代码，并记录每个源文件的 SHA-256。
- 使用的数据：`resources/meta-gs/artifact/artis-mark.js` 的角色权重（`usefulAttr`）、`extra.js` 的词条常量、`character/data.json` 的角色元素、各角色 `data.json` 的基础属性。
- 许可证：生成器同时从同一提交下载 `LICENSE`，保存为 `vendor/miao-plugin.LICENSE`，原始版权声明保留。
- 参考分：`lib/scoring.js` 按 miao-plugin `models/artis/ArtisMark.js` 与 `ArtisMarkCfg.js` 的公式自行实现。未移植角色专属规则和武器加成，所以只作参考，不参与清理判断。
- 未知角色先检查权重表，不回退到通用双暴权重。

早期原型曾使用 bettergi-scripts-list 中 ArtifactScore 脚本的独立评分模块。该仓库没有声明许可证，因此在公开前已移除，改为直接从 MIT 上游生成。

## OCRArtifacts

[上游脚本](https://github.com/babalae/bettergi-scripts-list/tree/main/repo/js/OCRArtifacts)核对时版本 1.0.1，作者 zlh。`main.js` blob 为 `5d069763637c695308fe0ef895edb0cd72cedf92`。

本项目参考其 1920×1080、8 列 5 行网格及翻页参数，重新编写扫描编排和解析器，未原样复制主脚本、解析类或素材。新增两次稳定读取、每件检查点、错误退出、页数限制、保护字段未知标记；未采用按套装猜测星级的逻辑。

该固定网格仍有末页、滚动偏移和重复页风险，不能把它视为可靠库存扫描。保留相同属性的多件物品；页首完全相同则保守停止，不强行判为同一件。

## BetterGI 宿主

接口按 BetterGI 主程序源码 `875a941e` / 0.66.3-alpha.1 核对：Manifest、SettingItem、LimitedFile、EngineExtend、ScriptProject 和 ScriptExecution。没有复制或修改主程序 C#。

入口采用模块顶层 await，让宿主等待异步扫描结束；依据同仓库的模块生命周期测试及执行器接口，仍需 Windows 验证实际运行。
