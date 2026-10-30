# 圣遗物整理助手 0.1.1

这是原型。通过 BetterGI 的远程脚本仓库导入本项目；仓库为 https://github.com/xm-evanguo/bettergi-artifact-manager ，分支为 `release`，脚本路径为 `js/ArtifactManager`。完整安装步骤见[项目说明](https://github.com/xm-evanguo/bettergi-artifact-manager#readme)。不要只复制 main.js，也不要用于内置自动分解表达式。

## 首次运行

选择“示例报告”，运行后打开本目录下 `saved_files/report-时间戳.html`。示例为虚构库存，不是你的账号或当前版本攻略。默认模式不读取游戏。

## 分析真实快照

1. 将 `data/default-config.json` 复制为 `saved_files/config.json`，填写角色、已核对的玩法规则和来源版本。
2. 将标准库存快照或 OCRArtifacts 导出的数组放入 `saved_files/inventory.json`。
3. 选择“分析快照”。主力和备用角色可在设置中填写；不填写则使用配置文件中的角色。
4. 打开生成的 HTML 报告，查看保留、优先试强化、可清理及待复查。

规则和数据完整性未确认时，清理建议会关闭。OCRArtifacts 数组缺少可靠的星级、锁定和扫描完整性字段，不能直接清理。不要将示例配置用于真实库存。

## 实验扫描

手动打开简体中文圣遗物背包，取消筛选并滚到顶部，使用 1920×1080 画面。勾选“已准备”，先读取一页。

该模式只点击格子、滚动和读取 OCR，每件保存进度。锁定、星级及翻页尚未实机验收，结果始终标记为未验证；当前不能用于完整清仓。不要通过手工修改 complete/verified 跳过实际核对。

本项目不执行分解、强化、解锁或卸装。报告旧坐标会在排序、强化后失效。未实现攻略自动更新和全局最优配装。

真实数据只放在 `saved_files`，不要提交到仓库。清单已声明该目录供宿主更新保留，更新前可自行备份。评分数据来自 miao-plugin（MIT），版本见 [upstream-lock.json](upstream-lock.json)，许可记录见 [THIRD_PARTY.md](THIRD_PARTY.md) 和 [MIT 许可证](vendor/miao-plugin.LICENSE)。
