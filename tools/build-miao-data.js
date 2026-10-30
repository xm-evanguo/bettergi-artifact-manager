import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

/**
 * 从固定提交的 miao-plugin（MIT）抽取评分数据，生成 vendor/miao-data.js。
 * 只按文本解析数据，不执行下载的代码。更新数据时修改 COMMIT 后重新运行。
 */
const COMMIT = '929269ce17497bb4f6478f1dd785481744f05ee0';
const RAW = `https://raw.githubusercontent.com/yoimiya-kokomi/miao-plugin/${COMMIT}/`;
const OUTPUT = 'repo/js/ArtifactManager/vendor/miao-data.js';
const LICENSE = 'repo/js/ArtifactManager/vendor/miao-plugin.LICENSE';
const files = {};

/** 下载一个上游文件并记录 SHA-256；缺失时返回 null。 */
async function fetchText(path, optional = false) {
  const response = await fetch(RAW + path.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok) {
    if (optional && response.status === 404) return null;
    throw new Error(`下载失败 ${response.status}：${path}`);
  }
  const text = await response.text();
  files[path] = createHash('sha256').update(text).digest('hex');
  return text;
}

/** 取出 `export const name = {...}` 的对象正文。 */
function block(text, name) {
  const match = text.match(new RegExp(`export const ${name} = \\{\\n([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`上游格式已变化，找不到 ${name}`);
  return match[1].split('\n').map(s => s.trim()).filter(Boolean);
}

/** 只接受由数字和乘除号组成的常量表达式。 */
function constant(expr) {
  if (!/^[\d.\s*/]+$/.test(expr)) throw new Error(`不支持的常量表达式：${expr}`);
  return expr.split('*').map(part => part.split('/').map(Number).reduce((a, b) => a / b)).reduce((a, b) => a * b);
}

const extra = await fetchText('resources/meta-gs/artifact/extra.js');
const basicNum = Number(extra.match(/export const basicNum = ([\d.]+)/)?.[1]);
if (!Number.isFinite(basicNum)) throw new Error('上游格式已变化，找不到 basicNum');
const attrPct = Object.fromEntries(block(extra, 'attrPct').map(line => {
  const m = line.match(/^(\w+): (.+?),?$/);
  if (!m) throw new Error(`无法解析 attrPct 行：${line}`);
  return [m[1], constant(m[2])];
}));

const usefulAttr = Object.fromEntries(block(await fetchText('resources/meta-gs/artifact/artis-mark.js'), 'usefulAttr').map(line => {
  const m = line.match(/^([^:\s]+): \{([^}]*)\},?$/);
  if (!m) throw new Error(`无法解析 usefulAttr 行：${line}`);
  return [m[1], Object.fromEntries(m[2].split(',').map(pair => {
    const [key, value] = pair.split(':').map(s => s.trim());
    if (!/^\w+$/.test(key) || !/^\d+$/.test(value)) throw new Error(`无法解析权重：${pair}`);
    return [key, Number(value)];
  }))];
}));

// 元素取自角色索引，基础属性取自各角色目录；缺失时评分使用 miao-plugin 的默认基础属性。
const index = Object.values(JSON.parse(await fetchText('resources/meta-gs/character/data.json')));
const characters = {};
for (const name of Object.keys(usefulAttr)) {
  const data = await fetchText(`resources/meta-gs/character/${name}/data.json`, true);
  const baseAttr = data ? JSON.parse(data).baseAttr : null;
  characters[name] = {
    elem: index.find(c => c.name === name)?.elem || '',
    baseAttr: baseAttr && ['hp', 'atk', 'def'].every(k => Number.isFinite(baseAttr[k])) ? { hp: baseAttr.hp, atk: baseAttr.atk, def: baseAttr.def } : null,
  };
}

// 许可证随数据一起更新，确保与数据来自同一提交。
// 仅统一本地许可文本的换行；source.files 仍记录上游原始下载的哈希。
await writeFile(LICENSE, (await fetchText('LICENSE')).replace(/\r\n/g, '\n'));
const source = { repository: 'yoimiya-kokomi/miao-plugin', commit: COMMIT, license: 'MIT', files };
const header = `// 由 tools/build-miao-data.js 生成，请勿手动修改。\n// 数据来自 miao-plugin（MIT 许可），版权声明与许可全文见 miao-plugin.LICENSE。\n`;
await writeFile(OUTPUT, `${header}export default ${JSON.stringify({ source, basicNum, attrPct, usefulAttr, characters }, null, 2)};\n`);
console.log(`已生成 ${OUTPUT}：${Object.keys(usefulAttr).length} 个角色，${Object.values(characters).filter(c => !c.baseAttr).length} 个缺少基础属性。`);
