// ─── Analytics Background Worker ──────────────────────────────────────────────
//
// WHY A SEPARATE WORKER PROCESS?
//   The API server handles HTTP requests — it must be fast and responsive.
//   Analytics writes to Postgres are slow and non-urgent.
//   Running them in a separate process means: if analytics breaks, the API keeps running.
//
// HOW REDIS STREAMS WORK (vs Pub/Sub):
//   Pub/Sub: messages are lost if no one is listening (fire-and-forget)
//   Streams: messages are PERSISTED in Redis. Even if this worker is down for an hour,
//            when it comes back up it reads all missed events and processes them.
//
// XREADGROUP / Consumer Groups:
//   If you run multiple worker instances, each event is processed by ONLY ONE worker.
//   Redis distributes events across the consumer group.
//   This is called "competing consumers" pattern.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const redis    = require('../config/redis');
const UrlModel = require('../models/url.model');

const STREAM_KEY      = 'stream:clicks';
const GROUP_NAME      = 'analytics-workers';
const CONSUMER_NAME   = `worker-${process.pid}`; // Unique name per process
const BATCH_SIZE      = 100;  // Read up to 100 events per cycle
const FLUSH_INTERVAL  = parseInt(process.env.ANALYTICS_FLUSH_INTERVAL_MS) || 60000;

// ── Setup: Create the consumer group if it doesn't exist ──────────────────────
async function setupConsumerGroup() {
  try {
    // MKSTREAM: create the stream if it doesn't exist yet
    // '$' means: start reading only NEW messages (0 means read from beginning)
    await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '$', 'MKSTREAM');
    console.log(`✅ Consumer group '${GROUP_NAME}' created`);
  } catch (err) {
    // BUSYGROUP error means the group already exists — that's fine
    if (!err.message.includes('BUSYGROUP')) {
      throw err;
    }
    console.log(`ℹ️  Consumer group '${GROUP_NAME}' already exists`);
  }
}

// ── Main processing loop ───────────────────────────────────────────────────────
async function processClickEvents() {
  try {
    // XREADGROUP: read up to BATCH_SIZE messages not yet acknowledged
    // '>' means: give me new, undelivered messages (not previously pending ones)
    const results = await redis.xreadgroup(
      'GROUP', GROUP_NAME, CONSUMER_NAME,
      'COUNT', BATCH_SIZE,
      'BLOCK', 0,         // 0 = block until messages arrive (efficient, no polling)
      'STREAMS', STREAM_KEY, '>'
    );

    if (!results) return; // No messages (shouldn't happen with BLOCK 0)

    const [, messages] = results[0]; // results = [[streamKey, messages]]

    // Group click events by short_code to batch the DB writes
    // Instead of: 100 individual INSERTs
    // We do:      batch INSERT for all 100 clicks at once
    const clickEvents = messages.map(([id, fields]) => {
      // Fields come as flat array: ['short_code', 'abc', 'ip_hash', '...', ...]
      const obj = {};
      for (let i = 0; i < fields.length; i += 2) {
        obj[fields[i]] = fields[i + 1];
      }
      return { streamId: id, ...obj };
    });

    // Insert all click events in one DB call
    for (const event of clickEvents) {
      await UrlModel.recordClick({
        shortCode: event.short_code,
        ipHash:    event.ip_hash    || null,
        userAgent: event.user_agent || null,
        country:   event.country    || null,
        referer:   event.referer    || null,
      });
    }

    // XACK: acknowledge all processed messages so Redis removes them from the pending list
    // If we crash BEFORE acking, Redis will re-deliver them to another worker on restart
    const messageIds = messages.map(([id]) => id);
    await redis.xack(STREAM_KEY, GROUP_NAME, ...messageIds);

    console.log(`📊 Processed ${clickEvents.length} click events`);

  } catch (err) {
    console.error('Worker error:', err.message);
    // Wait 5 seconds before retrying to avoid hammering on persistent errors
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🚀 Analytics worker started (PID: ${process.pid})`);
  await setupConsumerGroup();

  // Continuous loop — processes events as they arrive
  while (true) {
    await processClickEvents();
  }
}

main().catch((err) => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
