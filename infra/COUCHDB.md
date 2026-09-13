# Obsidian sync database

Runs a database called **CouchDB** on the server so Obsidian syncs your vault
between your laptop, phone and tablet, without paying for Obsidian Sync and
without the notes leaving your own box.

Obsidian itself is **not** installed on the server. You keep the normal
Obsidian app on each device; the server only holds the synced copy.

- Address: `https://couch.emaitch.co.uk`
- Container: `careertech-couchdb` (the official `couchdb:3` image, unmodified)
- Port: `127.0.0.1:5984` — not reachable from outside except through nginx
- Notes live in: `/srv/careertech/couchdb-data`
- Settings live in: `/srv/careertech/couchdb-config/10-livesync.ini`

## Why a subdomain and not `emaitch.co.uk/couchdb/`

Obsidian gives every note a document ID made from its file path, so a note in a
folder is fetched as `folder%2Fnote.md`. If CouchDB sat under a path, nginx
would decode that `%2F` back into a real slash while rewriting the prefix, and
notes inside folders would fail to sync **without showing an error**. Giving
CouchDB the root of its own hostname means there is no prefix to rewrite.

## Setting it up (first time only)

**1. Add a DNS record** wherever `emaitch.co.uk` is managed:

        Type   A
        Name   couch
        Value  85.190.97.70

**2. Run the setup script on the server.** It creates the nginx site and gets
the HTTPS certificate. It does not start the database.

```bash
ssh emaitch 'git clone --depth 1 https://github.com/Ceebl/Careertech.git /tmp/ct-couch && bash /tmp/ct-couch/infra/setup-couchdb.sh'
```

The script prints a freshly generated password at the end.

**3. Add two GitHub secrets** under Settings → Secrets and variables → Actions:

        COUCHDB_USER       obsidian
        COUCHDB_PASSWORD   the generated password

Save the password in your password manager first. You will type it into
Obsidian on every device, and nothing will show it to you again.

**4. Push to master.** The deploy starts the container and creates the
databases. Until both secrets exist the database step is skipped, so pushing
early is harmless.

## Setting up Obsidian on each device

Install the community plugin **Self-hosted LiveSync**, then in its settings:

        URI        https://couch.emaitch.co.uk
        Username   obsidian
        Password   the one from step 3
        Database   obsidian

Set up the **first** device, let it finish uploading, then use that device's
"Copy setup URI" to configure the others. Doing each device from scratch
independently is what causes duplicated notes.

**The end-to-end passphrase cannot be changed later** without wiping the
database and re-uploading from every device. Decide once, write it down, and
use the identical passphrase everywhere.

## When something goes wrong

Check the database is alive (`{"status":"ok"}` means yes):

```bash
ssh emaitch 'curl -s https://couch.emaitch.co.uk/_up'
```

Look at the container's logs:

```bash
ssh emaitch 'sudo docker logs --tail 50 careertech-couchdb'
```

**Syncs on the laptop but silently does nothing on the phone.** Almost always
CORS. The phone's requests come from `capacitor://localhost`, which must be
listed in the `origins` line of `infra/couchdb-livesync.ini`. Fix it there and
push — editing the file on the server directly gets overwritten by the next
deploy.

**"413" errors when adding an image.** `client_max_body_size` in
`infra/careertech-couchdb.conf` is the limit; it is currently 256m.

**Sync seems to hang partway.** Check `proxy_buffering off;` is still in
`infra/careertech-couchdb.conf`. With buffering on, nginx holds back the
long-running request the plugin uses to watch for changes.

## Notes for later

- The plugin uses the CouchDB **admin** account. Fine for one person; if this
  ever becomes shared, make a normal user that can reach only the `obsidian`
  database.
- The database is exposed to the open internet with only a password in front of
  it. `require_valid_user = true` means nothing is readable without logging in,
  so the password is the whole defence — make it a long one.
- Backups: `/srv/careertech/couchdb-data` is the whole thing. Nothing currently
  backs it up. Your devices each hold a full copy of the vault, so this is less
  alarming than it sounds, but it is not a backup strategy.
