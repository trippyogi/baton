'use strict';
const https = require('https');

const ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID
  ? (process.env.META_AD_ACCOUNT_ID.startsWith('act_')
      ? process.env.META_AD_ACCOUNT_ID
      : `act_${process.env.META_AD_ACCOUNT_ID}`)
  : 'act_YOUR_META_AD_ACCOUNT_ID';

const DAILY_BUDGET = 75;

function metaGet(path) {
  const token = process.env.META_GRAPH_TOKEN;
  if (!token) return Promise.reject(new Error('META_GRAPH_TOKEN not set — restart server with env sourced'));
  return new Promise((resolve, reject) => {
    const url = `https://graph.facebook.com/v18.0${path}&access_token=${token}`;
    https.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(body);
          if (d.error) reject(new Error(d.error.message));
          else resolve(d.data || d);
        } catch(e) { reject(new Error('Failed to parse Meta response')); }
      });
    }).on('error', reject);
  });
}

const express = require('express');
const router  = express.Router();

router.get('/', async (_req, res) => {
  try {
    const base = `/${ACCOUNT_ID}`;
    const [campaigns, spendToday, spend7d, dailyTrend] = await Promise.all([
      // Campaign budgets + status
      metaGet(`${base}/campaigns?fields=name,status,daily_budget&limit=50&`),
      // Today's spend per campaign
      metaGet(`${base}/insights?fields=campaign_name,spend&date_preset=today&level=campaign&limit=50&`),
      // 7d spend per campaign
      metaGet(`${base}/insights?fields=campaign_name,spend&date_preset=last_7d&level=campaign&limit=50&`),
      // Daily account spend for sparkline (last 7 days)
      metaGet(`${base}/insights?fields=spend&date_preset=last_7d&time_increment=1&level=account&limit=10&`),
    ]);

    // Index spend by campaign name
    const todayMap = {};
    for (const r of (spendToday || [])) todayMap[r.campaign_name] = parseFloat(r.spend || 0);
    const weekMap = {};
    for (const r of (spend7d || [])) weekMap[r.campaign_name] = parseFloat(r.spend || 0);

    // Merge into campaign objects
    const merged = (campaigns || []).map(c => ({
      id:           c.id,
      name:         c.name,
      status:       c.status,
      dailyBudget:  c.daily_budget ? parseFloat(c.daily_budget) / 100 : null, // Meta returns cents
      spendToday:   todayMap[c.name] || 0,
      spend7d:      weekMap[c.name]  || 0,
    }));

    // Total today spend
    const totalToday = merged.reduce((s, c) => s + c.spendToday, 0);
    const budgetPct  = Math.min(Math.round((totalToday / DAILY_BUDGET) * 100), 100);

    // Burn rate: project from hours elapsed today (UTC)
    const now          = new Date();
    const hoursElapsed = now.getUTCHours() + now.getUTCMinutes() / 60 || 0.5;
    const burnRate     = totalToday / hoursElapsed; // $/hr
    const hoursLeft    = burnRate > 0 ? (DAILY_BUDGET - totalToday) / burnRate : null;
    const exhaustAt    = hoursLeft !== null
      ? new Date(now.getTime() + hoursLeft * 3600 * 1000).toISOString()
      : null;

    // Daily trend array for sparkline
    const trend = (dailyTrend || []).map(r => ({
      date:  r.date_start,
      spend: parseFloat(r.spend || 0),
    }));

    res.json({
      totalToday:   Math.round(totalToday * 100) / 100,
      budgetPct,
      dailyBudget:  DAILY_BUDGET,
      burnRatePerHr: Math.round(burnRate * 100) / 100,
      exhaustAt,
      campaigns:    merged,
      trend,
    });

  } catch (err) {
    res.json({ error: true, message: err.message });
  }
});

module.exports = router;
