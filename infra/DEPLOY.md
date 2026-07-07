# Leaderboard backend: deploy runbook

Everything needed to stand up the Lizard Block Mania leaderboard on AWS
from any computer. The code is already in this repo:

- `backend/index.mjs`: the Lambda handler (GET /top, POST /submit)
- `backend/periods.mjs`: pure UTC period-key helpers (all-time / day / week),
  imported by `index.mjs`. It MUST be zipped alongside the handler (see step 3)
- `infra/template.yml`: CloudFormation for the table, role, function, and Function URL
- `infra/budget.json` + `infra/budget-notifications.json`: $1/month billing tripwire
- `src/logic/config.js`: `LEADERBOARD_URL` holds the live Function URL,
  origin-gated to github.io (deployed 2026-07-03; see step 7 for the pattern)

Region for everything: **us-east-1**. Total cost at friends-and-family
traffic: $0/month (Lambda + Function URL free tier is permanent; the
DynamoDB table is on-demand and tiny).

## 0. Prerequisites on the new machine

1. Clone the repo and check out the `v2` branch (or `main` after v2 ships).
2. Install the AWS CLI v2: `winget install Amazon.AWSCLI` on Windows, or
   see https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
3. Open a FRESH terminal afterwards so `aws` is on PATH.

## 1. Credentials (one-time, manual)

Do not use root account keys.

1. AWS console > IAM > Users > Create user `thomas-cli`.
2. Attach the `AdministratorAccess` managed policy directly.
3. Create an access key (use case: Command Line Interface).
4. Run `aws configure`: paste the key ID and secret, region `us-east-1`,
   output `json`.
5. Verify: `aws sts get-caller-identity` should print your account ID.

## 2. Deploy the stack

From the repo root:

```
aws cloudformation deploy --stack-name lizard-leaderboard --template-file infra/template.yml --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset
```

## 3. Push the real Lambda code

The template only holds a placeholder; the real handler is pushed after
every stack deploy. The package now includes BOTH modules: `index.mjs` and
`periods.mjs` (the handler imports `./periods.mjs`, so a zip missing it fails
at cold start with a module-not-found error). Both files must sit at the root
of the zip. PowerShell:

```powershell
Compress-Archive -Path backend\index.mjs, backend\periods.mjs -DestinationPath backend\fn.zip -Force
aws lambda update-function-code --function-name lizard-leaderboard --zip-file fileb://backend/fn.zip
```

bash equivalent: `cd backend && zip fn.zip index.mjs periods.mjs && aws lambda update-function-code --function-name lizard-leaderboard --zip-file fileb://fn.zip`

Do not commit `fn.zip`.

## 4. Get the Function URL

```
aws cloudformation describe-stacks --stack-name lizard-leaderboard --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text
```

It looks like `https://xxxxxxxx.lambda-url.us-east-1.on.aws/`.

## 5. Smoke the API

> **PowerShell gotcha:** `curl.exe -d '{"...json..."}'` mangles the quotes and
> the Lambda replies `{"error":"bad json"}` / HTTP 400. Use `Invoke-RestMethod
> -Body $body` for the POST cases below (GET is fine with either).

Set `$U` to the Function URL (no trailing slash needed; trim one if present).

```powershell
# empty board initially
Invoke-RestMethod "$U/top"                       # expect scores: []

# a valid submit (playerId is any UUID, secret is any 32 hex chars)
$body = '{"playerId":"11111111-2222-3333-4444-555555555555","secret":"0123456789abcdef0123456789abcdef","name":"Test","score":150}'
Invoke-RestMethod -Method Post -Uri "$U/submit" -ContentType 'application/json' -Body $body
# expect accepted: true, best: 150

# same score again: not an improvement
Invoke-RestMethod -Method Post -Uri "$U/submit" -ContentType 'application/json' -Body $body
# expect accepted: false, best: 150

# wrong secret for the same playerId: 403
$evil = $body.Replace('0123456789abcdef0123456789abcdef', 'ffffffffffffffffffffffffffffffff')
try { Invoke-RestMethod -Method Post -Uri "$U/submit" -ContentType 'application/json' -Body $evil } catch { $_.Exception.Response.StatusCode }

# CORS preflight must echo the github.io origin
curl.exe -s -i -X OPTIONS "$U/submit" -H "Origin: https://chef55555.github.io" -H "Access-Control-Request-Method: POST" | Select-String "access-control"
```

### Period tabs (daily / weekly / all-time)

A single `/submit` writes THREE rows (all-time, this UTC day, this ISO week),
so one submitted score must appear on all three boards. Reusing `$U` and the
same `$body` from above (score 150):

```powershell
# Submit once more to be sure the three period rows exist.
Invoke-RestMethod -Method Post -Uri "$U/submit" -ContentType 'application/json' -Body $body

# The same score shows up on every board.
Invoke-RestMethod "$U/top?period=all"   # expect the score in the all-time list
Invoke-RestMethod "$U/top?period=week"  # expect it in this week's list
Invoke-RestMethod "$U/top?period=day"   # expect it in today's list

# No period, or a bogus one, falls back to all-time (never an empty error).
Invoke-RestMethod "$U/top"              # same as ?period=all
Invoke-RestMethod "$U/top?period=xyz"   # same as ?period=all

# The id in each row is the raw playerId (no period suffix), so the client can
# still highlight the player's own row:
(Invoke-RestMethod "$U/top?period=day").scores[0].id  # a bare UUID
```

Note on expiry: the daily row carries a TTL ~2 days out and the weekly row
~8 days out, so tomorrow's `?period=day` will not list today's row once
DynamoDB sweeps it (TTL deletion can lag hours, which is fine). The all-time
row has no TTL and never expires.

Clean up the test rows afterwards (optional). The all-time row has a stable
key; the day/week rows self-expire, so you can just let them age out:

```
aws dynamodb delete-item --table-name lizard-leaderboard --key "{\"pk\":{\"S\":\"P#11111111-2222-3333-4444-555555555555#ALL\"}}"
```

## 6. Billing tripwire

```
aws budgets create-budget --account-id YOUR_ACCOUNT_ID --budget file://infra/budget.json --notifications-with-subscribers file://infra/budget-notifications.json
```

`YOUR_ACCOUNT_ID` comes from `aws sts get-caller-identity`. The first two
budgets on an account are free. Alerts email thomas.sheffer@gmail.com at
50% and 100% of $1.

## 7. Wire the game to it

1. In `src/logic/config.js`, set the Function URL (keep the test hook AND the github.io
   origin gate: the API's CORS only allows that origin, so enabling it on
   localhost just spams console errors and breaks the smoke suite):
   `const LEADERBOARD_URL = (typeof window !== 'undefined' && window.__LB_URL__) || (typeof location !== 'undefined' && location.hostname.endsWith('github.io') ? 'https://xxxxxxxx.lambda-url.us-east-1.on.aws' : '');`
   (no trailing slash)
2. Bump `CACHE` in `sw.js` (mandatory on every deploy).
3. Run `node tests/logic.test.js` and `node tests/smoke.mjs`
   (smoke needs `python -m http.server 8080` serving the repo).
4. Commit, push to the beta repo (`git push beta v2:main`), verify with
   `node tests/live-check.mjs https://chef55555.github.io/lizard-blockdoku-beta/`.
5. Note: the browser can only call the API from `https://chef55555.github.io`
   because CORS is pinned there. Beta and production are the same origin host
   (different path), so both are allowed. As of the difficulty release, beta
   points at its OWN backend (section 8) and DOES submit there; production is a
   separate table, so beta playtesting never touches real scores.

## 8. Beta backend (separate stack)

The beta channel has its own isolated table + function + Function URL so
leaderboard changes can be tested end to end without touching production data.
It is the SAME template, deployed a second time with a name suffix.

```
# Deploy the beta stack (own table/function: lizard-leaderboard-beta)
aws cloudformation deploy --stack-name lizard-leaderboard-beta --template-file infra/template.yml --parameter-overrides NameSuffix=-beta --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset

# Push the SAME handler code to the beta function
Compress-Archive -Path backend\index.mjs, backend\periods.mjs -DestinationPath backend\fn.zip -Force
aws lambda update-function-code --function-name lizard-leaderboard-beta --zip-file fileb://backend/fn.zip

# Get the beta Function URL and paste it into BETA_LB_URL in src/logic/config.js
aws cloudformation describe-stacks --stack-name lizard-leaderboard-beta --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text
```

Then in `src/logic/config.js` set `BETA_LB_URL` to that URL (no trailing slash).
`LEADERBOARD_URL` already picks it when `IS_BETA`, and `BETA_LB_SUBMITS` is on,
so the beta site reads and writes its own board. Production is untouched: it
keeps `--stack-name lizard-leaderboard` (default empty `NameSuffix`) and the
prod URL. Redeploy production code the usual way (section 3) whenever the
handler changes; both functions must run the same `backend/*.mjs`.

Difficulty note: `/submit` and `/top` now take a `difficulty` (body field /
`?difficulty=`). Easy reuses the bare period keys, so existing rows are the Easy
board; Normal/Hard prefix the key. Smoke it by adding `?difficulty=hard` to the
`/top` calls and a `"difficulty":"hard"` field to the `/submit` body.

## Gotchas from the first real deploy (2026-07-03, account 172627761914)

- **Function URL returned 403 `AccessDeniedException` on every GET/POST** even
  though `AuthType` was `NONE` and the `lambda:InvokeFunctionUrl` grant for
  `Principal: '*'` was present. Fix: the resource policy ALSO needs a plain
  `lambda:InvokeFunction` grant for `Principal: '*'` (no `FunctionUrlAuthType`
  condition: AWS rejects that flag on this action). Both statements are now in
  `template.yml` (`FnUrlPermission` + `FnInvokePermission`), so a fresh deploy
  is fine. Direct `aws lambda invoke` worked the whole time; that isolates a
  403 like this to the URL auth layer, not your handler.
- The AWS CLI installs to `C:\Program Files\Amazon\AWSCLIV2\aws.exe`. If `aws`
  isn't on PATH yet, call it by that full path.

## Design notes (for future maintenance)

- Data model: one DynamoDB row per (player, period). `pk = P#<uuid>#<periodKey>`
  and the row's `lb` attribute IS that period key, so the existing sparse GSI
  `top` (partition `lb`, sort `score`) serves each board with one descending
  Query. Period keys are computed by `backend/periods.mjs` on the SERVER clock,
  in UTC, never from client input:
  - all-time: `ALL`
  - day: `D#YYYY-MM-DD`
  - week: `W#GGGG-Www` (ISO-8601 week date; the ISO week-year GGGG can differ
    from the calendar year around Jan 1 / Dec 31)
- Each `/submit` upserts the all/day/week rows together, keeping the MAX score
  per period. First write for a period pins `secretHash` (sha256 of the client
  secret); later writes need the same secret AND a strictly higher score for
  that period (per period, so a fresh daily row is never blocked by a bigger
  all-time score). The all-time row governs the response `{accepted, best}` and
  ownership: a wrong secret is rejected before any day/week write.
- TTL: day rows expire ~2 days out, week rows ~8 days out (attribute `ttl`,
  swept by DynamoDB). The all-time row has no TTL.
- `/top?period=all|day|week` (default `all`, unknown falls back to `all`) maps
  the name to a key and queries the GSI. Returned `id` is the raw playerId
  (period suffix stripped) so the client can still highlight its own row.
- Rate limiting: 30 POSTs per IP per hour via counter rows with DynamoDB TTL.
  The old per-player 10s update gap was dropped (per-game submits on every game
  over are legitimate and a lower daily-best must not be blocked); the IP rate
  limit is the remaining abuse guard.
- Anti-cheat is plausibility-only (score cap 100000) by design: accepted risk
  for a friends-only board.
- CORS lives entirely on the Function URL config in the template; the Lambda
  code never sets CORS headers.
- The client submits each FINISHED game's score (not a lifetime best); the
  server keeps the per-period max. The client identity lives in localStorage
  key `lizard-blockdoku-lb` (playerId, secret, bestSubmitted). `bestSubmitted`
  is now just an informational mirror of the highest confirmed submit; the
  submit dedupe guard is an in-memory session high-water, so a new session's
  first game always reaches today's board even when it is below the lifetime
  best. Clearing the key mints a new identity; old rows orphan harmlessly.
- Migration on first deploy of this version: the previous model stored one row
  per player with `lb = "LB"`. New reads query `lb = "ALL"`, so pre-existing
  all-time entries drop off the board until each player submits again (which
  creates their `#ALL` row). The stale `LB` rows have no TTL; delete them by
  hand if you want a clean table, otherwise they sit invisible and harmless.
