import { SLOT_NAMES } from './model.js';
import { escapeHtml } from './report.js';

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
  const loadouts = plan.loadouts.map(lo => `<tr><th>${e(lo.name)}<br><small>Lv.${e(lo.level)} · ${e(lo.set || '未凑齐 4 件套')}</small></th>${lo.slots.map(s => piece(s.id)).join('')}</tr>`).join('');
  const list = category => plan.records.filter(r => r.category === category)
    .map(r => {
      const where = r.location?.page ? `第 ${r.location.page} 页第 ${r.location.row} 行第 ${r.location.column} 列` : '';
      const stats = r.main ? `${r.main.key} ${r.main.value} | ${(r.subs || []).map(x => `${x.key} ${x.value}${x.active ? '' : '（待激活）'}`).join(' · ')}` : '';
      return `<li><strong>${e(r.name || r.id)}</strong> · ${e(r.set)} · ${e(SLOT_NAMES[r.slot] || '?')} +${e(r.level)}${r.character ? ` · ${e(r.character)}` : ''}<br><small>${e(stats)}</small><br><small>${e([where, ...r.reasons].filter(Boolean).join('；'))}</small></li>`;
    }).join('') || '<li>无</li>';
  const labels = { keep: '保留', upgrade: '待强化', discard: '分解', review: '待复查', fodder: '材料' };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>圣遗物整理计划</title><style>
body{font:15px/1.6 system-ui,sans-serif;color:#20313b;background:#f4f5f1;margin:0}main{max-width:1200px;margin:auto;padding:28px 16px}h1{margin:0 0 4px}h2{margin-top:32px}.cards{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.card{flex:1;min-width:100px;background:#fff;padding:14px;border:1px solid #d5ded7;border-radius:8px}.card strong{display:block;font-size:26px}.notice{border-left:4px solid #b85c1c;background:#fff0dc;padding:12px 16px}.wrap{overflow-x:auto}table{border-collapse:collapse;background:#fff;width:100%;min-width:720px}th,td{border:1px solid #dce3de;padding:8px;text-align:left;vertical-align:top}thead th{background:#e3ebe4}td.done{background:#e4f3e7}td.empty{color:#a33}small{color:#52626c}textarea{width:100%;min-height:140px;font:12px monospace}li{margin:6px 0}
</style></head><body><main><h1>圣遗物整理计划</h1><p><small>${e(plan.generatedAt)} · 毕业线 ${e(plan.graduateGrade)}（${e(plan.graduateScore)} 分起，绿色为已毕业）</small></p>
${plan.blockers.length ? `<div class="notice"><strong>分解清单已关闭</strong><ul>${plan.blockers.map(b => `<li>${e(b)}</li>`).join('')}</ul></div>` : ''}
<div class="cards">${Object.entries(labels).map(([k, v]) => `<div class="card">${v}<strong>${plan.counts[k]}</strong></div>`).join('')}</div>
<h2>每个角色的目标配装</h2><div class="wrap"><table><thead><tr><th>角色</th>${SLOT_NAMES.map(n => `<th>${n}</th>`).join('')}</tr></thead><tbody>${loadouts}</tbody></table></div>
<h2>待强化（${plan.counts.upgrade}）</h2><p><small>+4、+8、+12 三次中歪两次即停止；+12 时最多歪一次则强化到 +20。</small></p><ul>${list('upgrade')}</ul>
<h2>分解（${plan.counts.discard}）</h2><ul>${list('discard')}</ul>
${plan.counts.discard ? `<h2>BetterGI 自动分解筛选脚本</h2><p><small>复制到 BetterGI「自动分解」的 JavaScript 设置中。只匹配上面分解清单里属性完全一致的圣遗物。${plan.salvage.skipped.length ? `有 ${plan.salvage.skipped.length} 件因库存中存在同属性保留件而跳过。` : ''}</small></p><textarea readonly>${e(plan.salvage.js)}</textarea>` : ''}
<h2>待复查（${plan.counts.review}）</h2><ul>${list('review')}</ul>
</main></body></html>`;
}
