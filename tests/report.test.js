import { test, expect } from 'bun:test';
import { analyze } from '../repo/js/ArtifactManager/lib/analyze.js';
import { renderReport } from '../repo/js/ArtifactManager/lib/report.js';
import { item, config, snapshot } from './helpers.js';

test('报告的真实内联脚本可搜索、筛选与排序', () => {
  const report = analyze(snapshot([item('first'), item('second')]), config());
  const html = renderReport(report);
  const script = html.match(/<script>([\s\S]+)<\/script>/)[1];
  const handlers = {};
  const control = (name, value) => ({ value, addEventListener: (event, fn) => { handlers[`${name}:${event}`] = fn; } });
  const rows = [
    { dataset: { category: 'keep', order: '999999' }, textContent: '雷电将军 绝缘之旗印', hidden: false },
    { dataset: { category: 'upgrade', order: '1' }, textContent: '香菱 潜力件', hidden: false },
  ];
  const ordered = [];
  const elements = { '#search': control('search', ''), '#category': control('category', 'all'), '#sort': control('sort', 'original'), '#visible': {}, tbody: { appendChild: row => ordered.push(row) } };
  new Function('document', script)({ querySelector: key => elements[key], querySelectorAll: () => rows });
  expect(elements['#visible'].textContent).toBe('显示 2 件');
  elements['#search'].value = '香菱'; handlers['search:input'](); expect(rows[0].hidden).toBe(true); expect(rows[1].hidden).toBe(false);
  elements['#search'].value = ''; elements['#category'].value = 'keep'; handlers['category:change'](); expect(rows[0].hidden).toBe(false); expect(rows[1].hidden).toBe(true);
  handlers['sort:change']({ target: { value: 'upgrade' } }); expect(ordered[0]).toBe(rows[1]);
});
