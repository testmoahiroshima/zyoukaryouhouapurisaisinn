# 毒素の流れ図（学ぶ→流れ図）のデータを作る：python3 tools/build_flowmap.py
# data/flowmap.json に書き出す。
#  - nodes：図に置く部位（平面図 施術記録人体図.jpg 433×472px の位置 xy と、3D人体図の位置 p3。探査部位なら point）
#  - aliases：毒素の流れ早見表（routes.json）・テキストの流れ（flows.json）の経路名 → 部位
#  - edges：岡田先生の論述・講話から読み取った「どこからどこへ」の流れ（kind：明言＝本文にはっきり書かれている／推定＝本文から読み取れる）
#  - rel_nodes：症状の「元」の関係（relations.json）を、推定の流れとして図に出すための対応
# 本文の言葉は宗教的な語を外し、言い切らない形（〜とされる）に言い換えて text に入れる。出典は cites（id と年月）で、画面では「岡田先生 昭和〇年〇月」と示す。
import json, os, re

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'

# ---- 部位 ----
# xy：平面図の位置（前面図は x<222 で左に描かれた方が体の右、背面図は左に描かれた方が体の左）
# p3：3D人体図の位置（m、yが上・zが前・+xが体の左）。表面に近い点を置く（画面では一番近い表面に合わせる）
# exit：そこから外へ出る時の出方（出口）
N = [
  # 頭・顔
  ('zunou', '頭の中（頭脳）', None, [[212, 112]], [[0, 1.725, 0.02]], None),
  ('zentoubu', '前頭部', 'zentoubu', None, None, None),
  ('touchoubu', '頭頂部', 'touchoubu', None, None, None),
  ('koutoubu', '後頭部', 'koutoubu', None, None, None),
  ('shounou', '小脳', None, [[314, 64]], [[0, 1.61, -0.103]], None),
  ('enzui', '延髄部', 'enzui', None, None, None),
  ('koukeibu', '後頸部', 'koukeibu', None, None, None),
  ('me', '眼', None, [[101, 57], [113, 57]], [[-0.032, 1.638, 0.09], [0.032, 1.638, 0.09]], '目脂・涙'),
  ('hana', '鼻', None, [[107, 64]], [[0, 1.6, 0.118]], '鼻汁・鼻血'),
  ('mimi', '耳', None, [[213, 127]], [[-0.08, 1.61, -0.005], [0.08, 1.61, -0.005]], '耳だれ'),
  ('haguki', '歯茎', None, [[107, 74]], [[0, 1.555, 0.098]], '歯茎から'),
  ('kao', '顔面', None, [[93, 69]], [[-0.05, 1.6, 0.085], [0.05, 1.6, 0.085]], None),
  ('jikasen', '耳下腺部', 'jikasen', None, None, None),
  ('keibu_lymph', '頸部淋巴腺', 'keibu_lymph', None, None, None),
  ('hentousen', '扁桃腺', 'hentousen', None, None, '扁桃腺から口へ'),
  ('intou', '咽喉', None, [[107, 90]], [[0, 1.5, 0.066]], '痰（口から）'),
  # 背面
  ('kata', '肩', 'kata', None, None, None),
  ('kenkoukan', '肩甲間部（脊柱の両側）', 'kenkoukan', None, None, None),
  ('sekichuu', '脊柱（脊髄）', 'sekichuu', None, None, None),
  ('senaka', '背中', None, [[291, 150], [337, 150]], [[0.085, 1.21, -0.1], [-0.085, 1.21, -0.1]], None),
  ('haimen_jinzo', '背面腎臓部', 'haimen_jinzo', None, None, None),
  ('jinzo_kahou', '腎臓下方部', 'jinzo_kahou', None, None, None),
  ('youkotsu', '腰（腰骨部）', 'youkotsu', None, None, None),
  ('biteikotsu', '尾てい骨部', 'biteikotsu', None, None, None),
  ('koumon', '肛門', None, [[314, 252]], [[0, 0.845, -0.095]], '便・下痢・膿'),
  # 前面
  ('hai', '肺', None, [[92, 128], [122, 128]], [[-0.08, 1.31, 0.1], [0.08, 1.31, 0.1]], None),
  ('rokkotsu', '胸（肋骨・肋膜）', None, [[78, 150], [136, 150]], [[-0.125, 1.2, 0.07], [0.125, 1.2, 0.07]], None),
  ('shinzou', '心臓', None, [[118, 140]], [[0.045, 1.27, 0.115]], None),
  ('oukakumaku', '横隔膜', None, [[107, 154]], [[0, 1.18, 0.115]], None),
  ('i', '胃', None, [[114, 165]], [[0.045, 1.13, 0.12]], None),
  ('kanzou', '肝臓', None, [[95, 164]], [[-0.075, 1.14, 0.112]], None),
  ('tannou', '胆嚢', None, [[97, 174]], [[-0.06, 1.1, 0.118]], None),
  ('fukubu', '腹（腹膜）', None, [[107, 186]], [[0, 1.03, 0.125]], None),
  ('chou', '腸', None, [[107, 201]], [[0, 0.975, 0.12]], None),
  ('mouchou', '盲腸部（右の腸骨の内側）', None, [[82, 212]], [[-0.12, 0.937, 0.079]], None),
  ('kafukubu', '下腹部（子宮・卵巣・膀胱）', 'chikotsu', [[107, 217]], None, 'おりもの・尿'),
  ('sokeibu', '鼠蹊部', 'sokeibu', None, None, None),
  ('inbu', '陰部', None, [[107, 233]], [[0, 0.83, 0.065]], None),
  # 手足
  ('ude', '腕', None, [[258, 200], [370, 200]], [[0.27, 1.12, -0.01], [-0.27, 1.12, -0.01]], None),
  ('yubi', '指先', None, [[232, 280], [396, 280]], [[0.315, 0.79, 0.01], [-0.315, 0.79, 0.01]], '指先から'),
  ('kyakubu', '脚（太もも・膝・ふくらはぎ）', None, [[298, 330], [330, 330]], [[0.095, 0.55, 0.045], [-0.095, 0.55, 0.045]], None),
  ('ashikubi', '足首', None, [[298, 430], [330, 430]], [[0.1, 0.1, 0.02], [-0.1, 0.1, 0.02]], '腫れ物となって'),
  ('ashiura', '足の裏', None, [[187, 432], [242, 432]], [[0.1, 0.012, 0.03], [-0.1, 0.012, 0.03]], None),
]

# 早見表・テキストの経路名 → 部位
ALIASES = {
  '腎臓部': 'haimen_jinzo', '腎臓': 'haimen_jinzo', '背面腎臓部': 'haimen_jinzo', '背面腎臓部（右）': 'haimen_jinzo',
  '腎臓下方部': 'jinzo_kahou',
  '肩部': 'kata', '肩': 'kata', '左の肩': 'kata', '頸部・肩部': 'kata',
  '後頭部': 'koutoubu', '延髄部': 'enzui', '延髄部・後頸部': 'enzui', '頸部': 'koukeibu',
  '頸部淋巴腺': 'keibu_lymph', '頸部リンパ腺': 'keibu_lymph',
  '腰部': 'youkotsu', '腰': 'youkotsu', '腰の中心': 'youkotsu',
  '腰の中心（尾てい骨）': 'biteikotsu', '尾骶骨部': 'biteikotsu',
  '前頭部': 'zentoubu', '前頭部・頭頂部': 'zentoubu', '前頭部・後頭部': 'zentoubu', '頭頂部': 'touchoubu',
  '肺': 'hai', '肩甲間部': 'kenkoukan', '脊柱の両側（肩甲間部）': 'kenkoukan', '肩甲間部（脊柱の際）': 'kenkoukan',
  '頭脳': 'zunou', '頭部': 'zunou',
  '背中（脊柱の際）': 'senaka', '背中': 'senaka', '背部': 'senaka', '背部（脊柱の右側）': 'senaka',
  '鼠蹊部': 'sokeibu', '股': 'sokeibu', '胆嚢': 'tannou', '脊柱': 'sekichuu',
  '足': 'kyakubu', '脚': 'kyakubu', '脚部': 'kyakubu', '大腿部': 'kyakubu', '膝': 'kyakubu', 'ふくらはぎ': 'kyakubu',
  '足首': 'ashikubi', '踵': 'ashikubi', '足裏': 'ashiura',
  '下腹部（恥骨部）': 'kafukubu', '子宮': 'kafukubu', '膀胱部': 'kafukubu', '下腹部・膀胱': 'kafukubu', '前立腺': 'kafukubu', '子宮・卵巣': 'kafukubu',
  '子宮・陰部': 'inbu', '陰部・肛門・尿道': 'inbu', '睾丸': 'inbu',
  '腹部（腹膜）': 'fukubu', '腹部': 'fukubu', '胃': 'i', '肝臓': 'kanzou', '膵臓': 'i',
  '肋膜': 'rokkotsu', '肋骨': 'rokkotsu', '肋骨・横隔膜の周り': 'rokkotsu', '横隔膜': 'oukakumaku',
  '心臓': 'shinzou', '心臓付近': 'shinzou', '肛門': 'koumon', '盲腸部（右の腸骨の内側）': 'mouchou',
  '扁桃腺付近（のど）': 'hentousen', '扁桃腺': 'hentousen', '眼': 'me', '鼻': 'hana', '顔面': 'kao', '歯齦': 'haguki',
  '耳下腺部': 'jikasen', '耳': 'mimi', '腕': 'ude', '手指': 'yubi',
}

# 症状の「元」の関係（relations.json）→ 推定の流れ。訴えの部位（症状カテゴリ・関係の id から）と、元の探査部位 → 図の部位
REL_TARGET = {
  'rel_eyes': 'me', 'rel_dizzy': 'zunou', 'rel_nose': 'hana', 'rel_ear': 'mimi', 'rel_teeth': 'haguki', 'rel_throat': 'intou',
  'rel_headache': 'zunou', 'rel_insomnia': 'zunou', 'rel_hands': 'ude', 'rel_legs': 'kyakubu', 'rel_lungs': 'hai', 'rel_breath': 'hai',
  'rel_asthma': 'hai', 'rel_heart': 'shinzou', 'rel_ketsuatsu': 'zunou', 'rel_stomach': 'i', 'rel_abdomen': 'fukubu', 'rel_anus': 'koumon',
  'rel_women': 'kafukubu', 'rel_lowback': 'youkotsu', 'rel_kata': 'kata', 'rel_neck': 'koukeibu', 'rel_temple': 'zunou', 'rel_face': 'kao',
  'rel_yuutsu': 'zunou', 'rel_fever': 'zunou', 'rel_gall': 'tannou', 'rel_urinary': 'kafukubu', 'rel_ribs': 'rokkotsu',
  'rel_p_lymph': 'keibu_lymph', 'rel_p_head': 'zunou',
}
REL_LABEL = {
  'rel_eyes': '眼の不調', 'rel_dizzy': 'めまい', 'rel_nose': '鼻の不調', 'rel_ear': '耳の不調', 'rel_teeth': '歯・歯茎の不調', 'rel_throat': '喉の不調',
  'rel_headache': '頭痛', 'rel_insomnia': '不眠', 'rel_hands': '手・腕の不調', 'rel_legs': '脚・足の不調', 'rel_lungs': '咳・痰', 'rel_breath': '息切れ',
  'rel_asthma': '喘息', 'rel_heart': '動悸', 'rel_ketsuatsu': '血圧', 'rel_stomach': '胃の不調・吐き気', 'rel_abdomen': 'お腹の不調', 'rel_anus': '痔',
  'rel_women': '婦人科の不調', 'rel_lowback': '腰痛', 'rel_kata': '肩こり', 'rel_neck': '首の不調', 'rel_temple': 'こめかみの痛み', 'rel_face': '顔の不調',
  'rel_yuutsu': '気分の重さ', 'rel_fever': '熱・のぼせ', 'rel_gall': '肝臓・胆嚢の不調', 'rel_urinary': '泌尿器の不調', 'rel_ribs': '脇・肋膜',
  'rel_p_lymph': '頸部淋巴腺・耳下腺の固結', 'rel_p_head': '頭部の熱',
}
POINT_NODE = {
  'zentoubu': 'zentoubu', 'touchoubu': 'touchoubu', 'sokutoubu': 'zunou', 'koutoubu': 'koutoubu', 'enzui': 'enzui', 'koukeibu': 'koukeibu',
  'keizui': 'koukeibu', 'jikasen': 'jikasen', 'keibu_lymph': 'keibu_lymph', 'hentousen': 'hentousen', 'kata': 'kata', 'maekata': 'kata',
  'sekichuu': 'sekichuu', 'kenkoukan': 'kenkoukan', 'kenkoukotsu_ka': 'senaka', 'kenkoukotsu': 'senaka', 'haimen_jinzo': 'haimen_jinzo',
  'jinzo_kahou': 'jinzo_kahou', 'jinzo_kahou_side': 'jinzo_kahou', 'youkotsu': 'youkotsu', 'biteikotsu': 'biteikotsu', 'sokeibu': 'sokeibu',
  'choukotsu': 'mouchou', 'senchou': 'biteikotsu', 'chikotsu': 'kafukubu',
}

# ---- 論述・講話から読み取った流れ ----
# (元, 先, 明言/推定, 言い換え, [出典 id], 条件)
E = [
  # 腎臓から上へ
  ('haimen_jinzo', 'kenkoukan', '明言', '腎臓の働きが落ちて処理されない毒素は、脊柱の両側に溜まり、上へ延びていくとされる。', ['chojutsu10#71', 'chojutsu05#37', 'chojutsu03#138'], None),
  ('kenkoukan', 'kata', '明言', '脊柱の両側に溜まった余った尿の毒は、肩へかけて溜まり固まるとされる。', ['chojutsu05#37', 'chojutsu10#71'], None),
  ('senaka', 'kata', '明言', '背中の毒素は肩へ、さらに淋巴腺へ及ぶとされる。', ['chojutsu05#71', 'chojutsu02#16'], None),
  ('sekichuu', 'kata', '明言', '脊髄から出た膿が背中の皮下を上り、肩のくぼみや頸に集まることがあるとされる。', ['chojutsu02#16'], None),
  ('kata', 'keibu_lymph', '明言', '腎臓から出た尿毒が肩に集まり、さらに頸部淋巴腺のあたりへ移るとされる。', ['chojutsu03#121', 'chojutsu05#2'], None),
  ('kata', 'zunou', '明言', '夏の日差しで頭が照らされると、背中や肩の毒素が頭へ向かって集まるとされる。首・肩の毒素が頭を経て眼に集まることもあるとされる。', ['chojutsu03#117', 'chojutsu10#71', 'kowa11#17', 'kowa03#853'], None),
  ('senaka', 'zunou', '明言', '背中の毒素が頭へ向かうことがあるとされる（夏の日差し、背中や胸の腫れ物の手術の消毒薬など）。', ['chojutsu03#117', 'kowa11#17', 'chojutsu10#80'], None),
  ('senaka', 'shounou', '明言', '夏の日差しが頭に当たると、肩・背中一帯の毒素が小脳へ向かうとされる。', ['chojutsu05#68'], None),
  ('sekichuu', 'zunou', '明言', '脊髄の毒が上って、小脳へ入るもの、額（前頭）へ行くものがあるとされる。', ['kowa01#31'], None),
  # 頸・淋巴腺から
  ('keibu_lymph', 'haguki', '明言', '首・肩のあたりに固まった毒素が少しずつ溶けて、歯茎から出ようとするとされる（歯槽膿漏）。', ['chojutsu05#71', 'chojutsu11#129'], None),
  ('keibu_lymph', 'jikasen', '明言', '淋巴腺部の毒素が耳下腺を通じて外へ出るとされる（耳だれ）。', ['chojutsu03#120', 'chojutsu05#70'], None),
  ('jikasen', 'mimi', '明言', '耳下腺・淋巴腺のあたりの毒結が熱で溶け、中耳に入り、耳から出るとされる。', ['chojutsu10#71', 'chojutsu11#129'], None),
  ('keibu_lymph', 'hentousen', '明言', '頸部淋巴腺に集まった上半身の毒素が、出口を求めて扁桃腺で固まり、熱で溶けて外へ出るとされる。', ['chojutsu10#81', 'chojutsu10#71'], None),
  ('keibu_lymph', 'intou', '明言', '淋巴腺付近の固結が固められて出られないと、後から来る毒素が隣へ移り、喉頭まで及ぶとされる。顎の下から扁桃腺のあたりの膿が咽喉部へ移ることもあるとされる。', ['chojutsu03#120', 'chojutsu02#101'], '淋巴腺の浄化を止めた時'),
  ('keibu_lymph', 'zunou', '明言', '淋巴腺部の固結が溶けて、頭へ向かうことがあるとされる（脳溢血）。', ['chojutsu11#128'], None),
  ('keibu_lymph', 'yubi', '明言', '頸部淋巴腺に固まった毒素が溶けて、同じ側の指先から出ようとするとされる（疽）。', ['chojutsu11#120'], None),
  ('keibu_lymph', 'kao', '明言', '頸の腺や肩に溜まった水膿が、顔面にまで移るとされる。', ['chojutsu02#98'], None),
  ('keibu_lymph', 'hai', '明言', '頸や肩で溶けたものが肺に入り、痰になって出るとされる。頸・肩の膿が胸一帯に広がり、一度肺の下の方に溜まることもあるとされる。', ['kowa10#0', 'kowa06#243', 'chojutsu02#109'], None),
  ('kata', 'rokkotsu', '明言', '頸の腺や肩に集まれない毒が、胸の上の方・乳・脇の下の肋骨膜に溜まって固まるとされる。', ['chojutsu02#55'], '頸・肩が固結でふさがっている時'),
  ('jikasen', 'zunou', '明言', '耳の下に毒血が棒のように溜まると、その毒が頭の中に溜まるとされる。', ['kowa01#31'], None),
  # 胸・肺
  ('rokkotsu', 'hai', '明言', '肋骨とその付近に溜まった毒素が熱で溶け、肺膜から肺の中へしみ込み、痰となって出ようとするとされる（肋膜の水や膿が肺へしみ込むことも）。', ['chojutsu03#71', 'chojutsu10#72', 'kowa10#0'], None),
  ('oukakumaku', 'hai', '明言', '横隔膜の下辺や心臓の裏側の毒素が溶け、痰となって肺に入ろうとするとされる。痰が濃いと肺の方から吸い込もうとして息苦しくなるとされる（喘息の発作）。', ['chojutsu03#115', 'chojutsu10#73'], None),
  ('shinzou', 'hai', '明言', '心臓の裏側の毒素が溶けて、痰となって肺に入ろうとするとされる。', ['chojutsu03#115'], None),
  ('shinzou', 'fukubu', '明言', '心臓のまわりに固まった漢方薬の毒が膿になり、お腹や上の方へ行くとされる。', ['kowa04#448'], None),
  ('sekichuu', 'rokkotsu', '明言', '脊髄から膿が肋膜へしみ出て溜まることがあるとされる。', ['chojutsu03#114'], None),
  ('sokeibu', 'hai', '明言', '鼠蹊部の固結が溶けて痰となり、肺の中へ移って咳と痰になることがあるとされる。', ['chojutsu07#223', 'chojutsu08#42', 'chojutsu10#89'], None),
  ('koumon', 'hai', '明言', '肛門から出ていた膿の出口をふさぐと、膿は肋膜や肺の中へしみ込み、痰で出ようとするとされる。', ['chojutsu03#125', 'chojutsu05#75'], '肛門の出口をふさいだ時'),
  ('zunou', 'hai', '明言', '頭の中で溶けた毒素が肺の中へ下り、痰となって出ることがあるとされる。', ['chojutsu05#87'], None),
  ('i', 'hai', '明言', '臍の両側から胃・肝臓にかけての膿の溜結が溶けて痰となり、咳で出ようとするとされる（喘息）。', ['chojutsu02#179'], None),
  ('hai', 'intou', '明言', '肺は痰が外へ出る通り道で、痰は一度肺に入り、咳で吸い上げられて咽喉を通って出るとされる。', ['chojutsu10#252', 'chojutsu03#71'], None),
  ('hai', 'oukakumaku', '明言', '肺の痰が出し切れずに残ると、上から下へ肺の外にしみ出て、横隔膜の下辺に溜まって固まるとされる。', ['chojutsu03#115'], '痰を出し切らなかった時'),
  # 頭の中・延髄・小脳
  ('enzui', 'shounou', '明言', '延髄付近に集まった毒素が、小脳へ向かって流れ込むことがあるとされる。', ['chojutsu03#117', 'chojutsu08#43', 'kowa03#751'], None),
  ('shounou', 'zunou', '明言', '小脳に入った毒素は頭の中を通り、眼や鼻から出るとされる。', ['chojutsu08#43', 'chojutsu10#71'], None),
  ('zunou', 'me', '明言', '頭の中に集まった毒素が出口を求めて一度眼に集まり、溶けて目脂・涙などになって出るとされる。', ['chojutsu10#71', 'chojutsu11#129', 'chojutsu10#85', 'kowa02#581'], None),
  ('zunou', 'hana', '明言', '頭の中の毒素が溶けて流れ下り、鼻のあたりに溜まって鼻汁・鼻血となって出るとされる。', ['chojutsu11#129', 'chojutsu10#71', 'chojutsu11#142', 'kowa09#190'], None),
  ('koutoubu', 'hana', '明言', '後頭部から延髄部付近の毒素は、鼻汁となって鼻から出るとされる。', ['chojutsu03#120', 'kowa03#751'], None),
  ('enzui', 'hana', '明言', '延髄部の膿が鼻から出ようとして鼻に集まるとされる。', ['kowa03#751', 'chojutsu10#79'], None),
  ('zentoubu', 'hana', '明言', '前頭部から額にかけての毒素も、鼻から鼻汁となって出るとされる。', ['chojutsu03#120', 'chojutsu08#80'], None),
  ('zentoubu', 'me', '明言', '前頭部の毒素は眼から目脂として出るとされる。前頭の毒素が眼から出ようとして眼に集まることもあるとされる。', ['chojutsu10#88'], None),
  ('enzui', 'zentoubu', '明言', '毒素は眼の後ろ・延髄の所から前へ来て眉の上に出て、それから眼に下がるとされる。延髄の毒が頭へ行き、目に行って固まることもあるとされる。', ['kowa02#289', 'kowa06#257'], None),
  ('koukeibu', 'touchoubu', '明言', '毒は後ろの方から首筋を通り、頭の上を通って前頭部から下がってくるとされる。', ['kowa05#15'], None),
  ('touchoubu', 'zentoubu', '明言', '後ろから頭の上を通ってきた毒は、前頭部から下がってくるとされる。', ['kowa05#15'], None),
  ('mimi', 'zunou', '明言', '中耳炎で膿が多い時や耳を冷やした時、膿が頭の中や小脳へ向かうことがあるとされる。中耳炎の薬毒が頭に行くこともあるとされる。', ['chojutsu05#62', 'chojutsu02#97', 'kowa07#84'], '膿が多い時・冷やした時'),
  ('me', 'koutoubu', '明言', '目薬をさして仰向けに寝ると、薬毒が眼球の後ろを流れて後頭部に固まるとされる。', ['kowa05#479'], None),
  ('haguki', 'zunou', '明言', '昔の歯の治療の薬毒が頭に行くことがあるとされる。', ['kowa07#13'], None),
  ('intou', 'hentousen', '明言', '液体の薬を飲むと口の粘膜から入って膿になり、扁桃腺に集まって固まるとされる。', ['chojutsu11#120'], None),
  ('zunou', 'ude', '明言', '頭の血管が破れて頭に上った毒血が、反対側の手や足に流れ下るとされる（中風）。', ['kowa02#646', 'kowa02#648'], None),
  ('zunou', 'kyakubu', '明言', '頭に上った毒血が反対側の足にも流れ下るとされる（中風）。', ['kowa02#646', 'kowa02#648'], None),
  ('ude', 'zunou', '明言', '手足を手術した時の消毒薬が頭に上って固まることがあるとされる（頭の痛み）。', ['kowa12#128'], None),
  ('kyakubu', 'zunou', '明言', '手足を手術した時の消毒薬が頭に上って固まることがあるとされる（頭の痛み）。', ['kowa12#128'], None),
  # 頭から下へ（お腹・肛門）
  ('koutoubu', 'senaka', '明言', '頭の毒が溶けて背中を伝い、お腹へ行って下痢になるとされる。', ['kowa04#457', 'chojutsu09#115'], None),
  ('senaka', 'chou', '明言', '頭や背中の毒結が溶けて一度お腹（腸）に集まり、下痢になるとされる。', ['kowa04#457', 'chojutsu09#115', 'chojutsu11#125'], None),
  ('koutoubu', 'chou', '明言', '後頭部から延髄付近の固結した毒素が熱で溶け、一度腸に溜まって下痢となって出るとされる。', ['chojutsu11#125', 'chojutsu10#35'], None),
  ('koutoubu', 'koumon', '明言', '後頭部の毒は肛門の方へ行くとされる。痔のように肛門に関わる不調の元は、ほとんど後頭部の毒結とされる。', ['kowa10#0', 'chojutsu10#0', 'kowa02#421'], None),
  ('koutoubu', 'i', '明言', '後頭部の毒が溶けると、一度胃に行くことがあるとされる（溶けた毒は肺から出る場合と、胃から出る場合がある）。', ['kowa07#166'], None),
  ('kata', 'i', '明言', '肩・胸・胃の毒はだいたい胃へ溜まり、吐くことがあるとされる。上半身の毒素が胃に集まることもあるとされる。', ['kowa01#31', 'chojutsu10#85'], None),
  ('zunou', 'chou', '明言', '頭の毒が熱で溶けると、下って腸に集まり、肛門から出るとされる。', ['chojutsu10#4'], None),
  ('i', 'chou', '明言', '胃に溜まった膿は、順に腸へ下り、下痢となって出るとされる。', ['chojutsu02#142', 'chojutsu09#52', 'chojutsu02#179'], None),
  ('chou', 'koumon', '明言', '腸に集まった毒は、肛門から下痢・便となって出るとされる。', ['chojutsu10#4', 'kowa07#188'], None),
  ('i', 'sekichuu', '明言', '胃に溜まった毒は、脊髄へ行き、脳へ行くこともあるとされる。', ['kowa01#31'], None),
  ('i', 'senaka', '明言', '飲んだ薬は胃の袋からしみ出て下り、背中に固まるとされる（仰向けに寝るため）。', ['chojutsu09#52'], None),
  ('senaka', 'i', '明言', '背中に固まった薬毒が微熱で溶けると、胃に戻るとされる（胃の痛み）。', ['chojutsu09#52', 'chojutsu10#70'], None),
  # 腎臓・盲腸・腹
  ('i', 'haimen_jinzo', '明言', '飲み薬の毒が胃の壁からしみ出て、右の腎臓部に集まるとされる。', ['chojutsu11#120'], None),
  ('senaka', 'haimen_jinzo', '明言', '背中一面に溜まった毒素は、一度右の背面腎臓部に溜まって固まるとされる。下半身の毒素も背中の腎臓部に溜まるとされる。', ['chojutsu10#87', 'kowa09#119'], None),
  ('haimen_jinzo', 'mouchou', '明言', '右の背面腎臓部に固まった毒素が、少しずつ溶けて盲腸部に移って固まるとされる。', ['chojutsu10#87', 'chojutsu11#3', 'chojutsu11#34', 'chojutsu11#120', 'chojutsu03#111'], None),
  ('mouchou', 'chou', '明言', '盲腸部の膿が溶けると腹の中心へ行き、肛門の近くへ行って出るとされる。', ['kowa01#29', 'chojutsu10#87'], None),
  ('mouchou', 'fukubu', '明言', '盲腸を取ると、そこへ集まるはずの毒素は腹膜や腎臓部に溜まるとされる。', ['chojutsu03#33', 'chojutsu10#87', 'chojutsu11#3'], '盲腸を取った後'),
  ('mouchou', 'rokkotsu', '明言', '盲腸を手術した時の消毒薬がだんだん上り、胸を通じて歯から出ようとすることがあるとされる。', ['kowa12#128', 'chojutsu10#0'], '盲腸を手術した後'),
  ('rokkotsu', 'haguki', '明言', '上ってきた消毒薬が胸を通じて歯から出ようとするとされる。歯の痛みで胸に固結があることもあるとされる。', ['kowa12#128', 'chojutsu10#89'], None),
  ('haimen_jinzo', 'fukubu', '明言', '腎臓が圧迫されて尿の処理が鈍ると、余った尿が腹膜に溜まるとされる。', ['chojutsu03#103', 'chojutsu05#54', 'chojutsu11#129'], None),
  ('haimen_jinzo', 'tannou', '明言', '腎臓から出た尿毒・薬毒が上り、右の背中から胆嚢の裏にしみ込み、胆汁と合わさって石になるとされる。', ['chojutsu03#122', 'chojutsu11#129', 'chojutsu10#74', 'chojutsu11#131'], None),
  ('haimen_jinzo', 'kanzou', '明言', '腎臓の毒が肝臓に行くことがあるとされる。', ['kowa02#598'], None),
  ('youkotsu', 'tannou', '明言', '脊髄から出て腰に溜まった膿が、脊髄から右に二寸ほどの所を上って胆嚢へ入るとされる。', ['chojutsu02#112'], None),
  ('haimen_jinzo', 'youkotsu', '明言', '腎臓部から下へ向かって、腰骨部まで毒結が移っていることが多いとされる。', ['chojutsu03#138'], None),
  ('haimen_jinzo', 'senaka', '明言', '尿毒が背中や腰に固まると、胸を張れない・腰が曲がるといったことになるとされる。', ['chojutsu03#136'], None),
  ('haimen_jinzo', 'kyakubu', '明言', '腎臓の尿毒が脚へ下りて溜まることがあるとされる（脚気に似た症状）。', ['chojutsu03#50'], None),
  ('fukubu', 'kyakubu', '明言', '腹膜に集まった尿毒が脚へ下ることがあるとされる。', ['chojutsu03#50'], None),
  ('youkotsu', 'kyakubu', '推定', '腰骨に接して毒結がある時は、脚に異状があることが多いとされる（流れとしてはっきり述べてはいない）。', ['chojutsu03#138'], None),
  ('kyakubu', 'ashiura', '明言', '注射や消毒の薬は重いほど下がり、重いものは膝から下、足の裏まで垂れて固まるとされる。', ['chojutsu10#88'], None),
  ('kyakubu', 'ashikubi', '明言', '注射の薬毒がだんだん下がり、足首から出ようとして腫れ物になることがあるとされる。', ['chojutsu08#136', 'chojutsu10#88'], None),
  # 下腹部・陰部
  ('fukubu', 'kafukubu', '明言', '体の毒素がだんだん下がり、下腹部に溜まると子宮・卵巣・膀胱などの不調になるとされる。腹膜の毒素が溶けて一度子宮に溜まり、流れ出ることもあるとされる。', ['chojutsu10#84', 'chojutsu05#79'], None),
  ('kafukubu', 'koumon', '明言', '下腹部からさらに下がると、痔などの元になるとされる。', ['chojutsu10#84'], None),
  ('kafukubu', 'inbu', '明言', '下腹部からさらに下がると、陰部の不調の元になるとされる。', ['chojutsu10#84'], None),
  ('inbu', 'sokeibu', '明言', '陰唇部の毒結が鼠蹊部にまで及び、足の運びをさまたげることがあるとされる。', ['chojutsu10#84'], None),
  ('sokeibu', 'koumon', '明言', '股の付け根の鼠蹊部と後頭部の固結が溶けて、肛門から出ようとするとされる。', ['chojutsu11#18'], None),
  ('kafukubu', 'sokeibu', '推定', '下腹部の溜結と鼠蹊部の固結は、婦人科・泌尿器の訴えでいっしょに述べられることが多い（流れとしてはっきり述べてはいない）。', ['chojutsu10#84'], None),
]

idx = {}
for line in open(R + 'data/zenshu_index.jsonl', encoding='utf8'):
    if line.strip():
        r = json.loads(line)
        idx[r['id']] = r

# 索引に無い項は、本文（リポジトリ直下の chojutsu*_utf8.txt・講話*_utf8.txt）の出典欄から年月を読む
ARTS = {}
def arts():
    if ARTS: return ARTS
    import glob
    files = {os.path.basename(f).replace('_utf8.txt', ''): f for f in glob.glob(R + 'chojutsu*_utf8.txt')}
    files.update({'kowa' + os.path.basename(f)[2:4]: f for f in glob.glob(R + '講話*_utf8.txt')})
    files['kowa04'] = R + 'kowa04_utf8.txt'
    for stem, f in files.items():
        parts = re.split(r'─+\n■■(.*?)■■\n─+\n', open(f, encoding='utf-8').read())
        for n, i in enumerate(range(1, len(parts) - 1, 2)):
            ARTS[f'{stem}#{n}'] = parts[i + 1][:400]
    return ARTS

def date_of(cid):
    r = idx.get(cid)
    if not r:
        head = arts().get(cid)
        if head is None: raise SystemExit(f'本文に無い出典: {cid}')
        r = {'source': head}
    cands = ([r['date']] if r.get('date') else []) + [''.join(m) for m in re.findall(r'(19[1-5]\d)(\d\d)(\d\d)', r.get('source') or '')]
    for d in cands:
        y, m = d[:4], d[4:6]
        if y.isdigit() and m.isdigit() and 1 <= int(m) <= 12:
            return {'id': cid, 'year': int(y), 'date': f'{y}{m}'}
    m = re.search(r'(19[1-5]\d)', r.get('source') or '')
    y = r.get('year') or (int(m.group(1)) if m else None)
    if not y: raise SystemExit(f'年が分からない出典: {cid}')
    return {'id': cid, 'year': y, 'date': str(y)}

pts = {p['id']: p for reg in json.load(open(R + 'data/body_points.json', encoding='utf8'))['regions'] for p in reg['points']}
nodes = []
for nid, name, point, xy, p3, exit_ in N:
    p = pts.get(point) if point else None
    if point and not p: raise SystemExit(f'探査部位が無い: {point}')
    node = {'id': nid, 'name': name, 'xy': xy or p['chart'], 'p3': p3 or p['p3']}
    if point: node['point'] = point
    if exit_: node['exit'] = exit_
    nodes.append(node)
ids = {n['id'] for n in nodes}

edges = []
seen = set()
for a, b, kind, text, cites, when in E:
    if a not in ids or b not in ids: raise SystemExit(f'部位が無い: {a}→{b}')
    if (a, b) in seen: raise SystemExit(f'重複: {a}→{b}')
    seen.add((a, b))
    e = {'from': a, 'to': b, 'kind': kind, 'text': text, 'cites': [date_of(c) for c in cites]}
    if when: e['when'] = when
    edges.append(e)

for k, v in ALIASES.items():
    if v not in ids: raise SystemExit(f'別名の行き先が無い: {k}→{v}')
names = {x for f in ['flows', 'routes'] for fl in json.load(open(R + f'data/{f}.json', encoding='utf8'))[f] for x in fl['route']}
missing = sorted(n for n in names if n not in ALIASES and n != '全身')
if missing: raise SystemExit('部位に置きかえられない経路名: ' + '、'.join(missing))

# 本文を読めるのは、論文の一覧（data/ronbun.json。tools/build_ronbun.py で宗教面・医療を否定する部分を整えたもの）にある記事だけ。
# 一覧に無い出典は、年月だけを示す（read が無い）
lib = {a['id'] for a in json.load(open(R + 'data/ronbun.json', encoding='utf8'))['articles']}
for e in edges:
    for c in e['cites']:
        if c['id'] in lib: c['read'] = True

# テキストの流れ（flows.json）のうち、route が「流れ」ではなく施術する所・固結のある所の並びになっているもの（流れ図には出さない）
NOT_FLOW = ['eyes', 'nose']

out = {
  '_note': 'tools/build_flowmap.py で作る。学ぶ→流れ図のデータ。nodes：図の部位（xy：平面図 施術記録人体図.jpg の位置、p3：3D人体図の位置、point：探査部位、exit：外への出方）。edges：岡田先生の論述・講話から読み取った流れ（kind 明言／推定、text は言い換え、when は条件、cites は出典）。aliases：早見表・テキストの経路名→部位。rel_target・rel_label・point_node：症状の「元」の関係（relations.json）を推定の流れとして出すための対応。not_flow：テキストの流れのうち、route が流れでなく施術する所の並びのもの（流れ図に出さない）。',
  'nodes': nodes, 'edges': edges, 'aliases': ALIASES, 'not_flow': NOT_FLOW,
  'rel_target': REL_TARGET, 'rel_label': REL_LABEL, 'point_node': POINT_NODE,
}
json.dump(out, open(R + 'data/flowmap.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('flowmap', len(nodes), 'nodes', len(edges), 'edges', sum(e['kind'] == '明言' for e in edges), 'stated', sum(1 for e in edges for c in e['cites'] if c.get('read')), 'readable cites')
