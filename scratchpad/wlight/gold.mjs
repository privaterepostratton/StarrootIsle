// Reserved-gold + sand-tone metric for a frame, mirroring verify-opening's scan.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const f = process.argv[2]
void readFileSync(f)
const py = `
from PIL import Image
im=Image.open(${JSON.stringify(f)}).convert('RGB')
px=list(im.getdata()); n=len(px)
G=(242,193,78)
hits=[p for p in px if (p[0]-G[0])**2+(p[1]-G[1])**2+(p[2]-G[2])**2<1600]
w,h=im.size
box=im.crop((int(w*0.15),int(h*0.62),int(w*0.85),int(h*0.82)))
sp=list(box.getdata())
sand=tuple(round(sum(p[i] for p in sp)/len(sp)) for i in range(3))
print('gold=%.3f%%  band=%s' % (100*len(hits)/n, sand))
`
console.log(execFileSync('python', ['-c', py]).toString().trim())
