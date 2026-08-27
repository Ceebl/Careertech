// The shape of the database.
//
// Vocabulary, borrowed from monday.com because it is genuinely good:
//
//   workspace  a container for a whole area of life ("Work", "House")
//   board      one table of things to do ("Bathroom renovation")
//   group      a coloured band splitting a board into sections ("This week")
//   item       a row -- the actual to-do
//   column     a typed field on every item (Status, Person, Date, ...)
//   cell       one item's value for one column
//
// Two decisions worth explaining:
//
// 1. Ids are random text, not counting numbers. A board at /tasks/b/7 invites
//    you to try /tasks/b/8; a board at /tasks/b/k3Xq9mVt2Lp0 does not. The
//    membership check in access.js is the real defence, but there is no reason
//    to hand out a map as well.
//
// 2. Column values live in one `cells` table rather than as real columns. Users
//    add and remove columns whenever they like, and rewriting the table shape
//    at runtime is how you end up with a corrupt database.

export const SCHEMA = `
  /* ------------------------------------------------------------- accounts */

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT    PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT    NOT NULL DEFAULT '',
    password_hash TEXT    NOT NULL,
    /* Accounts are created by an admin who types the first password, so the
       account is useless until the owner replaces it with one only they know. */
    must_change   INTEGER NOT NULL DEFAULT 0,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    /* Slot for two-factor authentication. Nothing reads these yet; they are
       here so switching 2FA on later is a feature, not a migration. */
    totp_secret   TEXT,
    totp_enabled  INTEGER NOT NULL DEFAULT 0,
    disabled_at   TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  /* Sessions are rows, not signed cookies, so signing someone out actually
     signs them out -- a signed cookie stays valid until it expires no matter
     what the server thinks. What is stored is a hash of the token, so a stolen
     copy of this database still gets you into nobody's account. */
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT    PRIMARY KEY,
    user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT    NOT NULL,
    ip           TEXT    NOT NULL DEFAULT '',
    user_agent   TEXT    NOT NULL DEFAULT '',
    revoked_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  /* --------------------------------------------------------- workspaces */

  CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL,
    colour      TEXT NOT NULL DEFAULT '#496DDB',
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT
  );

  /* This table is the whole access-control system. If a row is not here, the
     user cannot see the workspace or anything inside it. Roles:
       owner   -- everything, including renaming and deleting the workspace
                  and managing who is in it
       member  -- read and write boards and items
       viewer  -- read, and comment, but change nothing */
  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member',
    added_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);

  /* ------------------------------------------------------------- boards */

  CREATE TABLE IF NOT EXISTS boards (
    id           TEXT    NOT NULL PRIMARY KEY,
    workspace_id TEXT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    archived_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_boards_workspace ON boards(workspace_id, position);

  CREATE TABLE IF NOT EXISTS board_groups (
    id        TEXT    NOT NULL PRIMARY KEY,
    board_id  TEXT    NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name      TEXT    NOT NULL,
    colour    TEXT    NOT NULL DEFAULT '#496DDB',
    position  INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_groups_board ON board_groups(board_id, position);

  /* The settings column is JSON whose shape depends on the type column -- the
     labels and colours for a status column, for instance. See lib/columns.js. */
  CREATE TABLE IF NOT EXISTS board_columns (
    id       TEXT    NOT NULL PRIMARY KEY,
    board_id TEXT    NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name     TEXT    NOT NULL,
    type     TEXT    NOT NULL,
    settings TEXT    NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_columns_board ON board_columns(board_id, position);

  /* -------------------------------------------------------------- items */

  /* A subitem is an ordinary item with a parent. It lives in the same group and
     uses the same columns as everything else on the board, which is a
     simplification of what monday.com does -- there, subitems are a board of
     their own with their own columns. One shared set of columns is less to
     explain and less to keep in step, and it means a subitem can carry a
     status, an owner and a dependency like anything else.

     Nesting is one level deep, enforced in the routes: a subitem cannot have
     subitems of its own. */
  CREATE TABLE IF NOT EXISTS items (
    id          TEXT    NOT NULL PRIMARY KEY,
    board_id    TEXT    NOT NULL REFERENCES boards(id)       ON DELETE CASCADE,
    group_id    TEXT    NOT NULL REFERENCES board_groups(id) ON DELETE CASCADE,
    parent_id   TEXT    REFERENCES items(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_items_board ON items(board_id, archived_at);
  CREATE INDEX IF NOT EXISTS idx_items_group ON items(group_id, position);
  /* The index on parent_id is created in lib/db.js instead: on a database that
     predates the column, this block runs before the column has been added. */

  CREATE TABLE IF NOT EXISTS cells (
    item_id   TEXT NOT NULL REFERENCES items(id)         ON DELETE CASCADE,
    column_id TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    value     TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (item_id, column_id)
  );

  /* "This item cannot start until that one is finished."
     One row per dependency; an item can wait on several things at once. Both
     ends are items, and the routes insist they are on the same board -- a
     dependency on something in a workspace you might later lose access to
     would be a hole that is easy to open and hard to notice.

     Finished means: the blocking item has been deleted, or its status is a
     label ticked as "counts as finished" in the label editor. */
  CREATE TABLE IF NOT EXISTS item_blockers (
    item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    blocker_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    added_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (item_id, blocker_id)
  );

  CREATE INDEX IF NOT EXISTS idx_blockers_item    ON item_blockers(item_id);
  CREATE INDEX IF NOT EXISTS idx_blockers_blocker ON item_blockers(blocker_id);

  CREATE TABLE IF NOT EXISTS comments (
    id         TEXT NOT NULL PRIMARY KEY,
    item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id, created_at);

  /* --------------------------------------------------------------- audit */

  /* Append-only record of anything that matters. If something odd ever happens
     this is the only way to find out what, and who did it. The username is
     copied in rather than joined so the trail survives deleting the account. */
  CREATE TABLE IF NOT EXISTS audit (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       TEXT NOT NULL DEFAULT (datetime('now')),
    user_id  TEXT,
    username TEXT NOT NULL DEFAULT '',
    ip       TEXT NOT NULL DEFAULT '',
    action   TEXT NOT NULL,
    detail   TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);
`;

/** Workspace roles, ordered weakest first. */
export const ROLES = ['viewer', 'member', 'owner'];
