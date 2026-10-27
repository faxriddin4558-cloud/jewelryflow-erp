const fs = require('fs');
const path = require('path');

function search(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory() && !['node_modules', '.next', '.git'].includes(f.name)) {
      search(p);
    } else if (f.name.endsWith('.tsx') || f.name.endsWith('.ts')) {
      const c = fs.readFileSync(p, 'utf8');
      c.split('\n').forEach((l, idx) => {
        if (l.includes('formatScreenGrams') && (l.includes(' g') || l.includes(' g<') || l.includes('`g`') || l.includes('4)'))) {
          console.log(`${p}:${idx+1} -> ${l.trim()}`);
        }
      });
    }
  }
}

search('src');
