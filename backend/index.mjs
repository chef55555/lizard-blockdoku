// Lizard Block Mania leaderboard: one Lambda behind a Function URL.
// GET /top returns the top 50; POST /submit upserts a player's best.
// CORS is handled entirely at the Function URL layer, never here.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { createHash } from 'node:crypto';
import { periodKeys, periodKeyFor } from './periods.mjs';

const TABLE = process.env.TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RATE_LIMIT_PER_HOUR = 30; // POSTs per IP
const MAX_SCORE = 100000;       // plausibility cap (basic sanity anti-cheat)
const DAY_TTL_SEC = 2 * 86400;  // daily rows self-expire ~2 days out
const WEEK_TTL_SEC = 8 * 86400; // weekly rows self-expire ~8 days out

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const resp = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/* Mirrors the client's nickname rules: strip angle brackets, control and
   zero-width characters, collapse whitespace, 1-20 code points. */
function sanitizeName(raw) {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const name = raw.normalize('NFC')
    .replace(/[<>\u0000-\u001F\u007F-\u009F\u200B-\u200F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const points = [...name].length;
  if (points < 1 || points > 20) return null;
  return name;
}

export const handler = async (event) => {
  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || '';
  const path = event.rawPath || '/';
  if (method === 'GET' && path === '/top') return top(event);
  if (method === 'POST' && path === '/submit') return submit(event);
  return resp(404, { error: 'not found' });
};

async function top(event) {
  /* ?period=all|day|week (default all). The server, never the client, maps
     the name to a period key on its own clock. */
  const period = (event.queryStringParameters && event.queryStringParameters.period) || 'all';
  const key = periodKeyFor(period, Date.now());
  const out = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'top',
    KeyConditionExpression: 'lb = :lb',
    ExpressionAttributeValues: { ':lb': key },
    ScanIndexForward: false,
    Limit: 50,
  }));
  return resp(200, {
    scores: (out.Items || []).map((it) => ({
      /* pk is 'P#'+playerId+'#'+key; the UUID carries no '#', so the first
         segment after the 'P#' prefix is the raw playerId the client needs to
         highlight its own row. */
      id: it.pk.slice(2).split('#')[0],
      name: it.name,
      score: it.score,
      when: it.updatedAt,
    })),
  });
}

/* Upsert one (player, period) row, keeping the higher score. First write for
   a period pins the secret hash; later writes need the same secret AND a
   strictly better score (per period, so a fresh day/week row is not blocked
   by a bigger all-time score). ttl 0 means "no TTL" (the all-time row). */
function upsertPeriod(pk, key, name, score, secretHash, now, ttl) {
  const names = { '#n': 'name' };
  const values = {
    ':name': name,
    ':score': score,
    ':hash': secretHash,
    ':lb': key,
    ':now': now,
  };
  let setExpr = '#n = :name, score = :score, lb = :lb, updatedAt = :now, '
    + 'secretHash = if_not_exists(secretHash, :hash), createdAt = if_not_exists(createdAt, :now)';
  if (ttl) {
    setExpr += ', #ttl = :ttl';
    names['#ttl'] = 'ttl';
    values[':ttl'] = now + ttl;
  }
  return ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk },
    UpdateExpression: 'SET ' + setExpr,
    ConditionExpression: 'attribute_not_exists(pk) OR (secretHash = :hash AND score < :score)',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
  }));
}

async function submit(event) {
  const rawBody = event.body || '';
  if (rawBody.length > 1024) return resp(413, { error: 'too large' });
  let data;
  try { data = JSON.parse(rawBody); } catch (err) { return resp(400, { error: 'bad json' }); }
  if (!data || typeof data !== 'object') return resp(400, { error: 'bad body' });

  const { playerId, secret, score } = data;
  const name = sanitizeName(data.name);
  if (typeof playerId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(playerId)) {
    return resp(400, { error: 'bad playerId' });
  }
  if (typeof secret !== 'string' || !/^[0-9a-f]{32}$/.test(secret)) return resp(400, { error: 'bad secret' });
  if (!name) return resp(400, { error: 'bad name' });
  if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return resp(400, { error: 'bad score' });

  /* Per-IP hourly counter; DynamoDB TTL sweeps the rows */
  const ip = (event.requestContext && event.requestContext.http && event.requestContext.http.sourceIp) || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  const rl = await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: 'RL#' + ip + '#' + Math.floor(now / 3600) },
    UpdateExpression: 'ADD #n :one SET #t = if_not_exists(#t, :ttl)',
    ExpressionAttributeNames: { '#n': 'n', '#t': 'ttl' },
    ExpressionAttributeValues: { ':one': 1, ':ttl': now + 7200 },
    ReturnValues: 'ALL_NEW',
  }));
  if (((rl.Attributes && rl.Attributes.n) || 0) > RATE_LIMIT_PER_HOUR) return resp(429, { error: 'slow down' });

  /* One row per (player, period). The client submits the FINISHED game's
     score; each period keeps the player's max for that period. Keys are
     derived from the server clock so client time is never trusted. Reuse the
     same integer second for the keys and the timestamps. */
  const secretHash = sha256(secret);
  const keys = periodKeys(now * 1000);
  const base = 'P#' + playerId;

  /* The all-time row governs ownership and the returned best. A wrong secret
     stops here (before any day/week write); a merely-lower score does not,
     since it can still be a fresh daily or weekly best. */
  let accepted = false;
  let best = score;
  try {
    await upsertPeriod(base + '#' + keys.all, keys.all, name, score, secretHash, now, 0);
    accepted = true;
    best = score;
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
    const old = err.Item ? unmarshall(err.Item) : null;
    if (!old || old.secretHash !== secretHash) return resp(403, { error: 'not yours' });
    accepted = false;
    best = old.score;
  }

  /* Day + week rows run regardless of the all-time outcome. A ConditionalCheck
     failure here just means "not a new best for that period" and is ignored;
     any other error propagates. */
  await Promise.all([
    upsertPeriod(base + '#' + keys.day, keys.day, name, score, secretHash, now, DAY_TTL_SEC).catch(swallowCond),
    upsertPeriod(base + '#' + keys.week, keys.week, name, score, secretHash, now, WEEK_TTL_SEC).catch(swallowCond),
  ]);

  return resp(200, { accepted, best });
}

function swallowCond(err) {
  if (err.name === 'ConditionalCheckFailedException') return null;
  throw err;
}
