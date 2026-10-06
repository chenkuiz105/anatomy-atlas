import sys, os, json, collections, numpy as np, trimesh, fast_simplification
from concurrent.futures import ProcessPoolExecutor
D = sys.argv[1]; OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
par = collections.defaultdict(set); name = {}
for fn in ['conventional_part_of.txt', 'composite_parts.txt']:
    for i, l in enumerate(open(f'{D}/{fn}')):
        if i == 0: continue
        p = [x.strip('"') for x in l.rstrip('\n').split('\t')]
        if len(p) < 4: continue
        par[p[2]].add(p[0]); name[p[0]] = p[1]; name[p[2]] = p[3]
for l in open(f'{D}/parts_list_e.txt'):
    p = l.rstrip('\n').split('\t')
    if len(p) >= 2: name[p[0].strip('"')] = p[1]
def anc(i, seen=None):
    seen = set() if seen is None else seen
    for q in par[i]:
        if q not in seen: seen.add(q); anc(q, seen)
    return seen
def layer(sys_):
    if 'integumentary system' in sys_: return 'skin'
    if 'skeletal system' in sys_ or 'articular system' in sys_: return 'skeleton'
    if 'muscular system' in sys_: return 'muscles'
    if 'nervous system' in sys_: return 'nervous'
    if 'cardiovascular system' in sys_: return 'vessels'
    return 'organs'
REGIONS = ['head', 'neck', 'thorax', 'abdomen', 'pelvis', 'back', 'upper limb', 'lower limb', 'free upper limb', 'free lower limb']
def proc(i):
    m = trimesh.load(f'{D}/stl/{i}.stl', force='mesh')
    m.merge_vertices()
    n = len(m.faces)
    a = {name.get(x) for x in anc(i)}; a.discard(None)
    lay = layer({s for s in a if s.endswith('system')})
    tgt = 60000 if lay == 'skin' else int(min(max(n * 0.12, 400), 5000))
    v, f = m.vertices, m.faces
    if n > tgt:
        v, f = fast_simplification.simplify(np.asarray(v, np.float32), np.asarray(f, np.int32), target_reduction=1 - tgt / n)
    nm = name.get(i, i)
    side = 'L' if nm.startswith('left ') or ' left ' in nm else ('R' if nm.startswith('right ') or ' right ' in nm else '')
    return i, dict(id=i, en=nm, layer=lay, side=side, systems=sorted(s for s in a if s.endswith('system')),
                   groups=sorted(s for s in a if not s.endswith('system'))[:40], faces=int(len(f))), (np.asarray(v, np.float32), np.asarray(f, np.int32))
ids = [l.strip() for l in open(f'{D}/stl_ids.txt')]
meta = {}; meshes = collections.defaultdict(list)
with ProcessPoolExecutor(8) as ex:
    for i, md, (v, f) in ex.map(proc, ids, chunksize=4):
        meta[i] = md; meshes[md['layer']].append((i, v, f))
# global center (BodyParts3D: mm, Z up). Convert to Y-up meters-ish units (cm).
allv = np.concatenate([v for L in meshes.values() for _, v, _ in L])
c = (allv.min(0) + allv.max(0)) / 2; c[2] = allv[:, 2].min()
for lay, L in meshes.items():
    sc = trimesh.Scene()
    for i, v, f in L:
        vv = (v - c) / 10.0  # cm
        vv = vv[:, [0, 2, 1]] * np.array([1, 1, -1])  # Z-up -> Y-up
        tm = trimesh.Trimesh(vv, f, process=False)
        tm.fix_normals() if False else None
        sc.add_geometry(tm, node_name=i, geom_name=i)
    sc.export(f'{OUT}/{lay}.glb')
    print(lay, len(L), sum(len(f) for _, _, f in L))
json.dump(meta, open(f'{OUT}/parts_raw.json', 'w'), ensure_ascii=False, indent=0)
