// Minimal static server for the portfolio. No framework, one dep.
const express = require('express');
const path = require('node:path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Portfolio live at http://localhost:${port}`));
