import re,html,csv,json,importlib.util,collections
spec=importlib.util.spec_from_file_location('d','candidates_data.py'); d=importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
lines=[l.strip() for l in open('chamber-directory-2026-10-06.txt').read().split('\n') if l.strip() and not l.startswith('#')]
ent=[l for l in lines[2:] if not re.match(r'^\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}$',l)]
print(len(ent),'directory entries')
# disposition map: name -> (disposition, where it landed / why)
R='represented'; SA='strong add'; PA='possible add'; NV='needs verification'; NO='not visitor relevant'
D={
'Birds & Barrels Vineyards':(R,'LIVE vineyard item + proposed downtown tasting room'),'Bodega Pierce':(R,'LIVE'),'Golden Rule Vineyard':(R,'PROPOSED Golden Rule Vineyards'),
'Strive Vineyards, LLC':(R,'LIVE secret item'),"Lee's Pecans":(R,"PROPOSED Lee's Pecans"),'Rafter M Meats':(R,'PROPOSED Rafter M Meats'),'Tortilleria La Unica':(R,'PROPOSED La Unica'),
'R&R Pizza Express LLC':(R,'PROPOSED R&R Pizza Express'),'Rex Allen Arizona Cowboy Museum':(R,'LIVE + proposed music jam and statue'),'Inde Motor Sports':(R,'PROPOSED Inde Motorsports Ranch'),
'Lazul Aesthetics & Wellness Med Spa':(R,'PROPOSED (Reserve)'),'Wings Over Willcox':(R,'LIVE (seasonal, inactive)'),'Cochise Graham Wine Council, Inc., dba Willcox Wine Country':(R,'LIVE wine trail item + two festival items'),
'Willcox Wine Country':(R,'Duplicate directory listing of the line above'),'City Of Willcox':(R,'Owner of the public/City experiences (depot, parks, pool, golf)'),
'Willcox West Fest Ranch Rodeo & Chuck Wagon Cook-Off':(SA,'PROPOSED seasonal (April)'),'Willcox/Cochise KOA Holiday':(SA,'PROPOSED Roadrunner Kafe item'),
'L & B Farm':(PA,'PROPOSED (visitor access by tour request)'),'The Moore House':(PA,'PROPOSED (Reserve, lodging)'),'Olivery Orchards LLC':(PA,'PROPOSED (Reserve, San Simon)'),
'Reconnect Farm LLC':(PA,'PROPOSED (Reserve, needs address)'),'Stagecoach Inn':(PA,'PROPOSED (Reserve, lodging)'),
'Evermore Coffee':(NV,'PROPOSED (Reserve, no public address found)'),'Ron Applegate Saddle Shop':(NV,'PROPOSED (Reserve; listed site no longer works)'),
'Cross (+) 8 Cast Iron Cottage Creations':(NV,'PROPOSED (Reserve, Facebook only)'),'Momster Creations':(NV,'PROPOSED (Reserve, Facebook only)'),'All The Things':(NV,'PROPOSED (Reserve, Facebook only)'),
'Mini ASSets Farm & Ranch':(NV,'PROPOSED (Reserve, no information)'),'Cochise County Farmers Association':(NV,'Trade association; check for a farm-stand or visitor program'),
'Willcox Art League':(NO,'PROPOSED then Excluded: monthly meetings only, no gallery'),
}
NOT=['Cochise Credit Union','Martin Rubber','Re/Max High Desert Realty LLC','Southwest Disposal','Dynamite Solutions LLC','Western Bank','Willcox Unified School District','Abbl Insurance Agency Inc.','Arizona G&T Cooperatives',
 'Charles Wm. Leighton Jr. Hospice, Inc.','Cochise College','Dipeso Realty','Energy Transfer','Geronimo Steel','Goodman Chiropractic & Wellness','Julie\'s Safety Boutique LLC','Klump Materials','Linden Distributing dba III Counties Distributing',
 "Love's Travel Stops",'Maid Rite Feeds','Monsoon Self Storage','Mosscrow Enterprises LLC','North Bowie Farming LLC','Northern Cochise Community Hospital','Oberreuter Accounting Services','Open Loop Energy','Pioneer Title Agency','Remedial Healing From Within',
 'Ship Arizona','Shotton Insurance Agency','Simmons Pump & Supply','Solid Solutions, DBA Abarca and Sons','Stotz Equipment-Arizona Machinery Co.','Sulphur Springs Valley Electric Coop','Valley Telecom Group','Westlawn Chapel & Mortuary','Willcox Rock & Sand',
 'Women Entrepreneurs Secrets of Success (WESOS)','Hot 92.5 KHTO','Legend Dance Gymnastics Fitness','Building Block Fitness','Chain Breakers Restorations LLC','Anita McLeod Photography','Sonya A Chairez Photography','Ben Barry Music']
for n in NOT: D[n]=(NO,'B2B, utility, finance, health, school, individual creative or non-visitor service')
PEOPLE=[e for e in ent if e not in D]
for e in PEOPLE: D[e]=(NO,'Individual member with no business named')
with open('chamber-directory-crossref.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['Directory entry (exact)','Disposition','Where it landed / why']); [w.writerow([e,*D[e]]) for e in ent]
c=collections.Counter(D[e][0] for e in ent); print(c, 'people:',len(PEOPLE))
json.dump(dict(ent=ent,counts=c),open('/tmp/dir_counts.json','w'),default=list)
print(PEOPLE)
