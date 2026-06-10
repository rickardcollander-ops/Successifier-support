/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let val = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        val += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(val);
      val = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(val);
      rows.push(row);
      row = [];
      val = '';
      continue;
    }

    val += ch;
  }

  if (val.length || row.length) {
    row.push(val);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => String(c || '').trim()));
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function first(...vals) {
  for (const v of vals) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

function decodeHtml(str) {
  return String(str || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(str) {
  return decodeHtml(str).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function valueFromTag(block, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = block.match(re);
  return m ? stripHtml(m[1]) : '';
}

function valuesFromTag(block, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    out.push(stripHtml(m[1]));
  }
  return out.filter(Boolean);
}

function mapPriority(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'urgent' || v === 'high') return 'high';
  if (v === 'low') return 'low';
  return 'normal';
}

function mapStatus(value) {
  const v = String(value || '').toLowerCase();
  if (['new', 'open', 'pending', 'hold', 'solved', 'closed'].includes(v)) return v;
  return 'new';
}

async function flushBatch(batch) {
  if (!batch.length) return;
  await prisma.ticket.createMany({ data: batch });
  batch.length = 0;
}

function getUsersMap(usersXmlPath) {
  const users = new Map();
  if (!usersXmlPath || !fs.existsSync(usersXmlPath)) return users;

  const xml = fs.readFileSync(usersXmlPath, 'utf8');
  const userRe = /<user>([\s\S]*?)<\/user>/gi;
  let m;
  while ((m = userRe.exec(xml)) !== null) {
    const block = m[1];
    const id = valueFromTag(block, 'id');
    if (!id) continue;
    users.set(id, {
      name: valueFromTag(block, 'name'),
      email: valueFromTag(block, 'email').toLowerCase(),
    });
  }
  return users;
}

async function importCsv({ csvPath, tenantId, batch }) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) return 0;

  const headers = rows[0].map(norm);
  const idx = (needle) => headers.findIndex((h) => h.includes(needle));

  const col = {
    id: idx('id'),
    requester: idx('requester'),
    requesterEmail: idx('requester email'),
    subject: idx('subject'),
    tags: idx('tags'),
    status: idx('status'),
    priority: idx('priority'),
    createdAt: idx('created at'),
    updatedAt: idx('updated at'),
    via: idx('via'),
  };

  let inserted = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const externalId = first(r[col.id], `row-${i + 1}`);
    const email = first(r[col.requesterEmail], `unknown+csv-${externalId}@imported.local`).toLowerCase();
    const name = first(r[col.requester], email.split('@')[0], 'Unknown Customer');
    const subject = first(r[col.subject], `Zendesk CSV Ticket ${externalId}`);

    const message = [
      `[Zendesk Import Source: CSV ticket #${externalId}]`,
      `Requester: ${name} <${email}>`,
      `Via: ${first(r[col.via], 'unknown')}`,
      `Status: ${first(r[col.status], 'new')}`,
      `Priority: ${first(r[col.priority], 'normal')}`,
      `Created: ${first(r[col.createdAt], 'unknown')}`,
      `Updated: ${first(r[col.updatedAt], 'unknown')}`,
      `Tags: ${first(r[col.tags], '-')}`,
    ].join('\n');

    batch.push({
      tenantId,
      customerEmail: email,
      customerName: name,
      subject,
      status: mapStatus(r[col.status]),
      priority: mapPriority(r[col.priority]),
      originalMessage: message,
    });

    inserted += 1;

    if (batch.length >= 500) {
      await flushBatch(batch);
    }
  }

  return inserted;
}

async function importXml({ xmlPath, usersXmlPath, tenantId, batch }) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const users = getUsersMap(usersXmlPath);

  const ticketRe = /<ticket>([\s\S]*?)<\/ticket>/gi;
  let m;
  let inserted = 0;
  let processed = 0;

  while ((m = ticketRe.exec(xml)) !== null) {
    processed += 1;
    const block = m[1];

    const id = valueFromTag(block, 'id');
    if (!id) continue;

    const requesterId = valueFromTag(block, 'requester-id');
    const requester = users.get(requesterId) || {};

    const email = first(requester.email, `unknown+xml-${id}@imported.local`).toLowerCase();
    const name = first(requester.name, email.split('@')[0], 'Unknown Customer');
    const subject = first(valueFromTag(block, 'subject'), `Zendesk XML Ticket ${id}`);
    const status = mapStatus(valueFromTag(block, 'status'));
    const priority = mapPriority(valueFromTag(block, 'priority'));

    const comments = valuesFromTag(block, 'value').slice(0, 8);
    const description = first(valueFromTag(block, 'description'), '-');

    const message = [
      `[Zendesk Import Source: XML ticket #${id}]`,
      `Requester: ${name} <${email}>`,
      `Created: ${first(valueFromTag(block, 'created-at'), 'unknown')}`,
      `Updated: ${first(valueFromTag(block, 'updated-at'), 'unknown')}`,
      `Status: ${status}`,
      `Priority: ${priority}`,
      `Description: ${description}`,
      comments.length ? `Conversation:\n- ${comments.join('\n- ')}` : 'Conversation: -',
    ]
      .join('\n')
      .slice(0, 15000);

    batch.push({
      tenantId,
      customerEmail: email,
      customerName: name,
      subject,
      status,
      priority,
      originalMessage: message,
    });

    inserted += 1;

    if (batch.length >= 500) {
      await flushBatch(batch);
    }

    if (processed % 1000 === 0) {
      console.log(`XML processed: ${processed}`);
    }
  }

  return inserted;
}

async function main() {
  const args = parseArgs(process.argv);

  const tenantSubdomain = args.tenant || 'doldadress';
  const csvPath = args.csv;
  const xmlPath = args.xml;
  const usersXmlPath = args.usersXml || (xmlPath ? path.join(path.dirname(xmlPath), 'users.xml') : '');

  if (!csvPath || !xmlPath) {
    console.error('Usage: node scripts/import-zendesk-exports.js --tenant doldadress --csv <csv-path> --xml <tickets.xml-path> [--usersXml <users.xml-path>]');
    process.exit(1);
  }

  if (!fs.existsSync(csvPath) || !fs.existsSync(xmlPath)) {
    console.error('Input files not found.');
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { subdomain: tenantSubdomain } });
  if (!tenant) {
    console.error(`Tenant not found for subdomain: ${tenantSubdomain}`);
    process.exit(1);
  }

  console.log(`Tenant: ${tenantSubdomain} (${tenant.id})`);
  console.log('Removing previous Zendesk import rows for this tenant...');

  const deleted = await prisma.ticket.deleteMany({
    where: {
      tenantId: tenant.id,
      originalMessage: { contains: '[Zendesk Import Source:' },
    },
  });

  console.log(`Deleted old imported rows: ${deleted.count}`);

  const batch = [];

  console.log('Importing CSV...');
  const csvInserted = await importCsv({ csvPath, tenantId: tenant.id, batch });

  console.log('Importing XML...');
  const xmlInserted = await importXml({
    xmlPath,
    usersXmlPath,
    tenantId: tenant.id,
    batch,
  });

  await flushBatch(batch);

  const total = await prisma.ticket.count({ where: { tenantId: tenant.id } });

  console.log('\nImport complete.');
  console.log(
    JSON.stringify(
      {
        deletedPreviousImported: deleted.count,
        csvInserted,
        xmlInserted,
        totalTenantTicketsAfterImport: total,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
