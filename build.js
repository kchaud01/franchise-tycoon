// Bundles src/ into single self-contained pages. Run: node build.js
//   dist/franchise-tycoon.html  double-click to play; talks to Sleeper directly from your browser
//   dist/artifact.html          same game without the document wrapper, for publishing as a Claude artifact
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

const head = '<title>Franchise Tycoon</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&display=swap">\n' +
  '<style>\n' + src('style.css') + '</style>\n';
const scripts = ['engine.js', 'league.js', 'render.js', 'minigames.js', 'app.js'].map((f) => '<script>\n' + src(f) + '</script>').join('\n');
const content = head + src('body.html') + scripts + '\n';

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), content);
fs.writeFileSync(path.join(__dirname, 'dist', 'franchise-tycoon.html'),
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
  '<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n' + content + '</body>\n</html>\n');
// Gallery: every building at every level, drawn with the game's own renderer.
fs.writeFileSync(path.join(__dirname, 'dist', 'gallery.html'),
  src('gallery.html').replace('/*STYLE*/', src('style.css')) + ['engine.js', 'render.js'].map((f) => '<script>\n' + src(f) + '</script>').join('\n') + '\n<script>\n' + src('gallery.js') + '</script>\n');
console.log('built dist/franchise-tycoon.html (' + Math.round(content.length / 1024) + ' KB)');
