#!/usr/bin/env python3
"""Build an allowlisted static exhibit. No source or existing release is deleted."""
from pathlib import Path
import hashlib,json,shutil,subprocess,os,time
ROOT=Path(__file__).resolve().parents[1]
SLUG=ROOT.name
OUT=ROOT/'exhibit-dist'
# Build in a new task-owned directory; a failed build cannot replace the last output.
STAGE=ROOT/'temp'/'builds'/str(time.time_ns())
STAGE.mkdir(parents=True)
def copy(source,target):
 p=ROOT/source;q=STAGE/target
 if p.is_dir():
  for f in p.rglob('*'):
   if f.is_file() and not (SLUG=='elder-protecter' and (f.name.startswith('test-') or '.test.' in f.name)) and f.suffix not in ('.map','.ts','.blend','.py','.md') and f.name not in ('AGENTS.md','CLAUDE.md','forest-build.json') and not any(x in ('node_modules','__pycache__','.git') for x in f.parts):
    transfer(f,q/f.relative_to(p))
  for f in p.rglob('*'):
   if f.is_file() and (f.name.startswith('LICENSE') or f.name.startswith('CREDITS')): transfer(f,q/f.relative_to(p))
 elif p.is_file():transfer(p,q)
 else:raise FileNotFoundError(p)
def transfer(p,q):
 with p.open('rb') as f:
  if f.read(80).startswith(b'version https://git-lfs.github.com/spec/v1'):raise ValueError('Unresolved LFS asset: '+str(p.relative_to(ROOT)))
 q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
if SLUG=='elder-protecter':
 for name in ('js','css','vendor','assets'):copy('prototype/'+name,name)
 copy('prototype/index.html','index.html');copy('family-app','family-app')
elif SLUG=='companion-collar':
 subprocess.run(['pnpm','build'],cwd=ROOT,check=True);copy('apps/web/dist','.')
 # Licenses for the copied runtime.
 copy('apps/web/node_modules/three/LICENSE','licenses/three.txt')
elif SLUG=='focus-hiking':
 subprocess.run(['npm','run','build'],cwd=ROOT,check=True,env={**os.environ,'SITE_BASE':'./'});copy('dist','.')
 copy('node_modules/three/LICENSE','licenses/three.txt')
elif SLUG=='smart-backpack':
 for name in ('index.html','gait.js','gait.css','manifest.json','telemetry.json','smart_balance_gait.glb'):copy('exports/gait/'+name,'exports/gait/'+name)
 copy('exports/vendor','exports/vendor')
 for name in ('clips.json','film_signals.json','license_manifest.json'):copy('exports/presentation/'+name,'exports/presentation/'+name)
 clips=json.loads((ROOT/'exports/presentation/clips.json').read_text())
 for key in ('unassisted','assisted'):
  for field in ('file','poster'):
   name=clips['clips'][key][field];copy('exports/presentation/'+name,'exports/presentation/'+name)
 copy('exports/gait/index.html','index.html')
 html=(STAGE/'index.html').read_text().replace('<head>','<head><base href="./exports/gait/">')
 (STAGE/'index.html').write_text(html)
else:raise ValueError(SLUG)
for name in ('exhibit.js','about.html','provenance.json'):copy('exhibit/'+name,name)
copy('ATTRIBUTION.md','ATTRIBUTION.md')
if (ROOT/'LICENSE').is_file():copy('LICENSE','LICENSE')
html=(STAGE/'index.html').read_text();prefix='../../' if SLUG=='smart-backpack' else './'
html=html.replace('</head>',f'<script defer src="{prefix}exhibit.js"></script></head>')
(STAGE/'index.html').write_text(html)
# The direct native gait entry also carries attribution/lifecycle controls.
if SLUG=='smart-backpack':
 p=STAGE/'exports/gait/index.html';p.write_text(p.read_text().replace('</head>','<script defer src="../../exhibit.js"></script></head>'))
files=[]
for p in sorted(STAGE.rglob('*')):
 if p.is_file():files.append({'path':p.relative_to(STAGE).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
manifest={'project':SLUG,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'files':files,'bytes':sum(f['bytes'] for f in files)}
(STAGE/'release-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
# Preserve previous artifacts in the project's build history, not by deleting them.
if OUT.exists():OUT.rename(ROOT/'temp'/'builds'/('previous-'+str(time.time_ns())))
STAGE.rename(OUT)
print(json.dumps({'project':SLUG,'files':len(files),'bytes':manifest['bytes'],'output':'exhibit-dist','dirty':manifest['dirty']}))
