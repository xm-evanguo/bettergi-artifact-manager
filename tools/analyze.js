import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { analyze } from '../repo/js/ArtifactManager/lib/analyze.js';
import { renderReport } from '../repo/js/ArtifactManager/lib/report.js';

/** 本地命令行入口；与 BetterGI 使用同一决策层。 */
const args = process.argv.slice(2);
if (args.length !== 3) throw new Error('用法：bun tools/analyze.js <库存.json> <配置.json> <输出目录>');
const [inventory, config, directory] = args;
const report = analyze(JSON.parse(await readFile(inventory, 'utf8')), JSON.parse(await readFile(config, 'utf8')));
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(join(directory, 'report.html'), renderReport(report));
console.log(JSON.stringify({ counts: report.counts, blockers: report.blockers, report: resolve(directory, 'report.html') }, null, 2));
