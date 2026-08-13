const axios = require('axios');
const fs = require('fs');

const token = fs.readFileSync('f:\\xiangmu\\music\\token', 'utf-8').trim();
const notes = fs.readFileSync('f:\\xiangmu\\music\\BLOG-v3.1.6.md', 'utf-8');

axios.patch('https://api.github.com/repos/xiaomingky/MingYunTime/releases/367692724', {
  body: notes
}, {
  headers: {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github+json'
  },
  proxy: {
    protocol: 'http',
    host: '127.0.0.1',
    port: 7897
  }
}).then(res => {
  console.log('Success:', res.status);
}).catch(err => {
  console.error('Error:', err.response ? err.response.data : err.message);
});
