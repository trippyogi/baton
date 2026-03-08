'use strict';
const https   = require('https');
const express = require('express');
const router  = express.Router();

const ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID
  ? (process.env.META_AD_ACCOUNT_ID.startsWith('act_')
      ? process.env.META_AD_ACCOUNT_ID
      : `act_${process.env.META_AD_ACCOUNT_ID}`)
  : 'act_YOUR_META_AD_ACCOUNT_ID';

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

function getPurchases(actions) {
  if (!Array.isArray(actions)) return 0;
  const a = actions.find(x => x.action_type === 'purchase');
  return a ? parseFloat(a.value) : 0;
}

function getActionValue(action_values) {
  if (!Array.isArray(action_values)) return 0;
  const a = action_values.find(x => x.action_type === 'purchase');
  return a ? parseFloat(a.value) : 0;
}

function getRoas(purchase_roas) {
  if (!Array.isArray(purchase_roas) || !purchase_roas.length) return null;
  return parseFloat(purchase_roas[0].value);
}

router.get('/', async (_req, res) => {
  try {
    const fields = [
      'campaign_name', 'spend', 'purchase_roas', 'actions',
      'action_values', 'impressions', 'clicks', 'ctr', 'cpm',
    ].join(',');

    const rows = await metaGet(
      `/${ACCOUNT_ID}/insights?fields=${fields}&date_preset=last_7d&level=campaign&limit=50&`
    );

    const campaigns = (rows || []).map(r => {
      const spend       = parseFloat(r.spend || 0);
      const revenue     = getActionValue(r.action_values);
      const purchases   = getPurchases(r.actions);
      const roas        = getRoas(r.purchase_roas);
      const ctr         = r.ctr       != null ? parseFloat(r.ctr)         : null;
      const cpm         = r.cpm       != null ? parseFloat(r.cpm)         : null;
      const impressions = r.impressions != null ? parseInt(r.impressions)  : 0;
      const clicks      = r.clicks    != null ? parseInt(r.clicks)        : 0;
      return { name: r.campaign_name, spend, revenue, purchases, roas, ctr, cpm, impressions, clicks };
    });

    // Aggregate KPIs
    const totalSpend      = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalRevenue    = campaigns.reduce((s, c) => s + c.revenue, 0);
    const totalImpress    = campaigns.reduce((s, c) => s + c.impressions, 0);
    const totalClicks     = campaigns.reduce((s, c) => s + c.clicks, 0);
    const totalRoas       = totalSpend > 0 ? totalRevenue / totalSpend : null;
    const bestRoas        = campaigns.reduce((best, c) =>
      c.roas !== null && (best === null || c.roas > best) ? c.roas : best, null);
    const avgCtr          = totalImpress > 0 ? (totalClicks / totalImpress) * 100 : null;

    res.json({
      kpis: {
        totalRoas:   totalRoas  !== null ? Math.round(totalRoas * 100) / 100 : null,
        bestRoas:    bestRoas   !== null ? Math.round(bestRoas  * 100) / 100 : null,
        avgCtr:      avgCtr     !== null ? Math.round(avgCtr    * 100) / 100 : null,
        totalImpressions: totalImpress,
      },
      campaigns,
    });

  } catch (err) {
    res.json({ error: true, message: err.message });
  }
});

module.exports = router;
