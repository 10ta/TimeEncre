// 多语言覆盖检查：界面里的中文都要经过 tr()，且法语词典每个键都有翻译。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import traverseMod from '@babel/traverse';
import { fr } from '../src/i18n/fr';
import { _setLangForTest, tr } from '../src/i18n';

const traverse = (traverseMod as unknown as { default: typeof traverseMod }).default ?? traverseMod;
const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/;
/** 只含数据（默认活动的中法文名称）、不含界面文字的文件 */
const DATA_FILES = ['src/db/defaults.ts'];

function sources(): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) {
        if (!p.endsWith('i18n')) walk(p);
      } else if (/\.(ts|tsx)$/.test(f) && !DATA_FILES.includes(p)) out.push(p);
    }
  })('src');
  return out;
}

function scan() {
  const keys = new Set<string>();
  const untranslated: string[] = [];
  for (const f of sources()) {
    const code = readFileSync(f, 'utf8');
    const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const where = (n: { loc?: { start: { line: number } } | null }) => `${f}:${n.loc?.start.line}`;
    // @ts-expect-error babel 的类型与默认导出形式不完全一致
    traverse(ast, {
      StringLiteral(p: any) {
        const n = p.node;
        const isKey = p.parent.type === 'CallExpression' && p.parent.callee.name === 'tr' && p.parent.arguments[0] === n;
        if (isKey) return void keys.add(n.value);
        if (CJK.test(n.value) && !/\\u/.test(n.extra?.raw ?? '')) untranslated.push(`${where(n)} ${n.value}`);
      },
      JSXText(p: any) {
        if (CJK.test(p.node.value)) untranslated.push(`${where(p.node)} ${p.node.value.trim()}`);
      },
      TemplateLiteral(p: any) {
        if (p.node.quasis.some((q: any) => CJK.test(q.value.cooked))) untranslated.push(`${where(p.node)} \`template\``);
      },
    });
  }
  return { keys, untranslated };
}

describe('多语言', () => {
  const { keys, untranslated } = scan();
  it('界面中文都经过 tr()', () => {
    expect(untranslated).toEqual([]);
  });
  it('法语词典覆盖全部键，且没有多余的键', () => {
    expect([...keys].filter((k) => !(k in fr))).toEqual([]);
    expect(Object.keys(fr).filter((k) => !keys.has(k))).toEqual([]);
  });
  it('占位符数量一致', () => {
    const count = (s: string) => (s.match(/\{\d+\}/g) ?? []).length;
    expect([...keys].filter((k) => k in fr && count(k) !== count(fr[k]))).toEqual([]);
  });
  it('切换语言后返回法语并替换参数', () => {
    _setLangForTest('fr');
    const k = [...keys].find((x) => x.includes('{0}'))!;
    expect(tr(k, 'X')).not.toMatch(CJK);
    _setLangForTest('zh');
  });
});

describe('语境键', () => {
  it('中文只显示竖线前的部分，法语按语境翻译', () => {
    expect(tr('活动|字段')).toBe('活动');
    _setLangForTest('fr');
    expect(tr('活动|字段')).toBe('Activité');
    expect(tr('活动')).toBe('Activités');
    _setLangForTest('zh');
  });
});
