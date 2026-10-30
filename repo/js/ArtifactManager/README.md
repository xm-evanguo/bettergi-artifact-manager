# 圣遗物整理助手 0.2.0

这是原型。通过 BetterGI 的远程脚本仓库导入本项目；仓库为 https://github.com/xm-evanguo/bettergi-artifact-manager ，分支为 `release`，脚本路径为 `js/ArtifactManager`。完整安装步骤见[项目说明](https://github.com/xm-evanguo/bettergi-artifact-manager#readme)。不要只复制 main.js。

## 使用

使用 1920×1080、简体中文客户端。默认运行方式「扫描并生成计划」会读取游戏：自动回主界面、按 B 打开背包、切到圣遗物页，逐件读取全部圣遗物。只点击格子、滚动和读取文字，不分解、不强化、不解锁、不卸装。

| 运行方式 | 说明 |
| --- | --- |
| 扫描并生成计划（默认） | 扫描后写入 `saved_files/inventory.json`、`plan.json`、`plan.html`、`salvage-filter.js` |
| 继续上次扫描 | 上次扫描中途停止时使用：快速翻到停下的位置（每页核对首行），读完剩余件后生成计划。两次之间不要获得、分解或强化圣遗物，否则请重新完整扫描 |
| 用上次扫描生成计划 | 不操作游戏；修改 `data/builds.json` 后重新计算 |
| 示例报告 | 不操作游戏，用虚构库存生成演示报告 |

首次建议把「最多扫描页数」设为 1 或 2 试跑，确认读取正确。只扫部分页时不会生成分解清单。

打开 `saved_files/plan.html` 查看每个角色的目标配装，以及待强化、分解、待复查清单。要分解时，把报告底部的筛选脚本（即 `salvage-filter.js`）粘贴到 BetterGI「自动分解」的 JavaScript 设置中；只有与清单完全一致的圣遗物会被选中，锁定的游戏本身不会分解。

角色配装在 `data/builds.json`。毕业线默认 SSS（42 分起）。强化规则：+4、+8、+12 三次中歪两次即停止；+12 时最多歪一次则强化到满级（五星 +20，四星 +16）。

报告里的位置（第几页第几行第几列）会在排序、强化后失效，操作后请重新扫描。

真实数据只放在 `saved_files`，不要提交到仓库。清单已声明该目录供宿主更新保留，更新前可自行备份。评分数据来自 miao-plugin（MIT），版本见 [upstream-lock.json](upstream-lock.json)，许可记录见 [THIRD_PARTY.md](THIRD_PARTY.md) 和 [MIT 许可证](vendor/miao-plugin.LICENSE)。
