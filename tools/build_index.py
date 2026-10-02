# 全集repoを ../okadamokidhizensyu に clone した状態で: python3 tools/build_index.py
import sys,os
import re,glob,sys,os
D=os.environ.get('ZENSHU_DATA','../okadamokidhizensyu/data')
items=[]
for f in sorted(glob.glob(D+'/*.txt')):
    t=open(f,encoding='utf-8').read()
    parts=re.split(r'─+\n■■(.*?)■■\n─+\n',t)
    # parts[0] preamble, then title, body...
    for i in range(1,len(parts)-1,2):
        items.append((os.path.basename(f),parts[i].strip(),parts[i+1]))
def search(terms,ctx=120,maxhits=40,show=True):
    out=[];n=0
    for fn,ti,body in items:
        if all(x in body for x in terms):
            n+=1
            if n>maxhits: continue
            src=body.split('\n',2)
            head=src[0][:120] if src else ''
            k=terms[0];j=body.find(k)
            snip=body[max(0,j-ctx):j+ctx].replace('\n',' ')
            out.append(f'[{fn}] {ti} | {head}\n  …{snip}…')
    return n,out
import json,re,collections
# stable ids
cnt=collections.Counter(); ids=[]
for f,t,b in items:
    stem=f.replace('.txt',''); ids.append(f"{stem}#{cnt[stem]}"); cnt[stem]+=1
BODY={"頭部":["頭痛","頭重","頭脳","前頭部","後頭部","脳天","側頭部"],"頸部":["頸","首筋","延髄","淋巴腺","リンパ腺","耳下腺","扁桃腺"],
"肩部":["肩"],"背部":["背中","背部","脊柱","肩胛","肩甲"],"腎臓部":["腎臓","腎"],"腰・足":["腰","尾てい骨","尾骶骨","足"],"胸・腹":["胸","胃","腹"]}
CONC={"楽屋と舞台":["楽屋"],"平均浄化":["平均浄化"],"再浄化":["再浄化"],"第一浄化作用":["第一浄化"],"第二浄化作用":["第二浄化"],
"固結":["固結","毒結","凝結"],"溶解・排泄":["溶解","排泄"],"探査":["探査","診査","急所"],"力を抜く":["力を抜"],"薬毒":["薬毒"],"自然良能":["自然良能"]}
TREAT=["浄化","毒素","固結","毒結","施術","治療","浄霊","療法"]
REL=["お守り","御守護","明主","メシヤ","入信","本教","御神体","信者","観音","神様"]
out=open('data/zenshu_index.jsonl','w',encoding='utf-8'); n=0
for (f,t,b),i in zip(items,ids):
    if not any(k in b for k in TREAT): continue
    bt={k:sum(b.count(x) for x in v) for k,v in BODY.items()}; bt={k:v for k,v in bt.items() if v}
    ct={k:sum(b.count(x) for x in v) for k,v in CONC.items()}; ct={k:v for k,v in ct.items() if v}
    if not bt and not ct: continue
    head=b[:300]; m=re.search(r'(1[89]\d{6})',t+head); d=m.group(1) if m else None
    pg=re.search(r'(講話篇|著述篇)第?([一二三四五六七八九十]+)巻\s*p?(\d+)',head)
    src=next((l for l in head.split('\n') if l.strip() and not l.startswith('─')),'')[:120]
    rel=sum(b.count(x) for x in REL)
    # snippet around strongest concept or body term
    key=None
    for k in ["楽屋","平均浄化","再浄化","腎臓","肩","延髄","頭"]:
        if k in b: key=k;break
    j=b.find(key) if key else 0
    snip=re.sub(r'\s+',' ',b[max(0,j-40):j+80])
    rec={"id":i,"file":f,"title":t,"source":src,"date":d,"year":int(d[:4]) if d else None,
         "page":(f"{pg.group(1)}{pg.group(2)}巻p{pg.group(3)}" if pg else None),
         "body_tags":bt,"concept_tags":ct,"religious_term_count":rel,"chars":len(b),"snippet":snip}
    out.write(json.dumps(rec,ensure_ascii=False)+'\n'); n+=1
out.close()
print('index',n)
