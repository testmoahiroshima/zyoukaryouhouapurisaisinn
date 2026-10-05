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
    for name in ['knowledge', 'kenkai', 'concepts', 'body_points', 'symptoms', 'relations']:
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
MEDCARE = re.compile(r'[^。]*(?:医療をやめ|医療を止め|医療を受けず|薬をやめ|薬剤を廃|放任しておけば|放任すれば|放任するに|放任しておく|放っておいて|放っておけば|放置しておけば|放置すれば|放置しておいて|手当もせず|何もせず)[^。]*。')
MEDNOTE = '〔注：昭和当時の見解です。病気やけがの時は医療機関にかかり、薬や治療は自己判断でやめないでください〕'
# 癌（がん）について、治る・医師の診断が誤り・医療が要らないと読める文は載せない。癌に触れる記事には注を添える
CANCER_BAD = re.compile(r'治|全快|消散|心配|誤|ではなく|擬似|疑似|手術|ラジウム|廃め|廃止|恐るべき|発生しない|経血|塊り|切開|焼|悪化|好結果|判|区別|差別|筈|菜食|野菜|影響')
CANCERNOTE = '〔注：がん（癌）は必ず医療機関で診断・治療を受けてください。浄化療法はがんの治療の代わりにはなりません〕'
# 治ると約束する文・医療を受けないよう勧める文も載せない（施術は治療の約束をしない）
PROMISE = re.compile(r'完全に全快|請け?合って治|十人が十人|確実に治|確実に全|綺麗に治|きれいに治|驚く程.{0,6}治|驚くほど.{0,6}治|[0-9０-９一二三四五六七八九十]+回(位|くらい)?で.{0,8}(治|全快|全治)|速かに治|速やかに治|奇蹟的|わけなく治|訳なく治|きっと治|すっかり治|簡単に治|容易に治|一遍で治|必ず治|必ず全快|百パーセント|１００パーセント|治癒率|必ず全治|全治する|全治した|完全に治|確実.{0,4}全治|容易に全治|医療を停止|医療を受けず|医療を廃|薬を廃め|医者にかからず|医師にかからず')
def promise_ok(s):
    return not PROMISE.search(s)
def cancer_ok(s):
    return '癌' not in s or not CANCER_BAD.search(s)
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
        if re.match(r'^\s*#[TK]', l) or '全集' in l or re.match(r'^[『「].*[』」].*\d{8}', l) or l.startswith('キーワード') or '───' in l:
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

# 判断には引いていないが、症状ごとの解説・療術講義として読めるようにする論述（tools/ronbun_library.json）
KANJI_NUM = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
def kanji_int(t):
    if t.isdigit(): return int(t)
    n = 0
    if '十' in t:
        a, _, b = t.partition('十')
        n = (KANJI_NUM.get(a, 1) if a else 1) * 10 + (KANJI_NUM.get(b, 0) if b else 0)
    else:
        n = KANJI_NUM.get(t, 0)
    return n
def library():
    out = {}
    idx = {}
    for line in open(R + 'data/zenshu_index.jsonl', encoding='utf-8'):
        if line.strip():
            r = json.loads(line); idx[r['id']] = r
    for i in json.load(open(R + 'tools/ronbun_library.json', encoding='utf-8'))['ids']:
        r = idx.get(i, {})
        d = str(r.get('date') or '')
        if d[4:6] not in ('', '00'): d = d[:6]
        elif r.get('year'): d = str(r['year'])
        else:
            m = re.search(r'昭和([一二三四五六七八九十\d]+)年', r.get('source') or '')
            d = str(1925 + kanji_int(m.group(1))) if m else None
        out[i] = {'date': d}
    return out

# ---- 自動で取り込む論述（健康・施術に関わり、精神面・宗教面の文を外しても意味が通るもの） ----
# 精神面・宗教面の話題・文化や時事の話題の文（この語を含む文は外し、多い記事は取り込まない）
AUTO_EXTRA = re.compile(r'稲荷|蛇|墓|仏壇|寺|先祖|供養|法要|位牌|幽|お道|教会|奉仕|瑞雲郷|地上天国|聖地|おかげ|お蔭|御蔭|献金|参拝|讃歌|美術|骨董|選挙|政治|共産|戦争|原子|宣伝|新聞社|本部|事業|建築|茶碗|屏風|ノーベル')
# 医療をやめる・受けないよう勧める文
AUTO_ANTIDIR = re.compile(r'西洋医学を.{0,12}なく|医学を(廃|なく)|医学は.{0,6}(不要|要らない)|手当など(する|しない)|医療を(受け|やめ|止め)|医(者|師)に(かか|診せ|見せ)(らない|ず|ぬ|らず)|入院させ(ない|ず)|手術を(受け|せ)(ない|ず|ぬ)|薬を(服|の|飲)ま(ない|ず|せない|せず)|注射を(し|打|受け)(ない|ず)|医療は(不要|要らない)|医者は(不要|要らない)')
# 題名で外す：重い病気・小児・医療批判が中心の論述、宗教・文化の話題
AUTO_TITLE_X = re.compile(r'文明|三災|生気説|恐怖時代|グロ|南洋|国民|答申|学理|沢村|低脳|癌|小児|乳幼児|子供|児童|疫痢|赤痢|伝染|天然痘|種痘|ジフテ|脳膜|脳炎|肺炎|チフス|窒扶斯|コレラ|結核|精神病|癲癇|狂|堕胎|産児|死|自殺|農|美術|芸術|政治|経済|宗教|信仰|教団|本教|神|仏|霊|観音|救世|天国|地獄|夜昼|奇蹟|奇跡|御歌|和歌|詩|小説|序|はしがき|目次|跋|おかげ|お蔭|インフルエンザ|流行|ペスト|梅毒|淋病|花柳|医学|医術|医療|医者|医師|医家|手術|注射|薬|予防|黴菌|病院|ツベルクリン|ワクチン|抗毒素|錯覚|誤謬|誤診|誤療|療法|迷信|科学|人口|栄養|食|スポーツ|衛生|文化|社会|日本|米国|アメリカ|西洋|東洋|漢方|鍼|灸|按摩|電気|切開|腫物|殺菌|熱帯|麻疹|百日咳|喀血|血沈|結論|丹毒|寸言|ホルモン|坊ちゃん|寿命')
# 本文で外す：急を要すること・重い病気・妊娠と出産・小児（施術で対応してよいと読めないように）
AUTO_DANGER = re.compile(r'犯罪|生命がない|命がない|火傷|負傷|怪我|脳溢血|中風|狭心症|内出血|盲腸|虫様|レントゲン|ラジウム|ガス|窒息|心臓麻痺|狂犬|蝮|まむし|毒蛇|噛まれ|骨折|溺れ|感電|中毒死|喀血|吐血|大出血|危篤|臨終|妊娠|お産|分娩|流産|堕胎|赤ん坊|赤子|乳児|幼児|小児|子供|嬰児|結核|肺病|癌|チフス|赤痢|伝染|コレラ|疫痢|ジフテ|脳膜炎|肺炎|梅毒|淋病|精神病|癲癇|発狂|自殺|麻薬|阿片|コカイン')
AUTO_HEALTH = re.compile(r'浄化|毒素|毒結|固結|熱|肩|腎臓|頭|首|頸|胃|腹|咳|痰|下痢|便|痛|凝り|健康|病気|症状|施術|治療|血|膿|浮腫|眠|食欲')
TOPICS = [('頭痛', r'頭痛|頭が痛'), ('頭', r'頭|前頭部|後頭部'), ('首', r'首|頸|延髄|淋巴腺'), ('肩', r'肩'), ('腎臓', r'腎臓'), ('胃', r'胃'),
          ('お腹', r'腹|腸|下痢|便秘'), ('咳・痰', r'咳|痰'), ('眼', r'眼|目'), ('耳', r'耳'), ('鼻', r'鼻'), ('歯', r'歯'), ('のど', r'咽喉|喉|扁桃'),
          ('腰', r'腰'), ('脚', r'足|脚|膝'), ('手', r'手|腕|指'), ('婦人', r'婦人|子宮|月経'), ('痔', r'痔|肛門'), ('熱', r'熱'), ('眠り', r'眠|不眠'),
          ('むくみ', r'浮腫|むくみ'), ('皮膚', r'皮膚|湿疹|発疹|痒'), ('心臓', r'心臓|動悸'), ('施術のしかた', r'浄化療法|施術|力を抜')]
def article_date(i):
    t, b = ARTS[i]
    m = re.search(r'(19[1-5]\d)(\d\d)(\d\d)', b[:600])
    if m and 1 <= int(m.group(2)) <= 12: return m.group(1) + m.group(2)
    if m: return m.group(1)
    m = re.search(r'S(\d\d)/(\d\d?)/', t)
    if m: return f'{1925 + int(m.group(1))}{int(m.group(2)):02d}'
    m = re.search(r'昭和([一二三四五六七八九十]+)年', t + b[:600])
    return str(1925 + kanji_int(m.group(1))) if m else None
def topic_title(text, qa):
    hits = [(len(re.findall(rx, text)), name) for name, rx in TOPICS]
    names = [n for c, n in sorted(hits, key=lambda x: -x[0]) if c >= 2][:3]
    return f"{'問答' if qa else '講話'}：{'・'.join(names) if names else '浄化療法について'}"
# 自然に任せれば治る・手当をしない方がよいと読める所（読み物として載せる論述では、その段落・問答ごと外す）
AUTO_NATURAL = re.compile(r'ほったらかし|ほうっておけ|打っちゃって|放置|放任|放って|すてておけ|捨てておけ|自然に(任|委|まか)|手当(も|を)?(せず|しない)|何等の?手当|薬を(全廃|廃)|薬剤を廃|停止療法|止めようと|止めては')
def auto_units(text):
    # 講話は「問と答え」のひとまとまり、ほかは段落を単位にする
    paras = [p.strip() for p in text.split('\n') if p.strip()]
    us, cur = [], []
    for p in paras:
        if p.startswith('問：') and cur:
            us.append(cur); cur = []
        cur.append(p)
        if not any(x.startswith('問：') for x in cur):
            us.append(cur); cur = []
    if cur: us.append(cur)
    return us
def auto_clean(unit):
    # 精神面・宗教面・急を要すること・重い病気・医療をやめる勧めを含むまとまりは丸ごと外す（意味が切れないように）
    out = []
    for p in unit:
        ss = [s for s in split_sents(p) if s.strip()]
        if any(SPIRIT.search(s) or AUTO_EXTRA.search(s) or AUTO_DANGER.search(s) or AUTO_ANTIDIR.search(s) or AUTO_NATURAL.search(s) for s in ss): return None
        k = ''.join(s for s in ss if cancer_ok(s) and promise_ok(s)).strip()
        if k: out.append(k)
    t = ''.join(out)
    if not t or out[-1].startswith('問：') or len(AUTO_HEALTH.findall(t)) / len(t) * 1000 < 15: return None
    return out
def auto_library(taken, forced=()):
    # forced：tools/ronbun_library.json で選んだ論述（題名では外さないが、同じ安全の基準で段落・問答を選ぶ）
    out = {}
    seen_titles = set()
    for i, (t, b) in ARTS.items():
        if i in taken and i not in forced: continue
        kowa = i.startswith('kowa')
        title = clean_title(t)
        if i not in forced and not kowa and (SPIRIT.search(t) or AUTO_EXTRA.search(title) or AUTO_TITLE_X.search(title)): continue
        text = speakers(jorei(body_of(i)))
        paras = []
        for u in auto_units(text):
            cu = auto_clean(u)
            if cu: paras += cu
        body = ''.join(paras)
        if len(body) < 200: continue
        if kowa: title = topic_title(body, any(p.startswith('問：') for p in paras))
        else:
            key = re.sub(r'[\s　（）()「」『』]|明日の医術第[一二]篇ヨリ|病患と医学の誤謬|^[一二三四五六七八九〇十]+、', '', title)
            if key in seen_titles: continue
            seen_titles.add(key)
        # 講話の答えに話し手の印がない段落は「岡田先生：」とする
        if kowa and any(p.startswith('問：') for p in paras):
            paras = [p if p.startswith(('問：', '岡田先生：')) else '岡田先生：' + p for p in paras]
        out[i] = {'date': article_date(i), 'auto': True, 'title': title, 'paras': paras}
    return out

def build():
    edits = json.load(open(R + 'tools/ronbun_edits.json', encoding='utf-8'))
    ids = cited()
    basis = set(ids)
    lib = {i: m for i, m in library().items() if i not in basis}
    for i, meta in auto_library(set(ids), forced=set(lib)).items():
        if i in lib: meta = {**meta, 'date': lib[i]['date'] or meta['date']}
        ids.setdefault(i, meta)
    out = []
    problems = []
    for i, meta in ids.items():
        if i not in ARTS:
            problems.append(f'{i}: 本文が見つからない'); continue
        e = edits.get(i, {})
        title = e.get('title') or meta.get('title') or clean_title(ARTS[i][0])
        if e.get('paras') or meta.get('paras'):
            paras = [p for p in (e.get('paras') or meta['paras'])]
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
                    if not cancer_ok(s): continue
                    if not promise_ok(s): continue
                    if meta.get('auto') and (AUTO_EXTRA.search(s) or AUTO_ANTIDIR.search(s)): continue
                    keep.append(s)
                p = ''.join(keep).strip()
                if p and not re.fullmatch(r'[\s　…。]*', p): paras.append(p)
            excerpt = bool(e.get('from') or e.get('to'))
        # 医療をやめる・放っておくよう読める文には、すぐ後に注を添える（本文は変えない）
        paras = [MEDCARE.sub(lambda m: m.group(0) + MEDNOTE, p) for p in paras]
        for p in paras:
            for s in split_sents(p):
                if not cancer_ok(s): problems.append(f'{i}: 癌について載せない文：{s[:60]}')
                if not promise_ok(s): problems.append(f'{i}: 治ると約束する文：{s[:60]}')
        if any('癌' in p for p in paras) and CANCERNOTE not in paras: paras.append(CANCERNOTE)
        for p in paras:
            m = SPIRIT.search(p)
            if m: problems.append(f'{i}: 残っている「{m.group(0)}」：{p[:60]}')
            if '浄霊' in p or '全集' in p or '霊的' in p: problems.append(f'{i}: 禁止語：{p[:60]}')
        if not paras:
            problems.append(f'{i}: 本文が空'); continue
        kind = 'kowa' if i.startswith('kowa') else 'chojutsu'
        if SPIRIT.search(title): problems.append(f'{i}: 題名に残っている：{title}')
        out.append({'id': i, 'title': jorei(title), 'date': e.get('date') or meta['date'], 'kind': kind, 'excerpt': excerpt or bool(e.get('excerpt')), 'basis': i in basis, 'paras': paras})
    out.sort(key=lambda x: (x['date'] or '9999', x['id']))
    return out, problems

if __name__ == '__main__':
    arts, problems = build()
    for p in problems: print('NG', p)
    json.dump({'_note': '判断の根拠にしている岡田先生の論文・講話。精神面・宗教面の文を外して意味が通るように整え、「浄霊」は「浄化療法」に改めている（tools/build_ronbun.py で作成）。', 'articles': arts}, open(R + 'data/ronbun.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('articles', len(arts), 'chars', sum(len(''.join(a['paras'])) for a in arts), 'problems', len(problems))
    sys.exit(1 if problems else 0)
