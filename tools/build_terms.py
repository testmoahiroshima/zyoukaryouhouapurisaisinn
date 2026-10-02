# 症状の言葉 → その言葉が出てくる全集の項（巻・頁・年）の索引を作る：python3 tools/build_terms.py
# 本文はこのリポジトリ直下の *_utf8.txt。宗教的な語の少ない項・療術期の項を優先して上位5件を残す。
import re, glob, os, json
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = ["お守り", "御守護", "明主", "メシヤ", "入信", "本教", "御神体", "信者", "観音", "神様", "浄霊", "御浄霊", "信仰"]
KANJI = '〇一二三四五六七八九十'

items = []
for f in sorted(glob.glob(os.path.join(R, '*_utf8.txt'))):
    stem = os.path.basename(f).replace('_utf8.txt', '').replace('講話', 'kowa')
    if stem == 'shiika':
        continue
    t = open(f, encoding='utf-8').read()
    parts = re.split(r'─+\n■■(.*?)■■\n─+\n', t)
    for k, i in enumerate(range(1, len(parts) - 1, 2)):
        body = re.sub(r'<[^>]*>', '', parts[i + 1])
        head = body[:300]
        pg = re.search(r'(講話篇|著述篇)第?([一二三四五六七八九十]+)巻\s*p?(\d+)', head)
        y = re.search(r'(1[89]\d{2})\d{4}', parts[i] + head)
        vol = re.match(r'(chojutsu|kowa)(\d+)', stem)
        volname = f"{'講話篇' if vol.group(1) == 'kowa' else '著述篇'}{['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][int(vol.group(2))]}巻"
        items.append({
            'id': f'{stem}#{k}',
            'page': f'{pg.group(1)}{pg.group(2)}巻p{int(pg.group(3))}' if pg else volname,
            'year': int(y.group(1)) if y else None,
            'rel': sum(body.count(x) for x in REL),
            'body': body,
        })

terms = set()
for name in ('symptoms', 'kenkai'):
    d = json.load(open(os.path.join(R, 'data', f'{name}.json'), encoding='utf-8'))
    for c in d.get('categories', []) + d.get('entries', []):
        for kw in c['keywords']:
            if len(kw) >= 2 or kw in ('痒', '咳', '痰', '痔', '胃', '腰', '膝', '鼻', '喉', '首', '肩'):
                terms.add(kw)

out = {}
for term in sorted(terms):
    hits = []
    for it in items:
        n = it['body'].count(term)
        if n and it['page']:
            hits.append((it['rel'] > 5, it['rel'], -(1 if it['year'] and it['year'] < 1948 else 0), -n, it))
    hits.sort(key=lambda h: h[:4])
    if hits:
        out[term] = [[h[4]['id'], h[4]['page'], h[4]['year']] for h in hits[:5]]
json.dump({'_note': '症状の言葉が出てくる全集の項（参考・未確認）。[id, 巻頁, 年]。宗教的な語の少ない項・昭和20年代前半までの項を優先。tools/build_terms.py で作成。', 'terms': out},
          open(os.path.join(R, 'data', 'zenshu_terms.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(terms), 'terms,', len(out), 'with hits')
