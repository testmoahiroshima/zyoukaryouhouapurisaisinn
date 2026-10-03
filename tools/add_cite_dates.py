# 出典に年月を入れる：python3 tools/add_cite_dates.py
# 画面では「岡田茂吉全集」と書かず「昭和〇年〇月」と示すため、cites の各項に date（YYYYMM または YYYY）を入れる。
# 年月は data/zenshu_index.jsonl の date（無ければ本文の出典欄から読む）による。
import json, re, glob, os
R = os.path.join(os.path.dirname(__file__), '..')
idx = {}
for line in open(os.path.join(R, 'data/zenshu_index.jsonl'), encoding='utf8'):
    line = line.strip()
    if line:
        r = json.loads(line)
        idx[r['id']] = r

def ym_of(c):
    r = idx.get(c.get('id'))
    cands = []
    if r:
        if r.get('date'): cands.append(r['date'])
        cands += re.findall(r'(19[1-5]\d)(\d\d)(\d\d)', r.get('source') or '')
    for d in cands:
        if isinstance(d, tuple): d = ''.join(d)
        y, m = d[:4], d[4:6]
        if y.isdigit() and m.isdigit() and 1 <= int(m) <= 12:
            return f'{y}{m}'
    y = c.get('year') or (r or {}).get('year')
    return str(y) if y else None

n = miss = 0
for f in ['knowledge', 'kenkai', 'changes', 'flows', 'symptoms', 'concepts']:
    p = os.path.join(R, f'data/{f}.json')
    d = json.load(open(p, encoding='utf8'))
    def walk(o):
        global n, miss
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'cites' and isinstance(v, list):
                    for c in v:
                        if isinstance(c, dict):
                            ym = ym_of(c)
                            if ym: c['date'] = ym; n += 1
                            else: miss += 1
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(d)
    json.dump(d, open(p, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    open(p, 'a').write('\n') if f == 'body_points' else None
print('dated', n, 'missing', miss)
