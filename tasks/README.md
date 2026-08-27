# Tasks

A private boards-and-to-do app, in the shape of monday.com, at
<https://emaitch.co.uk/tasks/>. Nothing in it is reachable without signing in.

## The idea

    workspace   one area of life        "Work", "House"
      board     one table of things     "Bathroom renovation"
        group   a coloured section      "This week", "Done"
          item  a row -- the to-do      "Get quotes for tiling"
        column  a typed field           Status, Person, Date, Number, Text,
                                        Tick box, Blocked by

Boards have two views: **Table** (the editable one -- click a cell and it saves
itself) and **Kanban** (the same items stacked into columns by status). Items
have a comment thread.

## Blocked by

Add a **Blocked by** column to a board (Settings → add column) and the whole
feature lives in the table: the cell shows what a task is waiting on, and
clicking it opens a picker to link or unlink tasks without leaving the board.
A `×` beside a linked task drops it; finished ones are shown struck through.
The item's own page does the same job for anyone who prefers it, and the row's
`···` menu links straight there.

While anything a task is waiting on is unfinished, its row carries an orange
padlock naming the culprits, and the Blocked by cell turns orange. Once
everything is finished the cell reads a green "clear".

Only one Blocked by column per board is allowed. It is the one column type that
stores nothing of its own -- it is a window onto the links between items, so a
second copy could only ever repeat the first.

It is not a status; it drives the status. When the last thing a task was waiting
on reaches a status ticked **Counts as finished**, that task is freed and moved
straight to whatever the column's *"when everything a task was waiting on is
finished, move that task to"* setting says -- "Working on it" by default. Both
settings live in the label editor, reachable from board Settings or from the
bottom of any status dropdown.

Two things it will not do. A task already sitting on a finished status is never
moved, so being unblocked cannot undo a completion. And a task waiting on
several items only moves when every one of them is clear.

Circular waits are refused when you try to create them -- A waiting on B while B
waits on A means neither can ever start, and the app walks the chain before
saving to make sure that cannot happen, however long the loop.

## Running it locally

    cd tasks
    npm install
    npm run dev

It prints a one-off admin password on first run and serves
<http://localhost:3011/tasks/>. The local database lives in `.localdata/` and is
never committed.

## How it deploys

Pushing to `master` builds `tasks/Dockerfile` into the `careertech-tasks`
container, listening on `127.0.0.1:3001`, with nginx proxying `/tasks/` to it
(see `infra/careertech-tasks.conf`).

It is **not** part of the shared `careertech-api` container, and that is
deliberate: this app holds the only data on the box that would actually hurt to
lose or leak, and `careertech-api` serves endpoints that are currently open to
anyone on the internet. Separate image, separate process, separate volume.

Its database and session key live on the host at `/srv/careertech/tasks-data`,
owned by uid 1000 with mode 700.

### The two secrets it needs

Set these once in the repository's GitHub secrets. They create the very first
account on an empty database and are ignored from then on -- changing them later
does not reset anybody's password.

| Secret | What to put in it |
|---|---|
| `TASKS_ADMIN_USER` | The username you want, e.g. `mike` |
| `TASKS_ADMIN_PASSWORD` | A long passphrase, at least 12 characters |

You are made to replace that password the first time you sign in, so it stops
being a password GitHub has seen as soon as you use it. After that, every other
account is created from **Administration** inside the app.

## How it is kept private

The short version, in the order a request meets it:

| | |
|---|---|
| **Nothing is public** | The app renders its own pages. nginx serves no file from disk, so there is no URL that returns content without a session. |
| **No sign-up** | Accounts exist only because an admin made one. There is no public form to attack. |
| **Passwords** | scrypt, 64MB of memory per guess, per-user salt. A wrong username costs exactly as long as a right one, so the reply time does not reveal which accounts are real. |
| **Sessions** | Rows in the database, not signed cookies, so signing out takes effect immediately. Only a hash of the token is stored. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and scoped to `/tasks`. |
| **Guessing** | Login attempts are counted per account *and* per address, and locked for 15 minutes after 8 or 20. |
| **Seeing each other's work** | Every lookup joins through workspace membership with your user id bound into the query -- see `lib/access.js`. "Not yours" and "does not exist" produce the same 404. Being an admin grants no access to anybody's boards. |
| **Forged requests** | Every write carries a token derived from your session. |
| **Injected content** | Templates escape by default (`lib/html.js`); no user HTML is stored or rendered anywhere. The Content-Security-Policy allows no inline script and no inline style at all -- which is why colours are CSS classes rather than `style` attributes. |
| **A record** | Everything that creates, destroys or grants access is written to an audit log, readable at **Administration → Audit log**. |

Two-factor authentication is not switched on. The accounts table already carries
the columns for it, so adding it later is a feature rather than a migration.

## Layout

    server.js          middleware order == the security model; read it top to bottom
    lib/access.js      who can see what -- the most important file here
    lib/passwords.js   hashing and the password rules
    lib/sessions.js    sessions as rows
    lib/csrf.js        forged-request protection
    lib/columns.js     the column types, and the closed colour palette
    lib/html.js        escape-by-default templating
    store/             all the SQL, one file per kind of thing
    views/             HTML, one file per area of the app
    routes/            URL to view, with a guard on every one
    client/            the only files served from disk
