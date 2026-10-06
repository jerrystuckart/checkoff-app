# Derives concise Chamber-facing questions (one per line) from the existing internal verification notes + flags.
# Internal research stays in research_notes / needs_confirmation (admin only). This writes only chamber_question.
import re
def questions(c):
    t=((c.get('needs_confirmation') or '')).lower(); out=[]
    av=c.get('availability_type'); own=c.get('verification_owner_type'); mem=c.get('chamber_membership_status')
    if c.get('candidate_type')=='rewrite': return ''
    if c.get('recommended_decision')=='exclude' and not t: return ''
    if c.get('body_provisional'): out.append('What specifically can a visitor do here?')
    if mem=='not_found' and own=='business': out.append('Is this business a current Chamber member?')
    if av=='event_only': out.append('Is this event still active, and what are the dates?')
    if av=='pop_up': out.append('Is there a dependable place visitors can find this?')
    if av=='lodging_only': out.append('Should this stay a Nearby-only CheckOff for guests?')
    if re.search(r'address',t): out.append('Is this the correct address?')
    if re.search(r'signature|dish|product|drink|\bwine\b|merchandise|item',t) and av not in ('event_only',): out.append('What is the signature product or experience here?')
    if re.search(r'casual|public use|public access|access point|visitor access|visitors are welcome|visitor fit|can visitors|visitors can|booking|appointment|visitor logistics|tasting access|exterior|viewable|visitor hours',t) and av!='event_only':
        out.append('Can casual visitors use this facility?' if own=='city' else 'Can visitors actually do this?')
    if re.search(r'hours|schedule|season|weekday|year-round|date',t) and av is None: out.append('Is this available year-round, and when is it open?')
    if re.search(r'distance|radius',t): out.append('Is this close enough to belong in the Willcox Hub?')
    if re.search(r'lodging',t) and av!='lodging_only': out.append('Should lodging be a CheckOff at all?')
    seen=[]; [seen.append(x) for x in out if x not in seen]
    return '\n'.join(seen[:2])
LIVEQ={ # LIVE items by id prefix
 '84b3ad09':'Is this business a current Chamber member?','3c706acd':'Is this the correct address?','21fdc0b2':'Is this business a current Chamber member?',
 'e2f5020d':'Has this tasting room closed or moved? (Birds and Barrels now uses the space.)','d07f42cf':'Should the building and Strive’s hidden tasting stay as two separate CheckOffs?',
 'daf77fc6':'Is this business a current Chamber member?\nWhat is the signature dish here?','7018a16a':'Is this business a current Chamber member?\nWhat does the grill-your-own experience involve?',
 '132a829f':'Is this business a current Chamber member?\nAre the fruit-picking dates (July to October) right?','d981fbdc':'Is this a business or a community venue for membership purposes?',
 '814f48c1':'Who maintains the Pioneer Cemetery, and is the address right?','984d5c12':'Is this the right public viewing spot, and is it open October to February?',
 'b07c6c8b':'Are the January 2027 dates confirmed?',
}
