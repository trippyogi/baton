'use strict';

/**
 * T3.3: clean legacy multi-active / sibling-child runs, then add unique indexes.
 * Does not fabricate ACK/review history — only cancels surplus non-terminal runs.
 */
module.exports = function enforceRunInvariants(db) {
  // Keep newest non-terminal run per task; cancel the rest.
  const dupTasks = db
    .prepare(
      `SELECT task_id AS task_id, COUNT(*) AS n
       FROM runs
       WHERE task_id IS NOT NULL
         AND status NOT IN (
           'completed','blocked','invalid_output','dispatch_failed',
           'failed','lost','timed_out','cancelled'
         )
       GROUP BY task_id
       HAVING n > 1`
    )
    .all();

  const cancel = db.prepare(
    `UPDATE runs
     SET status = 'cancelled',
         failure_message = COALESCE(failure_message, 'migration: duplicate active run cleanup'),
         ended_at = COALESCE(ended_at, datetime('now')),
         version = version + 1,
         updated_at = datetime('now')
     WHERE id = ?`
  );

  for (const row of dupTasks) {
    const runs = db
      .prepare(
        `SELECT id FROM runs
         WHERE task_id = ?
           AND status NOT IN (
             'completed','blocked','invalid_output','dispatch_failed',
             'failed','lost','timed_out','cancelled'
           )
         ORDER BY datetime(COALESCE(created_at, updated_at, '1970-01-01')) DESC, rowid DESC`
      )
      .all(row.task_id);
    const keepId = runs[0]?.id || null;
    for (const extra of runs.slice(1)) {
      cancel.run(extra.id);
    }
    if (keepId) {
      db.prepare(
        `UPDATE tasks
         SET current_run_id = ?,
             version = version + 1,
             updated_at = datetime('now')
         WHERE id = ?
           AND (current_run_id IS NULL OR current_run_id != ?)`
      ).run(keepId, row.task_id, keepId);
    }
  }

  // Linear lineage: at most one child per parent_run_id.
  const dupParents = db
    .prepare(
      `SELECT parent_run_id AS parent_run_id, COUNT(*) AS n
       FROM runs
       WHERE parent_run_id IS NOT NULL
       GROUP BY parent_run_id
       HAVING n > 1`
    )
    .all();

  for (const row of dupParents) {
    const children = db
      .prepare(
        `SELECT id FROM runs
         WHERE parent_run_id = ?
         ORDER BY datetime(COALESCE(created_at, updated_at, '1970-01-01')) DESC, rowid DESC`
      )
      .all(row.parent_run_id);
    for (const extra of children.slice(1)) {
      cancel.run(extra.id);
      // Clear parent link on cancelled surplus siblings so unique index can apply.
      db.prepare('UPDATE runs SET parent_run_id = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(
        extra.id
      );
    }
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_nonterminal_per_task
      ON runs(task_id)
      WHERE task_id IS NOT NULL
        AND status NOT IN (
          'completed',
          'blocked',
          'invalid_output',
          'dispatch_failed',
          'failed',
          'lost',
          'timed_out',
          'cancelled'
        );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_linear_parent
      ON runs(parent_run_id)
      WHERE parent_run_id IS NOT NULL;
  `);

  // Realign current_run_id when it points at a missing run or the wrong active run.
  const tasks = db
    .prepare(
      `SELECT t.id AS task_id, t.current_run_id AS current_run_id
       FROM tasks t
       WHERE t.current_run_id IS NOT NULL`
    )
    .all();
  for (const task of tasks) {
    const pointed = db.prepare('SELECT id, status FROM runs WHERE id = ?').get(task.current_run_id);
    const active = db
      .prepare(
        `SELECT id FROM runs
         WHERE task_id = ?
           AND status NOT IN (
             'completed','blocked','invalid_output','dispatch_failed',
             'failed','lost','timed_out','cancelled'
           )
         ORDER BY datetime(COALESCE(created_at, updated_at, '1970-01-01')) DESC, rowid DESC
         LIMIT 1`
      )
      .get(task.task_id);

    let nextId = task.current_run_id;
    if (!pointed) {
      nextId = active ? active.id : null;
    } else if (active && pointed.id !== active.id) {
      nextId = active.id;
    }

    if (nextId !== task.current_run_id) {
      db.prepare(
        `UPDATE tasks
         SET current_run_id = ?,
             version = version + 1,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(nextId, task.task_id);
    }
  }
};
