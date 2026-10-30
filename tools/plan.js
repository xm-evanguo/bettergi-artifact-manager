import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildPlan } from '../repo/js/ArtifactManager/lib/plan.js';
import { renderPlanReport } from '../repo/js/ArtifactManager/lib/plan-report.js';

/** 本地命令行入口：库存快照 + 角色配装 → 计划、报告和分解筛选脚本。 */
const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) throw new Error('用法：bun tools/plan.js <库存.json> <输出目录> [配装.json]');
const [inventory, directory, builds = 'repo/js/ArtifactManager/data/builds.json'] = args;
const plan = buildPlan(JSON.parse(await readFile(inventory, 'utf8')), JSON.parse(await readFile(builds, 'utf8')));
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2));
await writeFile(join(directory, 'plan.html'), renderPlanReport(plan));
await writeFile(join(directory, 'salvage-filter.txt'), plan.salvage.js);
console.log(JSON.stringify({ counts: plan.counts, blockers: plan.blockers, report: resolve(directory, 'plan.html') }, null, 2));
