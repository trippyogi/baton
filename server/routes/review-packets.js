'use strict';
const express = require('express');
const db = require('../db');
const { id, stringifyJson, parseJson } = require('../lib/flow/utils');
const { validateReviewPacket, normalizeList } = require('../lib/flow/quality');
const { rebuildTouches } = require('../lib/flow/rebuild');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    let sql = 'SELECT * FROM review_packets WHERE 1=1';
    const params = [];
    if (req.query.task_id) { sql += ' AND task_id = ?'; params.push(req.query.task_id); }
    if (req.query.packet_status) { sql += ' AND packet_status = ?'; params.push(req.query.packet_status); }
    sql += ' ORDER BY created_at DESC, rowid DESC LIMIT ?';
    params.push(Number(req.query.limit || 50));
    res.json(db.prepare(sql).all(...params).map(parsePacket));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const packet = {
      id: id('packet'),
      task_id: req.body.task_id || null,
      run_id: req.body.run_id || null,
      agent_id: req.body.agent_id || null,
      work_type: req.body.work_type || 'general',
      goal: req.body.goal || '',
      artifact_url: req.body.artifact_url || null,
      summary: req.body.summary || '',
      changes: normalizeText(req.body.changes ?? req.body.what_changed ?? ''),
      rationale: normalizeText(req.body.rationale ?? req.body.why_this_approach ?? ''),
      evidence: normalizeList(req.body.evidence),
      risks: normalizeList(req.body.risks),
      open_questions: normalizeList(req.body.open_questions),
      suggested_next_action: req.body.suggested_next_action || req.body.recommended_next_action || '',
      confidence_score: req.body.confidence_score,
      quality_score: req.body.quality_score,
    };
    const validation = validateReviewPacket(packet);

    if (packet.task_id) {
      const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(packet.task_id);
      if (!task) return res.status(400).json({ error: `unknown task_id: ${packet.task_id}` });
    }

    const writeTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO review_packets (
          id, task_id, run_id, agent_id, work_type, goal, artifact_url, summary, changes, rationale,
          evidence, risks, open_questions, suggested_next_action, confidence_score, quality_score,
          packet_status, validator_notes
        ) VALUES (
          @id, @task_id, @run_id, @agent_id, @work_type, @goal, @artifact_url, @summary, @changes, @rationale,
          @evidence, @risks, @open_questions, @suggested_next_action, @confidence_score, @quality_score,
          @packet_status, @validator_notes
        )
      `).run({
        ...packet,
        evidence: stringifyJson(packet.evidence),
        risks: stringifyJson(packet.risks),
        open_questions: stringifyJson(packet.open_questions),
        confidence_score: Number(packet.confidence_score ?? 0.7),
        quality_score: Number(packet.quality_score ?? 0.7),
        packet_status: validation.packet_status,
        validator_notes: validation.validator_notes,
      });

      if (packet.task_id) {
        db.prepare(`UPDATE tasks SET status = 'review', updated_at = datetime('now') WHERE id = ?`).run(packet.task_id);
      }
    });
    writeTx();

    const rebuild = rebuildTouches(db);
    const saved = parsePacket(db.prepare('SELECT * FROM review_packets WHERE id = ?').get(packet.id));
    const touch = packet.task_id
      ? db.prepare(`SELECT * FROM baton_touches WHERE review_packet_id = ? AND status NOT IN ('archived','resolved') ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(packet.id)
      : null;
    const reviewTouchId = validation.valid ? touch?.id || null : null;
    const refineTouchId = validation.valid ? null : touch?.id || null;

    res.status(201).json({
      packet: saved,
      valid: validation.valid,
      review_touch_id: reviewTouchId,
      refine_touch_id: refineTouchId,
      validator_notes: validation.validator_notes,
      rebuild,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function normalizeText(value) {
  return Array.isArray(value) ? value.map(String).join('\n') : String(value || '');
}

function parsePacket(row) {
  return {
    ...row,
    evidence: parseJson(row.evidence, []),
    risks: parseJson(row.risks, []),
    open_questions: parseJson(row.open_questions, []),
  };
}

module.exports = router;
