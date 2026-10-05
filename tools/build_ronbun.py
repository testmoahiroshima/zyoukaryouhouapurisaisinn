# 判断の根拠にしている岡田先生の論文・講話を、アプリで読めるように整える：python3 tools/build_ronbun.py
# 元の本文（リポジトリ直下の chojutsu*_utf8.txt・講話*_utf8.txt）から、data の各ファイルが根拠として引いている記事（cites の id）を取り出し、
#  - 精神面・宗教面の文を外し（tools/ronbun_edits.json の言い換え・抜粋で、意味がつながるように整える）
#  - 「浄霊」は「浄化療法」に直し
#  - 出典は「岡田先生 昭和〇年〇月」で示す（本の名前・巻・ページは出さない）
# data/ronbun.json に書き出す。外し残しがあれば止まる。
import re, json, glob, os, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'

FILES = {}
for f in glob.glob(R + 'chojutsu*_utf8.txt'): FILES[os.path.basename(f).replace('_utf8.txt', '')] = f
for f in glob.glob(R + '講話*_utf8.txt'): FILES['kowa' + os.path.basename(f)[2:4]] = f
FILES['kowa04'] = R + 'kowa04_utf8.txt'
ARTS = {}
for stem, f in sorted(FILES.items()):
    t = open(f, encoding='utf-8').read()
    parts = re.split(r'─+\n■■(.*?)■■\n─+\n', t)
    for n, i in enumerate(range(1, len(parts) - 1, 2)):
        ARTS[f'{stem}#{n}'] = (parts[i].strip(), parts[i + 1])

# 根拠として引いている記事（確かめた引用 cites のみ。流れ・変化の「候補」は含めない）
def cited():
    ids = {}
    for name in ['knowledge', 'kenkai', 'concepts', 'body_points', 'symptoms']:
        d = json.load(open(R + f'data/{name}.json', encoding='utf-8'))
        def walk(x):
            if isinstance(x, dict):
                if isinstance(x.get('id'), str) and re.match(r'(chojutsu|kowa)\d+#\d+$', x['id']) and ('page' in x or 'date' in x or 'year' in x):
                    c = ids.setdefault(x['id'], {'date': None})
                    d0 = str(x.get('date') or x.get('year') or '')
                    if len(d0) > len(c['date'] or ''): c['date'] = d0
                for v in x.values(): walk(v)
            elif isinstance(x, list):
                for v in x: walk(v)
        walk(d)
    return ids

# 精神面・宗教面の語（この語を含む文は、言い換えで外れない限り載せない）
SPIRIT = re.compile(r'造物主|霊|(?<!精)神(?!経|秘)|仏|観音|明主|メシヤ|信仰|信者|信徒|入信|守護|お守|御守|祈|天国|地獄|救世|本教|教団|宗教|龍|狐|憑|悪魔|因縁|祖先|光明|御光|お光|想念|邪霊|邪神|布教|御利益|御神|主神|大神|御教|天恵|奇蹟|奇跡|善言|讃詞|祝詞|拝|功徳|御用|浄土|弥勒|ミロク|みろく|夜昼|昼の世界|夜の世界|火素|水素|霊気|御垂示|お詫び|参拝|祀|祭|魂|天地|経綸|救い|救わ|大先生|御屏風|如来|奉斎|大光明|教修|入会|会員|支部|御面会|面会')
# 医療をやめる・放っておくよう読める文（注を添える）
MEDCARE = re.compile(r'[^。]*(?:医療をやめ|医療を止め|医療を受けず|薬をやめ|薬剤を廃|放任しておけば|放任すれば|放任するに|放っておいて|放っておけば|何もせず)[^。]*。')
MEDNOTE = '〔注：昭和当時の見解です。病気やけがの時は医療機関にかかり、薬や治療は自己判断でやめないでください〕'
# 浄霊 → 浄化療法（動詞として使われている時は「浄化療法を…」）
def jorei(s):
    s = s.replace('御浄霊', '浄霊').replace('浄霊法', '浄霊').replace('浄霊者', '施術者').replace('自己浄霊', '自分への浄霊')
    s = re.sub(r'浄霊(?=[すしさせ])', '浄化療法を', s)
    s = s.replace('浄霊', '浄化療法')
    # 3級テキストの言い方にそろえる（脳天→頭頂部）。「御浄化をいただき」などは、ふつうの言い方に
    s = s.replace('脳天', '頭頂部').replace('御浄化', '浄化').replace('浄化をいただき', '浄化があり').replace('浄化療法をいただき', '浄化療法を受け')
    return s

def clean_title(t):
    m = re.search(r'【(.+?)】(.*)$', t)
    if m:
        t = (m.group(1) + (m.group(2) or '')).strip()
    t = re.sub(r'^(科学篇\s*)', '', t)
    t = re.sub(r'^(主なる病気|総論|病気とは何ぞや)\((.+)\)$', r'\2', t)
    t = re.sub(r'^主なる病気\((.+)\)$', r'\1', t)
    t = t.replace('神霊医学断片集', '医学断片集').replace('　', ' ').strip()
    t = re.sub(r'^(病患と医学の誤謬\s*)', '', t)
    t = re.sub(r'^[一二三四五六七八九〇十]+、', '', t)
    t = re.sub(r'\s*（', '（', t)
    return jorei(t)

# 本文から見出し行・区切り線・出典行を外し、ふりがな（漢字<かな>）は（かな）に、編集注<…>は（…）に
def body_of(i):
    t, b = ARTS[i]
    b = re.split(r'\n─+\n■■', b)[0]
    b = re.split(r'\n■■', b)[0]
    lines = b.split('\n')
    for n, l in enumerate(lines[:8]):
        if l.startswith('─'):
            lines = lines[n + 1:]
            break
    else:
        lines = lines[1:]
    out = []
    for l in lines:
        if re.match(r'^\s*#[TK]', l) or '全集' in l or re.match(r'^[『「].*[』」].*\d{8}', l):
            continue
        out.append(l)
    b = '\n'.join(out).strip()
    b = re.sub(r'<([ぁ-んァ-ヶー]+)>', r'（\1）', b)
    b = re.sub(r'<([^<>]{1,30})>', r'（\1）', b)
    b = b.replace('（ヽヽ）', '').replace('（ママ）', '')
    return b

def speakers(s):
    s = re.sub(r'【\s*明主様?\s*】\s*', '岡田先生：', s)
    s = re.sub(r'〔\s*質問者\s*〕\s*', '問：', s)
    s = s.replace('大先生様', '岡田先生').replace('大先生', '岡田先生')
    return s

def split_sents(para):
    return [x for x in re.findall(r'[^。！？]*[。！？]?[」』）]*', para) if x]

def build():
    edits = json.load(open(R + 'tools/ronbun_edits.json', encoding='utf-8'))
    ids = cited()
    out = []
    problems = []
    for i, meta in ids.items():
        if i not in ARTS:
            problems.append(f'{i}: 本文が見つからない'); continue
        e = edits.get(i, {})
        title = e.get('title') or clean_title(ARTS[i][0])
        if e.get('paras'):
            paras = [p for p in e['paras']]
            excerpt = True
        else:
            text = speakers(jorei(body_of(i)))
            if e.get('from'):
                k = text.find(e['from'])
                if k < 0: problems.append(f'{i}: from が見つからない'); k = 0
                text = text[k:]
            if e.get('to'):
                k = text.find(e['to'])
                if k < 0: problems.append(f'{i}: to が見つからない')
                else: text = text[:k + len(e['to'])]
            for a, b in e.get('sub', []):
                if a not in text: problems.append(f'{i}: sub が見つからない：{a[:30]}')
                text = text.replace(a, b)
            for a, b in e.get('resub', []):
                text, n = re.subn(a, b, text, flags=re.S)
                if not n: problems.append(f'{i}: resub が当たらない：{a[:30]}')
            drops = e.get('drop', [])
            # 元の版組みの空白・行の切れ目を詰める（文の途中で段落が切れている時はつなぐ）
            text = re.sub(r'[　 ]{2,}', '', text)
            text = re.sub(r'(?<=[^。！？」』）\n])\n(?=[^\n　問岡])', '', text)
            paras = []
            for para in text.split('\n'):
                para = para.strip()
                if not para: continue
                keep = []
                for s in split_sents(para):
                    if any(d in s for d in drops): continue
                    if SPIRIT.search(s): continue
                    keep.append(s)
                p = ''.join(keep).strip()
                if p and not re.fullmatch(r'[\s　…。]*', p): paras.append(p)
            excerpt = bool(e.get('from') or e.get('to'))
        # 医療をやめる・放っておくよう読める文には、すぐ後に注を添える（本文は変えない）
        paras = [MEDCARE.sub(lambda m: m.group(0) + MEDNOTE, p) for p in paras]
        for p in paras:
            m = SPIRIT.search(p)
            if m: problems.append(f'{i}: 残っている「{m.group(0)}」：{p[:60]}')
            if '浄霊' in p or '全集' in p or '霊的' in p: problems.append(f'{i}: 禁止語：{p[:60]}')
        if not paras:
            problems.append(f'{i}: 本文が空'); continue
        kind = 'kowa' if i.startswith('kowa') else 'chojutsu'
        if SPIRIT.search(title): problems.append(f'{i}: 題名に残っている：{title}')
        out.append({'id': i, 'title': jorei(title), 'date': e.get('date') or meta['date'], 'kind': kind, 'excerpt': excerpt or bool(e.get('excerpt')), 'paras': paras})
    out.sort(key=lambda x: (x['date'] or '9999', x['id']))
    return out, problems

if __name__ == '__main__':
    arts, problems = build()
    for p in problems: print('NG', p)
    json.dump({'_note': '判断の根拠にしている岡田先生の論文・講話。精神面・宗教面の文を外して意味が通るように整え、「浄霊」は「浄化療法」に改めている（tools/build_ronbun.py で作成）。', 'articles': arts}, open(R + 'data/ronbun.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('articles', len(arts), 'chars', sum(len(''.join(a['paras'])) for a in arts), 'problems', len(problems))
    sys.exit(1 if problems else 0)
