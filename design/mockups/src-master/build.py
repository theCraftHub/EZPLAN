"""Builds the master plan boards (desktop + phone) from one logic file and the engine's data."""
import sys, os, json
S = os.path.dirname(os.path.abspath(__file__)); P = sys.argv[1]
logic = "var DATA = " + open(S + '/data.json').read() + ";\n" + open(S + '/logic.js').read()
head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>%s</title>\n<script src="./support.js"></script>\n</head>\n<body>\n'
for name, markup, title, w, h in [('MasterDesktop', 'desktop.html', 'Master plan', 1440, 1000), ('MasterPhone', 'phone.html', 'Master plan on phone', 390, 844)]:
    if not os.path.exists(S + '/' + markup): continue
    out = head % title + '<x-dc>' + open(S + '/' + markup).read() + '</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":%d,"height":%d}}\'>\n' % (w, h) + 'var IS_PHONE = %s;\n' % ('true' if w < 600 else 'false') + logic + '</script>\n</body>\n</html>\n'
    open(P + '/' + name + '.dc.html', 'w').write(out)
print('built')
