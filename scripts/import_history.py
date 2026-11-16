"""Private CSV import. Dry-run by default; never prints medical values or secrets."""
import argparse, csv, datetime, hashlib, json, os, re, urllib.request
from collections import Counter
from pathlib import Path

def prepare(path, patient):
    with Path(path).open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    keys = set()
    for row in rows:
        datetime.date.fromisoformat(row['measured_on'])
        if row['measurement_type'] not in ['fasting', 'postmeal', 'other']:
            raise ValueError('Invalid measurement type')
        if not row['source_key'] or row['source_key'] in keys:
            raise ValueError('Missing or duplicate source key')
        keys.add(row['source_key'])
        for k in ['glucose_mmol','glucose_mg_reported','weight_kg','systolic','diastolic','pulse']:
            row[k] = (float(row[k]) if k in ['glucose_mmol','glucose_mg_reported','weight_kg'] else int(row[k])) if row[k] else None
        row['measured_time'] = row['measured_time'] or None
        row['patient_id'] = patient
    return rows

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv',required=True)
    parser.add_argument('--patient',required=True)
    parser.add_argument('--commit',action='store_true')
    args=parser.parse_args()
    if not re.fullmatch(r'[0-9a-f-]{36}',args.patient): raise SystemExit('Invalid patient ID')
    rows=prepare(args.csv,args.patient)
    print(json.dumps({'rows':len(rows),'months':dict(Counter(r['measured_on'][:7] for r in rows)),'sha256':hashlib.sha256(Path(args.csv).read_bytes()).hexdigest(),'mode':'commit' if args.commit else 'dry-run'}))
    if not args.commit: return
    project=os.environ['MAMA_PROJECT_REF']
    if not re.fullmatch(r'[a-z]{20}',project) or project=='udskgylzcrybozlyyyzi': raise SystemExit('Only a dedicated Mama Health project is allowed')
    url=os.environ['SUPABASE_URL'].rstrip('/')
    if url!='https://'+project+'.supabase.co': raise SystemExit('Project URL mismatch')
    key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
    headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}
    # Verify the requested household exists before transmitting any health records.
    request=urllib.request.Request(url+'/rest/v1/patients?id=eq.'+args.patient+'&select=id',headers=headers)
    with urllib.request.urlopen(request) as response:
        if len(json.load(response))!=1: raise SystemExit('Patient not found')
    request=urllib.request.Request(url+'/rest/v1/readings?on_conflict=patient_id,source_key',data=json.dumps(rows).encode(),headers={**headers,'Prefer':'resolution=ignore-duplicates,return=minimal'},method='POST')
    with urllib.request.urlopen(request) as response:
        if response.status not in [200,201,204]: raise SystemExit('Import failed')
    print('Import request succeeded; existing source keys were not overwritten.')

if __name__=='__main__': main()
