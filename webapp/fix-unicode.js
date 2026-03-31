// Fix Zeilencodierung
const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

// Unicode-Fix
content = content.replace(
  /res\.json\(\{ success: true, added, message: .*hinzugef.*gt/,
  "res.json({ success: true, added, message: added + ' new exercises added' }"
);

fs.writeFileSync('server.js', content);
console.log('Fixed');
