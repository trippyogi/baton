const express = require('express');
const db = require('../db');
const router = express.Router();

// Create a new run
router.post('/', (req, res) => {
  const { agent_name, worker_type, status, cost, tokens, started_at } = req.body;
  const id = require('crypto').randomUUID();
  console.log('Incoming payload:', req.body);

  try {
    console.log('Generated ID:', id);
    const insert = db.prepare(`INSERT INTO runs (id, agent_name, worker_type, status, cost, tokens, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const result = insert.run(id, agent_name, worker_type, status, cost, tokens, started_at);
    console.log('Insert operation result:', result);

    if (result.changes === 0) {
      console.error('Insert failed: no changes were made, returning error.');
      return res.status(400).json({ error: 'Insert failed: no changes made' });
    }

    // Respond with the newly created ID
    res.status(201).json({ id });
  } catch (error) {
    console.error('Database insertion error:', error.message);
    res.status(500).json({ error: 'Insertion failed: ' + error.message });
  }
});

// Update an existing run
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { status, ended_at, cost, tokens, logs, output_path, output_preview, fix_attempts } = req.body;

  const fields = [];
  const values = [];

  if (status         !== undefined) { fields.push('status = ?');          values.push(status); }
  if (ended_at       !== undefined) { fields.push('ended_at = ?');         values.push(ended_at); }
  if (cost           !== undefined) { fields.push('cost = ?');             values.push(cost); }
  if (tokens         !== undefined) { fields.push('tokens = ?');           values.push(tokens); }
  if (logs           !== undefined) { fields.push('logs = ?');             values.push(typeof logs === 'string' ? logs : JSON.stringify(logs)); }
  if (output_path    !== undefined) { fields.push('output_path = ?');      values.push(output_path); }
  if (output_preview !== undefined) { fields.push('output_preview = ?');   values.push(output_preview); }
  if (fix_attempts   !== undefined) { fields.push('fix_attempts = ?');     values.push(fix_attempts); }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  values.push(id);
  const update = db.prepare(`UPDATE runs SET ${fields.join(', ')} WHERE id = ?`);
  const result = update.run(...values);

  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(200).json({ message: 'Run updated successfully' });
});

module.exports = router;