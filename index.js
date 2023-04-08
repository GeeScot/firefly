const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const minify = require('express-minify');
const compression = require('compression');
const { createClient } = require('redis');

const { parse, isValid } = require('date-fns');
const Datastore = require('nedb');
const { v4 } = require('uuid');
const multer = require('multer');
const xlsx = require('node-xlsx').default;
const axios = require('axios');
const fs = require('fs');
const { Mutex } = require('async-mutex');

const cache = createClient();
cache.connect();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const mutex = new Mutex();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.text());
app.use(express.json());

app.use(compression());
app.use(minify());
app.use(express.static('public'));

app.get('/api/download/:outputName/:targetDb', async (req, res) => {
  const outputName = req.params['outputName'];
  const targetDb = req.params['targetDb'];
  
  res.download(`temp/${targetDb}.db`, `${outputName}.db`, function(err) {
    fs.unlink(`temp/${targetDb}.db`, (err) => {
      if (err) {
        throw err;
      }

      console.log(`temp/${targetDb}.db was deleted`);
    });
  });
});

app.post('/api/quotes/xlsx', upload.single('quotelist'), (req, res) => {
  const streamer = req.body.streamer;
  const worksheets = xlsx.parse(req.file.buffer);

  const lines = worksheets[0].data.map((line) => {
    return `${line[0]},${line[1]}`;
  });

  const result = createQuotesDb(streamer, lines.slice(1, lines.length));
  res.json(result);
});

app.post('/api/users/xlsx', upload.single('userlist'), async (req, res) => {
  const currencyId = req.body.currencyId;
  const worksheets = xlsx.parse(req.file.buffer);
  const rows = worksheets[0].data;

  const result = await createUsersDb(currencyId, rows.slice(1, rows.length));
  res.json(result);
});

app.listen(port, () => {
  console.log(`listening at http://localhost:${port}`);
});

function createQuotesDb(streamer, lines) {
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

  const result = {
    createdDb: tempDb,
    totalQuotes: lines.length
  };

  console.log(result);

  return result;
}

async function createUsersDb(currencyId, rows) {
  const tempDb = v4();
  const db = new Datastore({ filename: `temp/${tempDb}.db` });
  db.loadDatabase(err => {
    if (err) {
      console.log(err);
    }
  });

  const chunkSize = 100;
  const allUsers = rows.map(row => row[0]);

  for (let i = 0; i < allUsers.length; i += chunkSize) {
    console.log(`Chunk ${i}-${i+chunkSize}`);
    let nextChunk = i + chunkSize;
    if (nextChunk > allUsers.length) {
      nextChunk = allUsers.length;
    }

    const batchUsers = allUsers.slice(i, nextChunk);
    const trimmedBatchUsers = [];
    for (const user of batchUsers) {
      if (user?.toLowerCase) {
        const existingUser = await cache.get(user.toLowerCase());
        if (!existingUser) {
          trimmedBatchUsers.push(user);
        }
      }
    }

    const users = await getTwitchUsers(trimmedBatchUsers);
    for (const user of users) {
      if (user?.login) {
        await cache.set(user.login.toLowerCase(), JSON.stringify(user));
      } else {
        console.log(user);
      }
    }
  }

  const inactiveUsers = [];

  for (const row of rows) {
    const username = row[0];
    const points = row[2];
    const hours = row[3];

    const cachedUser = await cache.get(`${username}`.toLowerCase());
    if (!cachedUser) {
      console.log(`Couldn't find ${username}`);
      inactiveUsers.push(username);
      continue;
    }

    const twitchUser = JSON.parse(cachedUser);
    const lastSeenDate = Date.parse(twitchUser.created_at); // set to the account creation date since we don't really know.

    const firebotUser = {
      _id: twitchUser.id,
      username: username.toLowerCase(),
      displayName: twitchUser.display_name,
      profilePicUrl: twitchUser.profile_image_url,
      twitch: true,
      twitchRoles: [],
      online: false,
      onlineAt: lastSeenDate,
      lastSeen: lastSeenDate,
      joinDate: lastSeenDate,
      minutesInChannel: hours * 60,
      chatMessages: 0,
      disableAutoStatAccrual: false,
      disableActiveUserList: false,
      metadata: {},
      currency: {
        [currencyId]: points
      }
    };

    await mutex.waitForUnlock();
    const release = await mutex.acquire();

    try {
      db.insert(firebotUser);
    } catch (e) {
      console.log(e);
    } finally {
      release();
    }
  }

  db.persistence.compactDatafile();

  const result = {
    createdDb: tempDb,
    totalUsersCount: allUsers.length,
    activeUsersCount: db.length,
    inactiveUsers: inactiveUsers.sort()
  };

  console.log({
    createdDb: result.createdDb,
    totalUsersCount: result.totalUsersCount,
    activeUsersCount: result.activeUsersCount
  });

  return result;
}

async function getTwitchUsers(channels) {
  try {
    const params = channels.map(c => `login=${encodeURIComponent(c)}`);
    const targetUrl = `https://api.twitch.tv/helix/users?${params.join('&')}`;
    return await getFromTwitch(targetUrl);
  } catch (e) {
    return await getActiveUsers(channels);
  }
}

async function getActiveUsers(channels) {
  const activeUsers = [];
  for (const channel of channels) {
    const singleUserUrl = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`;
    try {
      const data = await getFromTwitch(singleUserUrl);
      activeUsers.push(...data);
    } catch (e) {
      console.log(`Unknown User ${channel}`);
    }
  }

  return activeUsers;
}

async function getFromTwitch(targetUrl) {
  const token = await getTwitchToken();
  const { data } = await axios.get(targetUrl, {
    headers: {
      'Client-Id': `${process.env.TWITCH_CLIENT_ID}`,
      'Authorization': `Bearer ${token}`
    }
  });

  return data.data;
}

async function getTwitchToken() {
  const targetUrl = `https://id.twitch.tv/oauth2/token`;
  const { data } = await axios.post(targetUrl, {
    'client_id': process.env.TWITCH_CLIENT_ID,
    'client_secret': process.env.TWITCH_CLIENT_SECRET,
    'grant_type': 'client_credentials'
  });

  return data.access_token;
}
