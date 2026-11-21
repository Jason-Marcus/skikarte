# Baut ../index.html aus boot.js + main.js + template.html
# Voraussetzung: Node.js, im Ordner `source` einmal `npm install three esbuild` ausführen
import subprocess, os
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run(['npx', 'esbuild', 'boot.js', '--bundle', '--minify', '--format=iife', '--outfile=app.js', '--log-level=warning'], check=True, cwd=here)
t = open(os.path.join(here, 'template.html'), encoding='utf-8').read()
app = open(os.path.join(here, 'app.js'), encoding='utf-8').read().replace('</script', '<\\/script')
head = '''<title>3D Skikarte</title>
<meta name="theme-color" content="#9cc3e6">
<meta name="description" content="Jedes Skigebiet in 3D – echte Steilheit, Routenplaner, Treffpunkt und Wetter.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">'''
out = t.replace('<title>3D Skikarte</title>', head, 1).replace('__APP__', app)
open(os.path.join(here, '..', 'index.html'), 'w', encoding='utf-8').write(out)
os.remove(os.path.join(here, 'app.js'))
print('index.html gebaut')
