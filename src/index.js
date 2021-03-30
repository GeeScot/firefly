const express = require('express');
const { parse, isValid } = require('date-fns');
const Datastore = require('nedb');
const { v4 } = require('uuid');
const multer = require('multer');
const xlsx = require('node-xlsx').default;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const app = express();
const port = 3000;

app.use(express.text());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/download/:targetDb', async (req, res) => {
  res.download(`temp/${req.params['targetDb']}.db`, 'quotes.db');
});

app.post('/api/convert/csv', upload.single('quotelist'), (req, res) => {
  const streamer = req.body.streamer;
  const fileContents = req.file.buffer.toString();
  const lines = fileContents.split('\n');

  const tempDb = createDb(streamer, lines);
  res.json({
    createdDb: tempDb
  });
});

app.post('/api/convert/xlsx', upload.single('quotelist'), (req, res) => {
  const streamer = req.body.streamer;
  const worksheets = xlsx.parse(req.file.buffer);

  const lines = worksheets[0].data.map((line) => {
    return `${line[0]},${line[1]}`;
  });

  const tempDb = createDb(streamer, lines.slice(1, lines.length));
  res.json({
    createdDb: tempDb
  });
});

app.listen(port, () => {
  console.log(`listening at http://localhost:${port}`);
});

function createDb(streamer, lines) {
  const tempDb = v4();
  const db = new Datastore({ filename: `temp/${tempDb}.db` });
  db.loadDatabase(err => {
    if (err) {
      console.log(err);
    }
  });

  db.insert({
    _id: '__autoid__',
    seq: 0
  });

  lines.forEach((line) => {
    const firstComma = line.indexOf(',');
    const id = line.substring(0, firstComma);
    const text = line.substring(firstComma+1, line.length);

    const tokenizer = /^(.*)(\[.*\]).*(\[.*\])/g;
    const result = tokenizer.exec(text);
    if (result === null) {
      db.update(
        { _id: '__autoid__' },
        { $inc: { seq: 1 } },
        { upsert: true, returnUpdatedDocs: true }
      );
      db.insert({
        createdAt: '',
        creator: streamer,
        originator: 'streamlabs',
        game: '',
        text: text.trim(),
        _id: parseInt(id)+1
      });
      return;
    }

    const formats = [
      '[ddMMyyyy]', 
      '[dd-MM-yyyy]', 
      '[dd/MM/yyyy]', 
      '[dd.MM.yyyy]'
    ];

    let createdDate = null;
    for (let i = 0; i < formats.length; i++) {
      createdDate = parse(result[3], formats[i], new Date());
      if (isValid(createdDate)) {
        break;
      }
    }

    if (!isValid(createdDate)) {
      return;
    }

    db.update(
      { _id: '__autoid__' },
      { $inc: { seq: 1 } },
      { upsert: true, returnUpdatedDocs: true }
    );
    db.insert({
      createdAt: createdDate.toISOString(),
      creator: streamer,
      originator: 'streamlabs',
      game: result[2].substring(1, result[2].length-1),
      text: result[1].trim(),
      _id: parseInt(id)+1
    });
  });

  db.persistence.compactDatafile();

  return tempDb;
}
