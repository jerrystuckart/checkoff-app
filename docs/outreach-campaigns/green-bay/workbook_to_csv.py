#!/usr/bin/env python3
"""Convert rows of the Green Bay research workbook into the planner's CSV.

    pip install openpyxl
    python3 workbook_to_csv.py Green_Bay_Outreach_Master_*.xlsx unsent.csv

Only rows whose "Send approval" is not SENT are written. The converter NEVER decides eligibility:
  * local_business_confirmed is always left BLANK. A person sets it to "yes" after confirming the business is a local,
    independent business. Until then the planner excludes the row ("local-business eligibility not confirmed").
  * email_evidence_url comes from the workbook's "Email evidence URL" (blank stays blank).
  * category comes from "Business type"; send_approval from "Send approval".
Public attractions, parks, museums, government, major corporate venues and HOLD rows are suppressed by the campaign's
eligibilityPolicy.blockedCategories regardless of anything else in the row.
"""
import csv, sys
import openpyxl

src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
rows = list(wb["Master catalog"].iter_rows(values_only=True))
ix = {name: i for i, name in enumerate(rows[0])}
get = lambda r, k: ("" if r[ix[k]] is None else str(r[ix[k]]).strip())
with open(dst, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["business_name", "contact_email", "item_id", "website", "email_evidence_url", "local_business_confirmed", "category", "send_approval", "research_status"])
    n = 0
    for r in rows[1:]:
        if get(r, "Send approval").upper() == "SENT":
            continue
        email = get(r, "Public email (not guessed)")
        w.writerow([get(r, "Venue / business"), email, get(r, "CheckOff item_id"), get(r, "Website"), get(r, "Email evidence URL"), "", get(r, "Business type"), get(r, "Send approval"), get(r, "Research status")])
        n += 1
print(f"wrote {n} row(s) to {dst}; none is marked locally confirmed")
