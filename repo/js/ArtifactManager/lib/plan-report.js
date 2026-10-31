import { SLOT_NAMES } from './model.js';
import { escapeHtml } from './report.js';
import { gradeMin } from './scoring.js';

/** 可选的刷取目标档位。 */
const TARGETS = ['A', 'S', 'SS', 'SSS', 'ACE', 'MAX'];

/**
 * 刷取视图：只看选中的角色，按目标分数线重新判断未达标部位。角色按强化后预计总分从低到高；
 * 套装按差距（各未达标部位距目标线的分数之和）从高到低。报告页内联脚本复用此函数，须保持自包含。
 */
export function farmView(farming, names, target) {
  const rows = farming.filter(f => !names || names.includes(f.name)).map(f => {
    const weak = f.slots.filter(s => s.projected < target);
    return { ...f, weak, gap: Math.round(weak.reduce((n, s) => n + target - s.projected, 0) * 10) / 10 };
  }).sort((x, y) => x.total - y.total);
  const sets = new Map();
  for (const r of rows) for (const s of r.weak) {
    const v = sets.get(r.set) || { set: r.set, slots: 0, gap: 0, names: [] };
    v.slots++; v.gap += target - s.projected;
    if (!v.names.includes(r.name)) v.names.push(r.name);
    sets.set(r.set, v);
  }
  return { rows, sets: [...sets.values()].map(v => ({ ...v, gap: Math.round(v.gap * 10) / 10 })).sort((x, y) => y.gap - x.gap) };
}

/** 报告页内联脚本：按勾选角色与目标档位重绘刷取表，并筛选配装表。以 toString() 嵌入页面，须保持自包含（farmView 同样嵌入）。 */
function farmPage() {
  const data = JSON.parse(document.getElementById('farm-data').textContent);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const boxes = [...document.querySelectorAll('#chars input')];
  const target = document.getElementById('target');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('artifact-manager-farm') || 'null'); } catch {}
  if (saved) {
    if (Array.isArray(saved.names)) boxes.forEach(b => { b.checked = saved.names.includes(b.value); });
    if ([...target.options].some(o => o.value === String(saved.target))) target.value = String(saved.target);
  }
  const render = () => {
    const names = boxes.filter(b => b.checked).map(b => b.value), t = Number(target.value);
    try { localStorage.setItem('artifact-manager-farm', JSON.stringify({ names, target: t })); } catch {}
    const v = farmView(data.farming, names, t);
    document.getElementById('farm-body').innerHTML = v.rows.map((f, i) => `<tr><td>${i + 1}</td><th>${esc(f.name)}</th><td>${esc(f.set)}${f.complete ? '' : '<br><small>未凑齐 4 件套</small>'}</td><td>${f.now.toFixed(1)}</td><td><strong>${f.total.toFixed(1)}</strong></td><td>${f.gap.toFixed(1)}</td><td>${esc(f.weak.map(s => `${data.slotNames[s.slot]} ${s.projected.toFixed(1)}`).join('、') || '全部达标')}</td></tr>`).join('') || '<tr><td colspan="7">未选择角色</td></tr>';
    document.getElementById('set-body').innerHTML = v.sets.map(s => `<tr><th>${esc(s.set)}</th><td>${s.slots}</td><td>${s.gap.toFixed(1)}</td><td>${esc(s.names.join('、'))}</td></tr>`).join('') || '<tr><td colspan="4">无</td></tr>';
    document.getElementById('farm-count').textContent = `已选 ${names.length}/${boxes.length} 名角色`;
    document.querySelectorAll('tr[data-name]').forEach(r => { r.hidden = !names.includes(r.dataset.name); });
  };
  boxes.forEach(b => b.addEventListener('change', render));
  target.addEventListener('change', render);
  document.getElementById('all').addEventListener('click', () => { boxes.forEach(b => { b.checked = true; }); render(); });
  document.getElementById('none').addEventListener('click', () => { boxes.forEach(b => { b.checked = false; }); render(); });
  render();
}

/** 生成计划报告：每个角色的目标配装、强化清单、分解清单和分解筛选脚本。只读，不控制游戏。 */
export function renderPlanReport(plan) {
  const e = escapeHtml;
  const byId = new Map(plan.records.map(r => [r.id, r]));
  const piece = id => {
    const r = byId.get(id);
    if (!r) return '<td class="empty">缺</td>';
    const note = r.equippedBy && r.equippedBy !== r.character ? `<br><small>现由 ${e(r.equippedBy)} 穿戴</small>` : '';
    return `<td class="${r.grade && r.score >= plan.graduateScore ? 'done' : ''}"><strong>${e(r.grade || '-')}</strong> ${e(r.score?.toFixed(1) ?? '')}<br><small>${e(r.set)} +${e(r.level)}</small>${note}</td>`;
  };
  const loadouts = plan.loadouts.map(lo => `<tr data-name="${e(lo.name)}"><th>${e(lo.name)}<br><small>Lv.${e(lo.level)} · ${e(lo.set || '未凑齐 4 件套')}</small></th>${lo.slots.map(s => piece(s.id)).join('')}</tr>`).join('');
  const list = category => plan.records.filter(r => r.category === category)
    .map(r => {
      const where = r.location?.page ? `第 ${r.location.page} 页第 ${r.location.row} 行第 ${r.location.column} 列` : '';
      const stats = r.main ? `${r.main.key} ${r.main.value} | ${(r.subs || []).map(x => `${x.key} ${x.value}${x.active ? '' : '（待激活）'}`).join(' · ')}` : '';
      const core = r.category === 'upgrade' && r.core ? `核心副词条：${r.core.length ? r.core.join('、') : '无要求（主词条已满足）'}` : '';
      return `<li><strong>${e(r.name || r.id)}</strong> · ${e(r.set)} · ${e(SLOT_NAMES[r.slot] || '?')} +${e(r.level)}${r.character ? ` · ${e(r.character)}` : ''}<br><small>${e(stats)}</small>${core ? `<br><small>${e(core)}</small>` : ''}<br><small>${e([where, ...r.reasons].filter(Boolean).join('；'))}</small></li>`;
    }).join('') || '<li>无</li>';
  // 刷取优先级：页面加载后由内联脚本按所选角色与目标档位渲染；这里输出默认视图（全部角色、毕业线），无脚本时也能看。
  const farming = plan.farming || [];
  const view = farmView(farming, null, plan.graduateScore);
  const farmRows = view.rows.map((f, i) => `<tr><td>${i + 1}</td><th>${e(f.name)}</th><td>${e(f.set)}${f.complete ? '' : '<br><small>未凑齐 4 件套</small>'}</td><td>${f.now.toFixed(1)}</td><td><strong>${f.total.toFixed(1)}</strong></td><td>${f.gap.toFixed(1)}</td><td>${e(f.weak.map(s => `${SLOT_NAMES[s.slot]} ${s.projected.toFixed(1)}`).join('、') || '全部达标')}</td></tr>`).join('');
  const setRows = view.sets.map(v => `<tr><th>${e(v.set)}</th><td>${v.slots}</td><td>${v.gap.toFixed(1)}</td><td>${e(v.names.join('、'))}</td></tr>`).join('') || '<tr><td colspan="4">无</td></tr>';
  const farmData = JSON.stringify({ farming, slotNames: SLOT_NAMES, targets: TARGETS.map(g => [g, gradeMin(g)]), target: plan.graduateScore }).replace(/</g, '\\u003c');
  const chips = farming.map(f => f.name).toSorted((a, b) => plan.loadouts.findIndex(l => l.name === a) - plan.loadouts.findIndex(l => l.name === b))
    .map(n => `<label class="chip"><input type="checkbox" value="${e(n)}" checked> ${e(n)}</label>`).join('');
  const labels = { keep: '保留', upgrade: '待强化', discard: '分解', review: '待复查', fodder: '材料' };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>圣遗物整理计划</title><style>
body{font:15px/1.6 system-ui,sans-serif;color:#20313b;background:#f4f5f1;margin:0}main{max-width:1200px;margin:auto;padding:28px 16px}h1{margin:0 0 4px}h2{margin-top:32px}.cards{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.card{flex:1;min-width:100px;background:#fff;padding:14px;border:1px solid #d5ded7;border-radius:8px}.card strong{display:block;font-size:26px}.notice{border-left:4px solid #b85c1c;background:#fff0dc;padding:12px 16px}.wrap{overflow-x:auto}table{border-collapse:collapse;background:#fff;width:100%;min-width:720px}th,td{border:1px solid #dce3de;padding:8px;text-align:left;vertical-align:top}thead th{background:#e3ebe4}td.done{background:#e4f3e7}td.empty{color:#a33}small{color:#52626c}textarea{width:100%;min-height:140px;font:12px monospace}li{margin:6px 0}.filter{background:#fff;border:1px solid #d5ded7;border-radius:8px;padding:12px;margin:12px 0}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{border:1px solid #c9d4cc;border-radius:16px;padding:2px 10px;white-space:nowrap}.filter button{margin-right:6px}
</style></head><body><main><h1>圣遗物整理计划</h1><p><small>${e(plan.generatedAt)} · 毕业线 ${e(plan.graduateGrade)}（${e(plan.graduateScore)} 分起，绿色为已毕业）</small></p>
${plan.blockers.length ? `<div class="notice"><strong>分解清单已关闭</strong><ul>${plan.blockers.map(b => `<li>${e(b)}</li>`).join('')}</ul></div>` : ''}
<div class="cards">${Object.entries(labels).map(([k, v]) => `<div class="card">${v}<strong>${plan.counts[k]}</strong></div>`).join('')}</div>
<h2>筛选角色</h2><div class="filter"><div><button type="button" id="all">全选</button><button type="button" id="none">清空</button><label>目标档位 <select id="target">${TARGETS.map(g => `<option value="${gradeMin(g)}"${gradeMin(g) === plan.graduateScore ? ' selected' : ''}>${g}（${gradeMin(g)} 分起）</option>`).join('')}</select></label> <span id="farm-count"></span></div><div class="chips" id="chars">${chips}</div><small>勾选的角色同时筛选下面的配装表和刷取表；选择会保存在本浏览器。</small></div>
<h2>每个角色的目标配装</h2><div class="wrap"><table><thead><tr><th>角色</th>${SLOT_NAMES.map(n => `<th>${n}</th>`).join('')}</tr></thead><tbody>${loadouts}</tbody></table></div>
<h2>需要刷的圣遗物</h2><p><small>每个部位取当前件与强化候选件强化到满级的期望分中较高者（期望按平均强化估算，不是实际结果），按角色总分从低到高排列。</small></p>
<div class="wrap"><table><thead><tr><th>#</th><th>角色</th><th>刷取套装</th><th>当前总分</th><th>强化后预计</th><th>距目标差距</th><th>未达标部位（预计分）</th></tr></thead><tbody id="farm-body">${farmRows}</tbody></table></div>
<h3>按套装汇总</h3><p><small>差距 = 所选角色各未达标部位距目标线的分数之和，越大越值得刷。</small></p>
<div class="wrap"><table><thead><tr><th>套装</th><th>未达标部位数</th><th>差距</th><th>相关角色</th></tr></thead><tbody id="set-body">${setRows}</tbody></table></div>
<h2>待强化（${plan.counts.upgrade}）</h2><p><small>+4、+8、+12 三次中歪两次即停止；+12 时最多歪一次则强化到满级（五星 +20，四星 +16）。</small></p><ul>${list('upgrade')}</ul>
<h2>分解（${plan.counts.discard}）</h2><ul>${list('discard')}</ul>
${plan.counts.discard ? `<h2>BetterGI 自动分解筛选脚本</h2><p><small>复制到 BetterGI「自动分解」的 JavaScript 设置中。只匹配上面分解清单里属性完全一致的圣遗物。${plan.salvage.skipped.length ? `有 ${plan.salvage.skipped.length} 件因库存中存在同属性保留件而跳过。` : ''}</small></p><textarea readonly>${e(plan.salvage.js)}</textarea>` : ''}
<h2>作强化材料（${plan.counts.fodder}）</h2><p><small>不需要的四星及以下，喂给待强化件前请核对。</small></p><ul>${list('fodder')}</ul>
<h2>待复查（${plan.counts.review}）</h2><ul>${list('review')}</ul>
</main><script type="application/json" id="farm-data">${farmData}</script><script>
${farmView.toString()}
(${farmPage.toString()})();
</script></body></html>`;
}
