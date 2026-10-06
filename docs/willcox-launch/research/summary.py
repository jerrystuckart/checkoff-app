import csv,json,collections,importlib.util
spec=importlib.util.spec_from_file_location('d','candidates_data.py'); d=importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
rev=json.load(open('/private/tmp/claude-501/-Users-jerrystuckart-Downloads-checkoff/d433b474-2097-436e-8b92-88fd0f856ded/scratchpad/review.json'))
prod=json.load(open('/private/tmp/claude-501/-Users-jerrystuckart-Downloads-checkoff/d433b474-2097-436e-8b92-88fd0f856ded/scratchpad/prod_items.json'))
P={p['id'][:8]:p for p in prod}
CD={c['place']:c for c in d.CANDS}
L=lambda pre:('LIVE',pre)
K=lambda name:('CAND',name)
MAP={1:L('84b3ad09'),2:L('5d15ae43'),3:L('3c706acd'),4:K('Carlson Creek Vineyard'),5:L('21fdc0b2'),6:L('455ed6c5'),7:K('Golden Rule Vineyards'),8:K('Pillsbury Wine Company'),9:L('daf77fc6'),
10:K('Tortilleria La Unica'),11:K("Isabel's South of the Border"),12:K("Adolfo's Taco Shop"),13:K('Double S Steakhouse'),14:K('Desert Brew'),15:K('Dos Cabezas Coffee Company'),16:K("Katy's Rico Hot Dogs"),
17:K("Peter's Mexican Food"),18:K('Antojitos El Cholo Food Truck'),19:K('R&R Pizza Express'),20:L('7018a16a'),21:K("Mack's Bar"),22:K('Historic Railroad Depot'),23:L('8a9759d7'),24:K('Historic Railroad Park'),
25:L('d981fbdc'),26:L('02decd89'),27:L('814f48c1'),28:K('Historic Schwertner House'),29:K('Amerind Museum'),30:K('Studio 128'),31:L('f590b131'),32:L('d397b765'),33:L('29270440'),34:K('Dos Cabezas'),
35:L('f2c29c3b'),36:K('Twin Lakes birding'),37:K('Twin Lakes Golf Course'),38:K('Keiller Park'),39:K('Quail Park'),40:K('Railroad Dog Park'),41:K('Willcox City Pool & Splash Pad'),42:K('Event Center & Rodeo Grounds'),
43:K('Willcox Community Center Playground'),44:K('Railroad Avenue Walk'),45:('MERGED','Railroad Avenue Walk'),46:K('Willcox Flyer Bike Ride'),47:K('Boulderdash Trail Run'),48:K('Amerind Texas Canyon Trail Run'),
49:L('132a829f'),50:K("Apple Annie's Corn Maze & Pumpkin Patch"),51:K('Tirrito Farm tour'),52:K('Rhumb Line lavender bloom'),53:K("Lee's Pecans"),54:K('Rafter M Meats'),55:K('Amarillo by Morning'),
56:K('Buffalo Sisters'),57:K('Friendly Bookstore'),58:K('Vin-Tage'),59:K('Willcox Traders'),60:K("Bear's Vintage Thrift"),61:K('Lazul Aesthetics & Wellness Med Spa'),62:K('The Neighborhood Studio (Pilates)'),
63:('MERGED','Tirrito Farm glamping domes'),64:K('Tirrito Farm glamping domes'),65:K('Arizona Sunset Inn'),66:K('Inde Motorsports Ranch')}
assert len(MAP)==66
def landing(m):
    kind,key=m
    if kind=='LIVE': mem,rec,st,*_=d.LIVE[key]; return dict(where='LIVE',mem=mem,rec=rec,status=st,body=bool(P[key]['body']))
    if kind=='MERGED': c=CD[key]; return dict(where='MERGED into '+key,mem=c['membership'],rec=c['rec'],status=c['status'],body=True)
    c=CD[key]; return dict(where='PROPOSED',mem=c['membership'],rec=c['rec'],status=c['status'],body=bool(c['body']))
rows=[]
for i,r in enumerate(rev,1):
    a=landing(MAP[i]); rows.append(dict(i=i,name=r['Place / Experience'],wb_vis=r['Recommended Visibility'],wb_inc=r['Include?'],**a))
with open('original-66-outcome.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['#','Workbook place','Workbook visibility','Workbook Include?','Now','Membership','CheckOff recommends','Content status now'])
    for r in rows: w.writerow([r['i'],r['name'],r['wb_vis'],r['wb_inc'],r['where'],r['mem'],r['rec'],r['status']])
vis=lambda x:{'curated':'Curated','discoverable':'Discoverable','seasonal':'Seasonal','reserve':'Reserve','not_included':'Not Included'}[x]
before_vis=collections.Counter(r['wb_vis'] for r in rows); before_inc=collections.Counter(r['wb_inc'] for r in rows)
after_vis=collections.Counter(vis(r['status']) for r in rows if not r['where'].startswith('MERGED')); after_rec=collections.Counter(r['rec'] for r in rows if not r['where'].startswith('MERGED'))
# full universe
live=[(k,v) for k,v in d.LIVE.items()]; cands=[c for c in d.CANDS if c['ctype']!='rewrite']
U=[dict(kind='LIVE',place=(P[k]['body'][:60]),mem=v[0],rec=v[1],status=v[2]) for k,v in live]+[dict(kind='PROPOSED',place=c['place'],mem=c['membership'],rec=c['rec'],status=c['status'],c=c) for c in cands]
cm=collections.Counter(u['mem'] for u in U); cr=collections.Counter(u['rec'] for u in U); cs=collections.Counter(u['status'] for u in U)
new_in_66=set(MAP[i][1] for i in MAP if MAP[i][0]=='CAND')
newcands=[c for c in cands if c['place'] not in new_in_66 and c['ctype']=='new']
strong=[c['place'] for c in newcands if c['rec']=='include' or c['status']=='curated']
poss=[c['place'] for c in newcands if c not in [x for x in newcands if x['place'] in strong]]
json.dump(dict(before_vis=before_vis,before_inc=before_inc,after_vis=after_vis,after_rec=after_rec,cm=cm,cr=cr,cs=cs,total=len(U),live=len(live),proposed=len(cands),rewrites=3,newcands=len(newcands),strong=strong,
   body_ready=sum(1 for c in cands if c['body']),no_body=sum(1 for c in cands if not c['body'])),open('/tmp/summary.json','w'),default=list,indent=1)
print(json.dumps(json.load(open('/tmp/summary.json')),indent=1)[:2500])
# candidate crossref csv
with open('candidate-crossref.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['LIVE/PROPOSED','Place / experience','Chamber membership','CheckOff recommends','Content status','Verification owner','Research status','Likely list','Evidence (internal)'])
    for k,v in live: w.writerow(['LIVE',P[k]['body'][:90],v[0],v[1],v[2],'',' ',v[4],v[5]])
    for c in d.CANDS: w.writerow(['PROPOSED'+(' (rewrite)' if c['ctype']=='rewrite' else ''),c['place'],c['membership'],c['rec'],c['status'],c['owner'],c['rstatus'],c['lists'],c['internal']])
