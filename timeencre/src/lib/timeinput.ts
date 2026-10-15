// 自己的时刻输入框用的解析：浏览器自带的时间框跟随系统区域设置决定 12/24 小时制，没法按应用设置来。
// 接受 “9:30” “09.30” “21h30” “930” “2130” “9” “9:30pm” “下午9:30”；全角冒号也行。

export interface ParsedTime {
  h: number;
  mi: number;
  /** 已经输完整（可以边输边生效）：带分隔符且分钟两位、四位数字、或写了上午 / 下午 */
  complete: boolean;
}

/**
 * @param pm 12 小时制下没写上午 / 下午时用的半天（当前值的半天）；24 小时制传 null
 */
export function parseTime(raw: string, pm: boolean | null): ParsedTime | null {
  let s = raw.trim().toLowerCase().replace(/：/g, ':').replace(/\s+/g, '');
  if (!s) return null;
  let mark: 'am' | 'pm' | null = null;
  const pre = s.match(/^(上午|早上|凌晨|下午|晚上|中午)/);
  if (pre) {
    mark = /上午|早上|凌晨/.test(pre[1]) ? 'am' : 'pm';
    s = s.slice(pre[1].length);
  }
  const post = s.match(/(a\.?m?\.?|p\.?m?\.?)$/);
  if (post && /\d/.test(s.slice(0, -post[1].length))) {
    mark = post[1].startsWith('a') ? 'am' : 'pm';
    s = s.slice(0, -post[1].length);
  }
  let h: number;
  let mi: number;
  let complete: boolean;
  const sep = s.match(/^(\d{1,2})[:.,h](\d{0,2})$/);
  if (sep) {
    h = +sep[1];
    mi = sep[2] ? +sep[2] : 0;
    complete = sep[2].length === 2;
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) {
      h = +s;
      mi = 0;
    } else {
      h = +s.slice(0, s.length - 2);
      mi = +s.slice(-2);
    }
    complete = s.length === 4;
  } else {
    return null;
  }
  if (mi > 59) return null;
  if (mark) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mark === 'pm' ? 12 : 0);
    complete = complete || s.length >= 3;
  } else if (pm !== null && h >= 1 && h <= 12) {
    // 12 小时制、没写半天：沿用当前的上午 / 下午；写 13–23 或 0 就按 24 小时理解
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return { h, mi, complete };
}
