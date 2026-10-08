// 界面多语言。中文原文就是查找键：tr('已记录 {0}', x)；法语词典缺条目时回退到中文。
// 语言只保存在本机（localStorage），切换时整页刷新——模块里的常量文字在加载时就按当前语言求值。
import { fr } from './fr';

export type Lang = 'zh' | 'fr';
export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'zh', label: '中文' },
  { id: 'fr', label: 'Français' },
];

const KEY = 'timeencre.lang';

function readLang(): Lang {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    if (v === 'fr' || v === 'zh') return v;
  } catch {
    /* 无法访问存储时用默认语言 */
  }
  return 'zh';
}

let current: Lang = readLang();
if (typeof document !== 'undefined') document.documentElement.lang = current === 'fr' ? 'fr' : 'zh-CN';

export const getLang = (): Lang => current;

/** Intl 用的区域代码 */
export const locale = (): string => (current === 'fr' ? 'fr-FR' : 'zh-CN');

/** 切换语言并刷新页面 */
export function switchLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* 存不下就只对本次生效 */
  }
  location.reload();
}

/** 仅测试用 */
export function _setLangForTest(l: Lang) {
  current = l;
}

/**
 * 翻译。{0}、{1}… 依次替换为参数。
 * 同一个中文词在不同语境需要不同译法时，用“原文|语境”作键：中文只显示竖线前的部分。
 */
export function tr(zh: string, ...args: Array<string | number>): string {
  const plain = zh.includes('|') ? zh.slice(0, zh.indexOf('|')) : zh;
  const s = current === 'fr' ? (fr[zh] ?? plain) : plain;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m)) : s;
}
