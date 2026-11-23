import sys,os
S=os.path.dirname(os.path.abspath(__file__)); P=sys.argv[1]
head=open(S+'/head.html').read(); logic=open(S+'/logic.js').read()
for name,markup,title,w,h in [('AdminConsole',S+'/desktop.html','Admin console',1440,1000),('AdminPhone',S+'/phone.html','Admin on phone',390,844)]:
    hd=head.replace('<title>Admin console</title>','<title>'+title+'</title>')
    out=hd+'<x-dc>'+open(markup).read()+'</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":%d,"height":%d}}\'>\n'%(w,h)+logic+'</script>\n</body>\n</html>\n'
    open(P+'/'+name+'.dc.html','w').write(out)
print('built')
