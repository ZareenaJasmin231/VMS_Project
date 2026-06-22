const fs = require('fs');
const file = 'c:/Users/miradorwin/Documents/GitHub/VMS_Project/miradorai-vms/src/pages/MapView/DesignerView.jsx';
const lines = fs.readFileSync(file, 'utf8').split('\n');
lines.forEach((line, i) => {
  if (line.toLowerCase().includes('floor draft') || line.toLowerCase().includes('sidebar') || line.toLowerCase().includes('settings')) {
    console.log(`${i+1}: ${line.trim()}`);
  }
});
