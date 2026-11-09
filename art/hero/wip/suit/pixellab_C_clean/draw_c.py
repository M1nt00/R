"""Hand-cleaned astronaut C: south, east, north (west = mirrored east). 32x32, feet on y30."""
import sys
from PIL import Image
PAL = {'o': '0a0c24', 'a': '0b1e47', 'b': '243a64', 'c': '3a587f', 'd': '587796', 'e': '809caf',
       'f': 'a2b9cd', 'g': 'd0dde9', 'w': 'f8fbe8', 'r': 'ec4817', 'y': '3bf0d0', 'l': 'bfebfd'}
SOUTH = {
 1: [(13, 'ooooo')], 2: [(11, 'oowwwwwoo')], 3: [(10, 'owwwwwwgffo')], 4: [(9, 'owwooooooogfo')],
 5: [(8, 'owwobllbbbboffo')], 6: [(8, 'owwolbbbbbaoffo')], 7: [(8, 'owgobbbbbaaofeo')],
 8: [(8, 'oggobbbbaaaoeeo')], 9: [(8, 'ofgobaaaaaaoedo')], 10: [(8, 'offgoooooooeedo')],
 11: [(7, 'oo' + 'offggggffeedo' + 'oo')], 12: [(6, 'owwwggofeeedogffeeo')],
 13: [(5, 'owgo' + 'wwwgggggffffe' + 'ofeo')], 14: [(5, 'orro' + 'wwgeeeeeedffe' + 'orro')],
 15: [(5, 'ogfo' + 'wggeyyefedfee' + 'ofeo')], 16: [(5, 'ofeo' + 'ggfddddddcfed' + 'oedo')],
 17: [(5, 'ofeo' + 'gffgggggffeed' + 'oedo')], 18: [(5, 'oedo' + 'ffgggggfffeed' + 'odco')],
 19: [(4, 'oddco' + 'ccrccccccccrc' + 'odcco')], 20: [(4, 'oedco' + 'fgggffefffeed' + 'odcco')],
 21: [(4, 'occco' + 'fggfedodffeed' + 'occco')], 22: [(5, 'ooo'), (9, 'ofgfeoooffedo'), (23, 'ooo')],
 23: [(9, 'odeedo.oeddco')], 24: [(9, 'oeffeo.ofeedo')], 25: [(9, 'odeedo.oeddco')],
 26: [(9, 'ofggfo.ogffeo')], 27: [(9, 'oeeedo.oeeddo')], 28: [(8, 'oddddco.oddccco')],
 29: [(8, 'occccco.occccco')], 30: [(9, 'ooooo'), (17, 'ooooo')],
}
EAST = {
 1: [(15, 'ooooo')], 2: [(13, 'oowwwwwoo')], 3: [(8, 'ooooo'), (13, 'wwwwwwwgf'), (22, 'o')],
 4: [(7, 'owwgfo'), (13, 'wwwwooooo'), (22, 'o')], 5: [(7, 'owgffo'), (13, 'wwgoblbbb'), (22, 'o')],
 6: [(7, 'owgffo'), (13, 'wggolbbba'), (22, 'o')], 7: [(7, 'ogffeo'), (13, 'ggfobbbaa'), (22, 'o')],
 8: [(7, 'ogffeo'), (13, 'gffobbaaa'), (22, 'o')], 9: [(7, 'ogffeo'), (13, 'ffeobaaaa'), (22, 'o')],
 10: [(7, 'odddco'), (13, 'eeedooooo')], 11: [(7, 'ogffeo'), (13, 'offfeedo')],
 12: [(7, 'ogffeo'), (13, 'wwwggff'), (20, 'o')], 13: [(7, 'ogffeo'), (13, 'gowwgof'), (20, 'o')],
 14: [(7, 'ogffeo'), (13, 'gorrroe'), (20, 'o')], 15: [(7, 'ogffeo'), (13, 'fogffoy'), (20, 'o')],
 16: [(7, 'ogffeo'), (13, 'fogffoe'), (20, 'o')], 17: [(7, 'odddco'), (13, 'fofeeoe'), (20, 'o')],
 18: [(7, 'offeeo'), (13, 'eofedod'), (20, 'o')], 19: [(7, 'offeeo'), (13, 'coddcor'), (20, 'o')],
 20: [(7, 'oeeddo'), (13, 'fodccoe'), (20, 'o')], 21: [(8, 'ooooo'), (13, 'eocccod'), (20, 'o')],
 22: [(12, 'oeeoooedo')], 23: [(12, 'ocdoffedo')], 24: [(12, 'occoeffeo')], 25: [(12, 'ocdoeddco')],
 26: [(12, 'ocdofggfo')], 27: [(12, 'occoeeedo')], 28: [(12, 'occoddddco')], 29: [(12, 'occcccccco')],
 30: [(13, 'oooooooo')],
}
PACK = {7: 'wwwggggff', 8: 'gggggfffe', 9: 'ggffffeee', 10: 'gddddddce', 11: 'gdeeceece', 12: 'gdeeceece',
        13: 'gdeeceece', 14: 'gdeeceece', 15: 'gdeeceece', 16: 'gcccccccd', 17: 'ffffeeeed',
        18: 'fffeeeedd', 19: 'eeeeedddc', 20: 'dddddddcc'}
P = lambda y: 'o' + PACK[y] + 'o'
NORTH = {
 1: [(13, 'ooooo')], 2: [(11, 'oowwwwwoo')], 3: [(10, 'owwwwwwgffo')], 4: [(9, 'owwwwwwwwgffo')],
 5: [(8, 'owwwwwwwwggffeo')], 6: [(8, 'ow' + 'o' * 11 + 'fo')], 7: [(8, 'og' + P(7) + 'eo')],
 8: [(8, 'of' + P(8) + 'eo')], 9: [(8, 'oe' + P(9) + 'do')], 10: [(9, 'o' + P(10) + 'o')],
 11: [(7, 'ooo' + P(11) + 'ooo')], 12: [(6, 'owwg' + P(12) + 'feeo')],
 13: [(5, 'owgog' + P(13) + 'eofeo')], 14: [(5, 'orrog' + P(14) + 'eorro')],
 15: [(5, 'ogfof' + P(15) + 'eofeo')], 16: [(5, 'ofeof' + P(16) + 'doedo')],
 17: [(5, 'ofeof' + P(17) + 'doedo')], 18: [(5, 'oedoe' + P(18) + 'dodco')],
 19: [(4, 'oddco' + 'c' + P(19) + 'c' + 'odcco')], 20: [(4, 'oedco' + 'f' + P(20) + 'd' + 'odcco')],
 21: [(4, 'occco' + 'f' + 'o' * 11 + 'd' + 'occco')], 22: [(5, 'ooo'), (9, 'ofgfeoooffedo'), (23, 'ooo')],
 23: [(9, 'ofggfo.ogffeo')], 24: [(9, 'ofgffo.offeeo')], 25: [(9, 'oeffeo.ofeedo')],
 26: [(9, 'odeedo.oeddco')], 27: [(9, 'oeeedo.oeeddo')], 28: [(8, 'oddddco.oddccco')],
 29: [(8, 'occccco.occccco')], 30: [(9, 'ooooo'), (17, 'ooooo')],
}

def render(rows):
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    for y, segs in rows.items():
        for x0, s in segs:
            for i, ch in enumerate(s):
                if ch == '.': continue
                assert 0 <= x0 + i < 32, (y, x0, s)
                im.putpixel((x0 + i, y), tuple(int(PAL[ch][k:k + 2], 16) for k in (0, 2, 4)) + (255,))
    return im

out = sys.argv[1]
s, e, n = render(SOUTH), render(EAST), render(NORTH)
s.save(f'{out}/south.png'); e.save(f'{out}/east.png'); n.save(f'{out}/north.png')
e.transpose(Image.FLIP_LEFT_RIGHT).save(f'{out}/west.png')
for k, im in (('south', s), ('east', e), ('north', n)): print(k, im.getbbox())
