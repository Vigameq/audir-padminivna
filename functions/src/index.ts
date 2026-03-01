/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import * as functions from 'firebase-functions/v1';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type AuthPayload = {
  sub: string;
  tenant_id: number;
  role: string;
};

type AuthedRequest = Request & { user?: AuthPayload };

const app = express();
const router = express.Router();

const config = (() => {
  try {
    return functions.config().app ?? {};
  } catch {
    return {};
  }
})();

const env = {
  dbHost: process.env.DB_HOST ?? config.db_host ?? "",
  dbPort: process.env.DB_PORT ?? config.db_port ?? "",
  dbName: process.env.DB_NAME ?? config.db_name ?? "",
  dbUser: process.env.DB_USER ?? config.db_user ?? "",
  dbPassword: process.env.DB_PASSWORD ?? config.db_password ?? "",
  dbSslMode: process.env.DB_SSLMODE ?? config.db_sslmode ?? "require",
  dbSchema: process.env.DB_SCHEMA ?? config.db_schema ?? "auditx",
  jwtSecret: process.env.JWT_SECRET ?? config.jwt_secret ?? "",
  accessTokenExpireMinutes:
    process.env.ACCESS_TOKEN_EXPIRE_MINUTES ?? config.access_token_expire_minutes ?? "60",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? config.frontend_origin ?? "*",
  disableAuditCreate: process.env.DISABLE_AUDIT_CREATE ?? config.disable_audit_create ?? "false",
  smtpHost: process.env.SMTP_HOST ?? config.smtp_host ?? "",
  smtpPort: process.env.SMTP_PORT ?? config.smtp_port ?? "587",
  smtpUser: process.env.SMTP_USER ?? config.smtp_user ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? config.smtp_password ?? "",
  smtpFrom: process.env.SMTP_FROM ?? config.smtp_from ?? "no-reply@auditx.local",
  smtpSecure: process.env.SMTP_SECURE ?? config.smtp_secure ?? "false",
};

app.use(cors({ origin: env.frontendOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

const pool = new Pool({
  host: env.dbHost,
  port: env.dbPort ? Number(env.dbPort) : undefined,
  database: env.dbName,
  user: env.dbUser,
  password: env.dbPassword,
  ssl: env.dbSslMode === "require" ? { rejectUnauthorized: false } : undefined,
  options: `-c search_path=${env.dbSchema}`,
});

const spacesBucket = String(functions.config().app?.spaces_bucket ?? '');
const spacesRegion = String(functions.config().app?.spaces_region ?? '');
const spacesAccessKey = String(functions.config().app?.spaces_key ?? '');
const spacesSecretKey = String(functions.config().app?.spaces_secret ?? '');
const spacesPublicBase = String(functions.config().app?.spaces_public_base ?? '');

const spacesClient =
  spacesBucket && spacesRegion && spacesAccessKey && spacesSecretKey
    ? new S3Client({
        region: spacesRegion,
        endpoint: `https://${spacesRegion}.digitaloceanspaces.com`,
        credentials: {
          accessKeyId: spacesAccessKey,
          secretAccessKey: spacesSecretKey,
        },
      })
    : null;

const buildAssetFolder = (auditCode: string, assetNumber: number) =>
  `${auditCode}/${String(assetNumber).padStart(2, '0')}`;

const ensureFolderMarkers = async (auditCode: string, assetNumber: number) => {
  if (!spacesClient || !spacesBucket) {
    return;
  }
  const rootKey = `${auditCode}/`;
  const assetKey = `${buildAssetFolder(auditCode, assetNumber)}/`;
  const markers = [rootKey, assetKey];
  await Promise.all(
    markers.map((key) =>
      spacesClient.send(
        new PutObjectCommand({
          Bucket: spacesBucket,
          Key: key,
          Body: '',
          ContentType: 'application/x-directory',
          ACL: 'public-read',
        })
      )
    )
  );
};

const sanitizeFilename = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]+/g, '_');

const normalizeEvidenceKey = (raw: string): string => {
  const value = String(raw ?? '').trim();
  if (!value) {
    return '';
  }
  let key = value;
  if (key.startsWith('http://') || key.startsWith('https://')) {
    try {
      key = new URL(key).pathname;
    } catch {
      return '';
    }
  }
  key = key.split('?')[0].replace(/^\/+/, '');
  if (spacesBucket && key.startsWith(`${spacesBucket}/`)) {
    key = key.slice(spacesBucket.length + 1);
  }
  return decodeURIComponent(key);
};

const sanitizeFishbone = (raw: unknown) => {
  const payload =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    man: String(payload.man ?? '').trim(),
    machine: String(payload.machine ?? '').trim(),
    method: String(payload.method ?? '').trim(),
    material: String(payload.material ?? '').trim(),
    measurement: String(payload.measurement ?? '').trim(),
    environment: String(payload.environment ?? '').trim(),
  };
};

const sanitizeWhyWhy = (raw: unknown) => {
  if (!Array.isArray(raw)) {
    return ['', '', '', '', ''];
  }
  const next = ['', '', '', '', ''];
  raw.slice(0, 5).forEach((value, index) => {
    next[index] = String(value ?? '').trim();
  });
  return next;
};

const jwtSecret = env.jwtSecret;
const jwtExpiryMinutes = Number(env.accessTokenExpireMinutes);
const smtpPort = Number(env.smtpPort);
const smtpSecure = String(env.smtpSecure).toLowerCase() === 'true';

const mailTransporter =
  env.smtpHost && env.smtpUser && env.smtpPassword && Number.isFinite(smtpPort)
    ? nodemailer.createTransport({
        host: env.smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: env.smtpUser,
          pass: env.smtpPassword,
        },
      })
    : null;

const sendWelcomeEmail = async (payload: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  password?: string | null;
}) => {
  if (!mailTransporter) {
    return;
  }
  const fullName = [payload.firstName, payload.lastName].filter(Boolean).join(' ').trim();
  const displayName = fullName || payload.email;
  const lines = [
    `Hi ${displayName},`,
    '',
    'Welcome to Padmini Mechatronics - AuditX.',
    '',
    `Your account has been created with role: ${payload.role ?? 'User'}.`,
    `Login email: ${payload.email}`,
  ];
  if (payload.password) {
    lines.push(`Temporary password: ${payload.password}`);
  }
  lines.push('');
  lines.push('Please sign in and update your password if required.');

  await mailTransporter.sendMail({
    from: env.smtpFrom,
    to: payload.email,
    subject: 'Welcome to Padmini Mechatronics - AuditX',
    text: lines.join('\n'),
  });
};

const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return res.status(401).json({ detail: 'Missing token' });
  }
  try {
    const payload = jwt.verify(token, jwtSecret) as AuthPayload;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ detail: 'Invalid token' });
  }
};

const getCustomerEmail = async (req: AuthedRequest): Promise<string | null> => {
  if (req.user?.role !== 'Customer') {
    return null;
  }
  const userId = Number(req.user?.sub ?? 0);
  if (!userId) {
    return null;
  }
  const { rows } = await pool.query(
    'SELECT email FROM users WHERE id = $1 AND tenant_id = $2',
    [userId, req.user?.tenant_id]
  );
  return rows[0]?.email ? String(rows[0].email).toLowerCase() : null;
};

router.get('/health', (_req, res) => res.json({ ok: true }));

router.post('/auth/login', async (req, res) => {
  const username = String(req.body.username ?? req.body.email ?? '').toLowerCase();
  const password = String(req.body.password ?? '');
  if (!username || !password) {
    return res.status(400).json({ detail: 'Missing credentials' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [username]);
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ detail: 'Invalid login' });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ detail: 'Invalid login' });
  }
  const token = jwt.sign(
    { sub: String(user.id), tenant_id: user.tenant_id, role: user.role },
    jwtSecret,
    { expiresIn: `${jwtExpiryMinutes}m` }
  );
  await pool.query('UPDATE users SET last_active = NOW() WHERE id = $1', [user.id]);
  return res.json({ access_token: token, token_type: 'bearer' });
});

router.get('/users', requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, first_name, last_name, phone, department, role, status, last_active, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC',
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/users', requireAuth, async (req: AuthedRequest, res) => {
  const payload = req.body ?? {};
  const userEmail = String(payload.email ?? '').toLowerCase();
  const rawPassword = String(payload.password ?? '');
  const passwordHash = await bcrypt.hash(String(payload.password ?? ''), 10);
  const { rows } = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, phone, department, role, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id, email, first_name, last_name, phone, department, role, status, last_active, created_at`,
    [
      req.user?.tenant_id,
      userEmail,
      passwordHash,
      payload.first_name ?? null,
      payload.last_name ?? null,
      payload.phone ?? null,
      payload.department ?? null,
      payload.role ?? null,
      payload.status ?? null,
    ]
  );
  const result = rows[0];
  if (payload.response_is_negative && payload.status === 'Submitted') {
    await pool.query(
      `INSERT INTO nc_actions (tenant_id, audit_answer_id, status, created_at, updated_at)
       VALUES ($1, $2, 'Assigned', NOW(), NOW())
       ON CONFLICT (tenant_id, audit_answer_id) DO NOTHING`,
      [req.user?.tenant_id, result.id]
    );
  }
  try {
    await sendWelcomeEmail({
      email: userEmail,
      firstName: payload.first_name ?? null,
      lastName: payload.last_name ?? null,
      role: payload.role ?? null,
      password: rawPassword || null,
    });
  } catch (error) {
    functions.logger.error('Failed to send welcome email', {
      email: userEmail,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return res.status(201).json(result);
});

router.put('/users/:userId', requireAuth, async (req: AuthedRequest, res) => {
  const userId = Number(req.params.userId);
  const payload = req.body ?? {};
  const fields = [
    ['first_name', payload.first_name],
    ['last_name', payload.last_name],
    ['phone', payload.phone],
    ['department', payload.department],
    ['role', payload.role],
    ['status', payload.status],
  ].filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }
  const setClause = fields.map(([field], index) => `${field} = $${index + 2}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE users SET ${setClause}
     WHERE id = $1 AND tenant_id = $${fields.length + 2}
     RETURNING id, email, first_name, last_name, phone, department, role, status, last_active, created_at`,
    [userId, ...values, req.user?.tenant_id]
  );
  if (!rows[0]) {
    return res.status(404).json({ detail: 'User not found' });
  }
  return res.json(rows[0]);
});

router.post('/users/:userId/reset-password', requireAuth, async (req: AuthedRequest, res) => {
  const userId = Number(req.params.userId);
  const newPassword = String(req.body.new_password ?? '');
  if (!newPassword) {
    return res.status(400).json({ detail: 'Missing new password' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1
     WHERE id = $2 AND tenant_id = $3
     RETURNING id, email, first_name, last_name, phone, department, role, status, last_active, created_at`,
    [passwordHash, userId, req.user?.tenant_id]
  );
  if (!rows[0]) {
    return res.status(404).json({ detail: 'User not found' });
  }
  return res.json(rows[0]);
});

router.delete('/users/:userId', requireAuth, async (req: AuthedRequest, res) => {
  const userId = Number(req.params.userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE nc_actions SET assigned_user_id = NULL WHERE assigned_user_id = $1 AND tenant_id = $2',
      [userId, req.user?.tenant_id]
    );
    await client.query('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [
      userId,
      req.user?.tenant_id,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return res.status(204).send();
});

const simpleListCreateDelete = (table: string, column = 'name') => {
  router.get(`/${table}`, requireAuth, async (req: AuthedRequest, res) => {
    const { rows } = await pool.query(
      `SELECT id, ${column}, created_at FROM ${table} WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [req.user?.tenant_id]
    );
    return res.json(rows);
  });

  router.post(`/${table}`, requireAuth, async (req: AuthedRequest, res) => {
    const value = String(req.body?.[column] ?? req.body?.name ?? '');
    const { rows } = await pool.query(
      `INSERT INTO ${table} (tenant_id, ${column}, created_at) VALUES ($1, $2, NOW()) RETURNING id, ${column}, created_at`,
      [req.user?.tenant_id, value]
    );
    return res.status(201).json(rows[0]);
  });

  router.delete(`/${table}/:id`, requireAuth, async (req: AuthedRequest, res) => {
    const raw = req.params.id;
    const id = Number(raw);
    if (Number.isNaN(id)) {
      await pool.query(`DELETE FROM ${table} WHERE name = $1 AND tenant_id = $2`, [
        raw,
        req.user?.tenant_id,
      ]);
    } else {
      await pool.query(`DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2`, [
        id,
        req.user?.tenant_id,
      ]);
    }
    return res.status(204).send();
  });
};

simpleListCreateDelete('departments');
simpleListCreateDelete('sites');
simpleListCreateDelete('regions');

router.get('/response-types', requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, types, negative_types, created_at FROM response_types WHERE tenant_id = $1 ORDER BY created_at DESC',
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/response-types', requireAuth, async (req: AuthedRequest, res) => {
  const { name, types, negative_types } = req.body ?? {};
  const { rows } = await pool.query(
    'INSERT INTO response_types (tenant_id, name, types, negative_types, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, name, types, negative_types, created_at',
    [
      req.user?.tenant_id,
      name,
      JSON.stringify(types ?? []),
      JSON.stringify(negative_types ?? []),
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/response-types/:id', requireAuth, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid response type id' });
  }
  const { name, types, negative_types } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE response_types
     SET name = $1, types = $2, negative_types = $3
     WHERE id = $4 AND tenant_id = $5
     RETURNING id, name, types, negative_types, created_at`,
    [
      name,
      JSON.stringify(types ?? []),
      JSON.stringify(negative_types ?? []),
      id,
      req.user?.tenant_id,
    ]
  );
  if (!rows[0]) {
    return res.status(404).json({ detail: 'Response type not found' });
  }
  return res.json(rows[0]);
});

router.delete('/response-types/:id', requireAuth, async (req: AuthedRequest, res) => {
  const raw = req.params.id;
  const id = Number(raw);
  if (Number.isNaN(id)) {
    await pool.query('DELETE FROM response_types WHERE name = $1 AND tenant_id = $2', [
      raw,
      req.user?.tenant_id,
    ]);
  } else {
    await pool.query('DELETE FROM response_types WHERE id = $1 AND tenant_id = $2', [
      id,
      req.user?.tenant_id,
    ]);
  }
  return res.status(204).send();
});

router.get('/templates', requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, note, tags, questions, COALESCE(subsections, '[]'::jsonb) AS subsections, created_at
     FROM audit_templates
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/templates', requireAuth, async (req: AuthedRequest, res) => {
  const { name, note, tags, questions, subsections } = req.body ?? {};
  const { rows } = await pool.query(
    `INSERT INTO audit_templates (tenant_id, name, note, tags, questions, subsections, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, name, note, tags, questions, COALESCE(subsections, '[]'::jsonb) AS subsections, created_at`,
    [
      req.user?.tenant_id,
      name,
      note ?? null,
      JSON.stringify(tags ?? []),
      JSON.stringify(questions ?? []),
      JSON.stringify(subsections ?? []),
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/templates/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { name, note, tags, questions, subsections } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE audit_templates
     SET name = $1, note = $2, tags = $3, questions = $4, subsections = $5
     WHERE id = $6 AND tenant_id = $7
     RETURNING id, name, note, tags, questions, COALESCE(subsections, '[]'::jsonb) AS subsections, created_at`,
    [
      name,
      note ?? null,
      JSON.stringify(tags ?? []),
      JSON.stringify(questions ?? []),
      JSON.stringify(subsections ?? []),
      Number(req.params.id),
      req.user?.tenant_id,
    ]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Template not found' });
  }
  return res.json(rows[0]);
});

router.delete('/templates/:id', requireAuth, async (req: AuthedRequest, res) => {
  await pool.query('DELETE FROM audit_templates WHERE id = $1 AND tenant_id = $2', [
    Number(req.params.id),
    req.user?.tenant_id,
  ]);
  return res.status(204).send();
});

router.get('/audit-plans', requireAuth, async (req: AuthedRequest, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  const customerEmail = await getCustomerEmail(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const params = customerEmail
    ? [req.user?.tenant_id, customerEmail]
    : [req.user?.tenant_id];
  const whereClause = `WHERE tenant_id = $1 ${customerEmail ? 'AND customer_id = $2' : ''}`;
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM audit_plans ${whereClause}`,
    params
  );
  const totalCount = Number(countResult.rows[0]?.count ?? 0);
  const { rows } = await pool.query(
    `SELECT id, code, start_date, end_date, audit_type, audit_subtype, auditor_name, department, location_city, site, country, region, audit_note, response_type, asset_scope, customer_id, created_at, updated_at
     FROM audit_plans
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  res.set('X-Total-Count', String(totalCount));
  return res.json(rows);
});

const generateCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};

const generateComplaintCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `CMP-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
};

const generateChangeCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `CHG-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
};

const generateLessonCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `LSN-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
};

const generateInstrumentCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `INS-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
};

const generateSupplierCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `SUP-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
};

const generateMsaCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `MSA-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
};

const PPAP_LEVEL_OPTIONS = [
  'Level 1 (Warranty only)',
  'Level 2 (Warrant + Limited samples)',
  'Level 3 (Full PPAP package)',
  'Level 4 (Customer-specific requirements)',
  'Level 5 (On-site review)',
] as const;

const normalizePpapLevel = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return PPAP_LEVEL_OPTIONS[2];
  }
  if ((PPAP_LEVEL_OPTIONS as readonly string[]).includes(raw)) {
    return raw;
  }
  const match = raw.match(/^level\s*([1-5])$/i);
  if (match) {
    const index = Number(match[1]) - 1;
    return PPAP_LEVEL_OPTIONS[index] ?? null;
  }
  return null;
};

type ComplaintEscalationRule = {
  level: number;
  thresholdHours: number;
  notifyRole: string;
};

const defaultComplaintEscalationRules = (complaintType: string): ComplaintEscalationRule[] => {
  if (complaintType === 'Customer') {
    return [
      { level: 1, thresholdHours: 48, notifyRole: 'Manager' },
      { level: 2, thresholdHours: 72, notifyRole: 'Manager' },
      { level: 3, thresholdHours: 120, notifyRole: 'Manager' },
    ];
  }
  return [
    { level: 1, thresholdHours: 72, notifyRole: 'Manager' },
    { level: 2, thresholdHours: 120, notifyRole: 'Manager' },
    { level: 3, thresholdHours: 168, notifyRole: 'Manager' },
  ];
};

const pickComplaintBaselineDate = (complaintDate: string | null | undefined, createdAt?: string) => {
  if (complaintDate) {
    const parsed = new Date(complaintDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (createdAt) {
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
};

const calculateEscalationLevel = (elapsedHours: number, rules: ComplaintEscalationRule[]) => {
  if (!rules.length) {
    return 0;
  }
  return rules.reduce((level, rule) => (
    elapsedHours >= rule.thresholdHours ? Math.max(level, rule.level) : level
  ), 0);
};

const fetchComplaintEscalationRules = async (
  tenantId: number,
  complaintType: string,
  category: string
) => {
  const { rows } = await pool.query(
    `SELECT level, threshold_hours, notify_role
     FROM complaint_escalation_rules
     WHERE tenant_id = $1
       AND complaint_type = $2
       AND category = $3
     ORDER BY level ASC`,
    [tenantId, complaintType, category]
  );
  if (!rows.length) {
    return defaultComplaintEscalationRules(complaintType);
  }
  return rows
    .map((row) => ({
      level: Number(row.level),
      thresholdHours: Number(row.threshold_hours),
      notifyRole: String(row.notify_role ?? 'Manager'),
    }))
    .filter((rule) => Number.isFinite(rule.level) && Number.isFinite(rule.thresholdHours) && rule.thresholdHours > 0);
};

const logComplaintEvent = async (payload: {
  tenantId: number;
  complaintId: number;
  eventType: string;
  message?: string;
  oldData?: unknown;
  newData?: unknown;
  createdBy?: number | null;
}) => {
  await pool.query(
    `INSERT INTO complaint_events
      (tenant_id, complaint_id, event_type, message, old_data, new_data, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW())`,
    [
      payload.tenantId,
      payload.complaintId,
      payload.eventType,
      payload.message ?? null,
      payload.oldData ? JSON.stringify(payload.oldData) : null,
      payload.newData ? JSON.stringify(payload.newData) : null,
      payload.createdBy ?? null,
    ]
  );
};

const logLessonEvent = async (payload: {
  tenantId: number;
  lessonId: number;
  eventType: string;
  message?: string;
  oldData?: unknown;
  newData?: unknown;
  createdBy?: number | null;
}) => {
  try {
    await pool.query(
      `INSERT INTO lesson_events
        (tenant_id, lesson_id, event_type, message, old_data, new_data, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW())`,
      [
        payload.tenantId,
        payload.lessonId,
        payload.eventType,
        payload.message ?? null,
        payload.oldData ? JSON.stringify(payload.oldData) : null,
        payload.newData ? JSON.stringify(payload.newData) : null,
        payload.createdBy ?? null,
      ]
    );
  } catch (error) {
    functions.logger.warn('Failed to write lesson event log', {
      lessonId: payload.lessonId,
      tenantId: payload.tenantId,
      eventType: payload.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const normalizeTags = (raw: unknown) => {
  if (!Array.isArray(raw)) {
    return [] as string[];
  }
  return raw
    .map((tag) => String(tag ?? '').trim())
    .filter((tag) => !!tag)
    .slice(0, 20);
};

const getEscalationRecipients = async (payload: {
  tenantId: number;
  notifyRole?: string;
  assignedTo?: string;
}) => {
  const role = String(payload.notifyRole ?? 'Manager').trim();
  const { rows } = await pool.query(
    `SELECT email
     FROM users
     WHERE tenant_id = $1
       AND status = 'Active'
       AND role = $2`,
    [payload.tenantId, role]
  );
  const emails = new Set<string>();
  rows.forEach((row) => {
    const email = String(row.email ?? '').trim().toLowerCase();
    if (email) {
      emails.add(email);
    }
  });
  const assigned = String(payload.assignedTo ?? '').trim().toLowerCase();
  if (assigned.includes('@')) {
    emails.add(assigned);
  }
  return Array.from(emails);
};

const sendComplaintEscalationEmail = async (payload: {
  to: string[];
  code: string;
  title: string;
  complaintType: string;
  category: string;
  status: string;
  escalationLevel: number;
  overdueHours: number;
}) => {
  if (!mailTransporter || !payload.to.length) {
    return;
  }
  const lines = [
    `Complaint ${payload.code} has escalated to Level ${payload.escalationLevel}.`,
    '',
    `Title: ${payload.title}`,
    `Type/Category: ${payload.complaintType} / ${payload.category}`,
    `Current status: ${payload.status}`,
    `Overdue by: ${Math.max(payload.overdueHours, 0)} hour(s)`,
    '',
    'Please review and close as soon as possible.',
  ];
  await mailTransporter.sendMail({
    from: env.smtpFrom,
    to: payload.to.join(','),
    subject: `[AuditX] Complaint escalation L${payload.escalationLevel} - ${payload.code}`,
    text: lines.join('\n'),
  });
};

const evaluateComplaintEscalations = async (tenantId?: number) => {
  const params: unknown[] = [];
  let whereClause = `WHERE status <> 'Closed'`;
  if (tenantId) {
    whereClause += ` AND tenant_id = $1`;
    params.push(tenantId);
  }
  const { rows } = await pool.query(
    `SELECT id, tenant_id, code, complaint_type, category, title, complaint_date, created_at,
            status, assigned_to, target_close_at, escalation_level, escalation_status, closed_at
     FROM complaints
     ${whereClause}
     ORDER BY created_at ASC`,
    params
  );
  let escalatedCount = 0;
  const now = new Date();
  for (const complaint of rows) {
    const currentTenantId = Number(complaint.tenant_id);
    const complaintId = Number(complaint.id);
    if (!currentTenantId || !complaintId) {
      continue;
    }
    const complaintType = String(complaint.complaint_type ?? 'Internal');
    const category = String(complaint.category ?? 'Inprocess');
    const rules = await fetchComplaintEscalationRules(currentTenantId, complaintType, category);
    if (!rules.length) {
      continue;
    }
    const baseline = pickComplaintBaselineDate(
      complaint.complaint_date ? String(complaint.complaint_date) : null,
      complaint.created_at ? String(complaint.created_at) : undefined
    );
    const elapsedHours = Math.max(0, Math.floor((now.getTime() - baseline.getTime()) / (1000 * 60 * 60)));
    const nextLevel = calculateEscalationLevel(elapsedHours, rules);
    const currentLevel = Number(complaint.escalation_level ?? 0);
    const targetHours = Math.min(...rules.map((rule) => rule.thresholdHours));
    const targetCloseAt = new Date(baseline.getTime() + targetHours * 60 * 60 * 1000);
    if (!complaint.target_close_at) {
      await pool.query(
        `UPDATE complaints
         SET target_close_at = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [targetCloseAt.toISOString(), complaintId, currentTenantId]
      );
    }
    if (nextLevel <= currentLevel) {
      continue;
    }
    const matchedRule =
      rules.find((rule) => rule.level === nextLevel) ??
      rules[rules.length - 1];
    const escalationStatus = nextLevel >= rules[rules.length - 1].level ? 'Final' : 'Escalated';
    await pool.query(
      `UPDATE complaints
       SET escalation_level = $1,
           escalation_status = $2,
           escalation_owner = $3,
           last_escalated_at = NOW(),
           updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5`,
      [nextLevel, escalationStatus, matchedRule.notifyRole, complaintId, currentTenantId]
    );
    await logComplaintEvent({
      tenantId: currentTenantId,
      complaintId,
      eventType: 'Escalated',
      message: `Escalated to level ${nextLevel} (${matchedRule.notifyRole})`,
      oldData: { escalation_level: currentLevel },
      newData: { escalation_level: nextLevel, escalation_status: escalationStatus, escalation_owner: matchedRule.notifyRole },
      createdBy: null,
    });
    try {
      const recipients = await getEscalationRecipients({
        tenantId: currentTenantId,
        notifyRole: matchedRule.notifyRole,
        assignedTo: complaint.assigned_to ? String(complaint.assigned_to) : '',
      });
      await sendComplaintEscalationEmail({
        to: recipients,
        code: String(complaint.code ?? ''),
        title: String(complaint.title ?? ''),
        complaintType,
        category,
        status: String(complaint.status ?? 'Open'),
        escalationLevel: nextLevel,
        overdueHours: Math.max(0, elapsedHours - matchedRule.thresholdHours),
      });
    } catch (error) {
      functions.logger.error('Failed to send complaint escalation email', {
        complaintId,
        tenantId: currentTenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    escalatedCount += 1;
  }
  return { scanned: rows.length, escalated: escalatedCount };
};

router.get('/complaints', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const { rows } = await pool.query(
    `SELECT id, code, complaint_type, category, title, description, source_name, reported_by,
            complaint_date, status, assigned_to, resolution, target_close_at, escalation_level,
            escalation_status, last_escalated_at, escalation_owner, closed_at, created_at, updated_at
     FROM complaints
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/complaints', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const complaintType = String(payload.complaint_type ?? '').trim();
  const category = String(payload.category ?? '').trim();
  const title = String(payload.title ?? '').trim();
  if (!title) {
    return res.status(400).json({ detail: 'Title is required' });
  }
  if (!['Customer', 'Internal'].includes(complaintType)) {
    return res.status(400).json({ detail: 'Invalid complaint_type' });
  }
  if (!['Inprocess', 'Supplier'].includes(category)) {
    return res.status(400).json({ detail: 'Invalid category' });
  }

  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateComplaintCode();
    const exists = await pool.query(
      'SELECT 1 FROM complaints WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [req.user?.tenant_id, code]
    );
    if (!exists.rows.length) {
      break;
    }
    code = '';
  }
  if (!code) {
    return res.status(500).json({ detail: 'Unable to generate complaint code' });
  }

  const tenantId = Number(req.user?.tenant_id ?? 0);
  const rules = await fetchComplaintEscalationRules(tenantId, complaintType, category);
  const baseline = pickComplaintBaselineDate(payload.complaint_date ?? null);
  const firstThreshold = rules.length
    ? Math.min(...rules.map((rule) => rule.thresholdHours))
    : 48;
  const targetCloseAt = new Date(baseline.getTime() + firstThreshold * 60 * 60 * 1000);

  const { rows } = await pool.query(
    `INSERT INTO complaints
      (tenant_id, code, complaint_type, category, title, description, source_name, reported_by,
       complaint_date, status, assigned_to, resolution, target_close_at, escalation_level,
       escalation_status, escalation_owner, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Open', $10, NULL, $11, 0, 'None', NULL, $12, NOW(), NOW())
     RETURNING id, code, complaint_type, category, title, description, source_name, reported_by,
               complaint_date, status, assigned_to, resolution, target_close_at, escalation_level,
               escalation_status, last_escalated_at, escalation_owner, closed_at, created_at, updated_at`,
    [
      tenantId,
      code,
      complaintType,
      category,
      title,
      payload.description ?? null,
      payload.source_name ?? null,
      payload.reported_by ?? null,
      payload.complaint_date ?? null,
      payload.assigned_to ?? null,
      targetCloseAt.toISOString(),
      Number(req.user?.sub ?? 0) || null,
    ]
  );
  await logComplaintEvent({
    tenantId,
    complaintId: Number(rows[0]?.id ?? 0),
    eventType: 'Created',
    message: `Complaint ${code} created`,
    newData: rows[0],
    createdBy: Number(req.user?.sub ?? 0) || null,
  });
  await evaluateComplaintEscalations(tenantId);
  return res.status(201).json(rows[0]);
});

router.put('/complaints/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid complaint id' });
  }
  const payload = req.body ?? {};
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const currentQuery = await pool.query(
    `SELECT id, code, complaint_type, category, title, description, source_name, reported_by,
            complaint_date, status, assigned_to, resolution, target_close_at, escalation_level,
            escalation_status, last_escalated_at, escalation_owner, closed_at, created_at, updated_at
     FROM complaints
     WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  const current = currentQuery.rows[0];
  if (!current) {
    return res.status(404).json({ detail: 'Complaint not found' });
  }
  const fields = ([
    ['complaint_type', payload.complaint_type],
    ['category', payload.category],
    ['title', payload.title],
    ['description', payload.description],
    ['source_name', payload.source_name],
    ['reported_by', payload.reported_by],
    ['complaint_date', payload.complaint_date],
    ['status', payload.status],
    ['assigned_to', payload.assigned_to],
    ['resolution', payload.resolution],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }

  const complaintType = fields.find(([field]) => field === 'complaint_type')?.[1];
  const category = fields.find(([field]) => field === 'category')?.[1];
  const status = fields.find(([field]) => field === 'status')?.[1];
  if (complaintType !== undefined && !['Customer', 'Internal'].includes(String(complaintType))) {
    return res.status(400).json({ detail: 'Invalid complaint_type' });
  }
  if (category !== undefined && !['Inprocess', 'Supplier'].includes(String(category))) {
    return res.status(400).json({ detail: 'Invalid category' });
  }
  if (status !== undefined && !['Open', 'In Progress', 'Closed'].includes(String(status))) {
    return res.status(400).json({ detail: 'Invalid status' });
  }

  const normalizedStatus = status !== undefined ? String(status) : String(current.status ?? 'Open');
  if (status !== undefined) {
    fields.push(['closed_at', normalizedStatus === 'Closed' ? new Date().toISOString() : null]);
    if (normalizedStatus === 'Closed') {
      fields.push(['escalation_status', 'Closed']);
    } else if (String(current.escalation_status ?? '') === 'Closed') {
      fields.push(['escalation_status', 'None']);
    }
  }
  const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE complaints
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, code, complaint_type, category, title, description, source_name, reported_by,
               complaint_date, status, assigned_to, resolution, target_close_at, escalation_level,
               escalation_status, last_escalated_at, escalation_owner, closed_at, created_at, updated_at`,
    [...values, id, tenantId]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Complaint not found' });
  }
  const updated = rows[0];
  await logComplaintEvent({
    tenantId,
    complaintId: id,
    eventType: 'Updated',
    message: `Complaint ${current.code ?? ''} updated`,
    oldData: current,
    newData: updated,
    createdBy: Number(req.user?.sub ?? 0) || null,
  });
  if (String(updated.status ?? '') !== 'Closed') {
    await evaluateComplaintEscalations(tenantId);
  }
  return res.json(updated);
});

router.post('/complaints/escalations/run', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const role = String(req.user?.role ?? '').trim().toLowerCase();
  if (role !== 'manager' && role !== 'admin') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const result = await evaluateComplaintEscalations(tenantId);
  return res.json({ detail: 'Escalation run complete', ...result });
});

router.get('/complaints/escalation-rules', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const { rows } = await pool.query(
    `SELECT id, complaint_type, category, level, threshold_hours, notify_role, created_at, updated_at
     FROM complaint_escalation_rules
     WHERE tenant_id = $1
     ORDER BY complaint_type ASC, category ASC, level ASC`,
    [tenantId]
  );
  return res.json(rows);
});

router.put('/complaints/escalation-rules/:id', requireAuth, async (req: AuthedRequest, res) => {
  const role = String(req.user?.role ?? '').trim().toLowerCase();
  if (role !== 'super admin' && role !== 'admin') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const ruleId = Number(req.params.id);
  if (!ruleId) {
    return res.status(400).json({ detail: 'Invalid rule id' });
  }
  const payload = req.body ?? {};
  const thresholdHours = Number(payload.threshold_hours);
  const notifyRole = String(payload.notify_role ?? '').trim();
  if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
    return res.status(400).json({ detail: 'Invalid threshold_hours' });
  }
  if (!notifyRole) {
    return res.status(400).json({ detail: 'notify_role is required' });
  }
  const allowedRoles = new Set(['Super Admin', 'Admin', 'Manager', 'Auditor']);
  if (!allowedRoles.has(notifyRole)) {
    return res.status(400).json({ detail: 'Invalid notify_role' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const { rows } = await pool.query(
    `UPDATE complaint_escalation_rules
     SET threshold_hours = $1,
         notify_role = $2,
         updated_at = NOW()
     WHERE id = $3 AND tenant_id = $4
     RETURNING id, complaint_type, category, level, threshold_hours, notify_role, created_at, updated_at`,
    [Math.floor(thresholdHours), notifyRole, ruleId, tenantId]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Rule not found' });
  }
  return res.json(rows[0]);
});

router.get('/changes', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const { rows } = await pool.query(
    `SELECT id, code, request_type, title, description, four_m_category, change_reason,
            impact_assessment, risk_level, status, requested_by, requested_date, target_date,
            approved_by, approved_at, implemented_at, created_at, updated_at
     FROM change_requests
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/changes', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const requestType = String(payload.request_type ?? '').trim();
  const fourMCategory = String(payload.four_m_category ?? '').trim();
  const title = String(payload.title ?? '').trim();
  if (!title) {
    return res.status(400).json({ detail: 'Title is required' });
  }
  if (!['ECR', 'ECN'].includes(requestType)) {
    return res.status(400).json({ detail: 'Invalid request_type' });
  }
  if (!['Man', 'Machine', 'Method', 'Material'].includes(fourMCategory)) {
    return res.status(400).json({ detail: 'Invalid four_m_category' });
  }
  const riskLevel = String(payload.risk_level ?? 'Medium').trim();
  const status = String(payload.status ?? 'Open').trim();
  if (!['Low', 'Medium', 'High', 'Critical'].includes(riskLevel)) {
    return res.status(400).json({ detail: 'Invalid risk_level' });
  }
  if (!['Draft', 'Open', 'In Review', 'Approved', 'Implemented', 'Rejected', 'Closed'].includes(status)) {
    return res.status(400).json({ detail: 'Invalid status' });
  }

  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateChangeCode();
    const exists = await pool.query(
      'SELECT 1 FROM change_requests WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [req.user?.tenant_id, code]
    );
    if (!exists.rows.length) {
      break;
    }
    code = '';
  }
  if (!code) {
    return res.status(500).json({ detail: 'Unable to generate change code' });
  }

  const approvedAt = status === 'Approved' ? new Date().toISOString() : null;
  const implementedAt = status === 'Implemented' ? new Date().toISOString() : null;
  const { rows } = await pool.query(
    `INSERT INTO change_requests
      (tenant_id, code, request_type, title, description, four_m_category, change_reason,
       impact_assessment, risk_level, status, requested_by, requested_date, target_date,
       approved_by, approved_at, implemented_at, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
     RETURNING id, code, request_type, title, description, four_m_category, change_reason,
               impact_assessment, risk_level, status, requested_by, requested_date, target_date,
               approved_by, approved_at, implemented_at, created_at, updated_at`,
    [
      req.user?.tenant_id,
      code,
      requestType,
      title,
      payload.description ?? null,
      fourMCategory,
      payload.change_reason ?? null,
      payload.impact_assessment ?? null,
      riskLevel,
      status,
      payload.requested_by ?? null,
      payload.requested_date ?? null,
      payload.target_date ?? null,
      payload.approved_by ?? null,
      approvedAt,
      implementedAt,
      Number(req.user?.sub ?? 0) || null,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/changes/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid change id' });
  }
  const payload = req.body ?? {};
  const fields = ([
    ['request_type', payload.request_type],
    ['title', payload.title],
    ['description', payload.description],
    ['four_m_category', payload.four_m_category],
    ['change_reason', payload.change_reason],
    ['impact_assessment', payload.impact_assessment],
    ['risk_level', payload.risk_level],
    ['status', payload.status],
    ['requested_by', payload.requested_by],
    ['requested_date', payload.requested_date],
    ['target_date', payload.target_date],
    ['approved_by', payload.approved_by],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }

  const requestType = fields.find(([field]) => field === 'request_type')?.[1];
  const fourMCategory = fields.find(([field]) => field === 'four_m_category')?.[1];
  const riskLevel = fields.find(([field]) => field === 'risk_level')?.[1];
  const status = fields.find(([field]) => field === 'status')?.[1];
  if (requestType !== undefined && !['ECR', 'ECN'].includes(String(requestType))) {
    return res.status(400).json({ detail: 'Invalid request_type' });
  }
  if (fourMCategory !== undefined && !['Man', 'Machine', 'Method', 'Material'].includes(String(fourMCategory))) {
    return res.status(400).json({ detail: 'Invalid four_m_category' });
  }
  if (riskLevel !== undefined && !['Low', 'Medium', 'High', 'Critical'].includes(String(riskLevel))) {
    return res.status(400).json({ detail: 'Invalid risk_level' });
  }
  if (
    status !== undefined &&
    !['Draft', 'Open', 'In Review', 'Approved', 'Implemented', 'Rejected', 'Closed'].includes(String(status))
  ) {
    return res.status(400).json({ detail: 'Invalid status' });
  }

  const nextStatus = status !== undefined ? String(status) : '';
  if (nextStatus === 'Approved') {
    fields.push(['approved_at', new Date().toISOString()]);
  }
  if (nextStatus === 'Implemented') {
    fields.push(['implemented_at', new Date().toISOString()]);
  }
  if (nextStatus && nextStatus !== 'Approved') {
    fields.push(['approved_at', null]);
  }
  if (nextStatus && nextStatus !== 'Implemented') {
    fields.push(['implemented_at', null]);
  }

  const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE change_requests
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, code, request_type, title, description, four_m_category, change_reason,
               impact_assessment, risk_level, status, requested_by, requested_date, target_date,
               approved_by, approved_at, implemented_at, created_at, updated_at`,
    [...values, id, req.user?.tenant_id]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Change request not found' });
  }
  return res.json(rows[0]);
});

router.get('/lessons', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const params: unknown[] = [tenantId];
  const filters: string[] = ['tenant_id = $1'];

  const status = String(req.query.status ?? '').trim();
  const sourceType = String(req.query.source_type ?? '').trim();
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const tag = String(req.query.tag ?? '').trim().toLowerCase();

  if (status) {
    params.push(status);
    filters.push(`status = $${params.length}`);
  }
  if (sourceType) {
    params.push(sourceType);
    filters.push(`source_type = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    filters.push(
      `(LOWER(code) LIKE $${params.length} OR LOWER(title) LIKE $${params.length} OR LOWER(summary) LIKE $${params.length} OR LOWER(problem_statement) LIKE $${params.length})`
    );
  }
  if (tag) {
    params.push(tag);
    filters.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(tags) AS t(value)
      WHERE LOWER(t.value) = $${params.length}
    )`);
  }

  const { rows } = await pool.query(
    `SELECT id, code, title, summary, problem_statement, root_cause, what_worked, what_failed,
            preventive_recommendation, standardization_action, source_type, source_ref,
            category, department, tags, risk_level, applicability, status, owner_id, approved_by,
            approved_at, effective_from, review_due_at, created_at, updated_at
     FROM lessons_learned
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC`,
    params
  );
  return res.json(rows);
});

router.get('/lessons/kpis', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [summaryResult, ackResult] = await Promise.all([
    pool.query(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'Draft')::int AS draft_count,
          COUNT(*) FILTER (WHERE status = 'Published')::int AS published_count,
          COUNT(*) FILTER (WHERE status = 'Archived')::int AS archived_count,
          COUNT(*) FILTER (WHERE status = 'Published' AND created_at >= $2)::int AS published_this_month
       FROM lessons_learned
       WHERE tenant_id = $1`,
      [tenantId, monthStart.toISOString()]
    ),
    pool.query(
      `SELECT
          COUNT(DISTINCT a.lesson_id)::int AS lessons_with_ack,
          COUNT(*)::int AS total_ack_rows
       FROM lesson_acknowledgements a
       WHERE a.tenant_id = $1`,
      [tenantId]
    ),
  ]);

  const row = summaryResult.rows[0] ?? {};
  const ack = ackResult.rows[0] ?? {};
  return res.json({
    draft_count: Number(row.draft_count ?? 0),
    published_count: Number(row.published_count ?? 0),
    archived_count: Number(row.archived_count ?? 0),
    published_this_month: Number(row.published_this_month ?? 0),
    lessons_with_ack: Number(ack.lessons_with_ack ?? 0),
    total_ack_rows: Number(ack.total_ack_rows ?? 0),
  });
});

router.post('/lessons', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const title = String(payload.title ?? '').trim();
  if (!title) {
    return res.status(400).json({ detail: 'Title is required' });
  }
  const sourceType = String(payload.source_type ?? 'Manual').trim();
  const riskLevel = String(payload.risk_level ?? 'Medium').trim();
  const applicability = String(payload.applicability ?? 'Plant').trim();
  const status = String(payload.status ?? 'Draft').trim();
  if (!['Audit', 'NC', 'Complaint', 'Change', 'Manual'].includes(sourceType)) {
    return res.status(400).json({ detail: 'Invalid source_type' });
  }
  if (!['Low', 'Medium', 'High', 'Critical'].includes(riskLevel)) {
    return res.status(400).json({ detail: 'Invalid risk_level' });
  }
  if (!['Plant', 'Line', 'Product', 'Global'].includes(applicability)) {
    return res.status(400).json({ detail: 'Invalid applicability' });
  }
  if (!['Draft', 'Published', 'Archived'].includes(status)) {
    return res.status(400).json({ detail: 'Invalid status' });
  }

  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateLessonCode();
    const exists = await pool.query(
      'SELECT 1 FROM lessons_learned WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [tenantId, code]
    );
    if (!exists.rows.length) {
      break;
    }
    code = '';
  }
  if (!code) {
    return res.status(500).json({ detail: 'Unable to generate lesson code' });
  }

  const approvedBy = status === 'Published' ? userId : null;
  const approvedAt = status === 'Published' ? new Date().toISOString() : null;
  const tags = normalizeTags(payload.tags);
  const { rows } = await pool.query(
    `INSERT INTO lessons_learned
      (tenant_id, code, title, summary, problem_statement, root_cause, what_worked, what_failed,
       preventive_recommendation, standardization_action, source_type, source_ref, category, department,
       tags, risk_level, applicability, status, owner_id, approved_by, approved_at, effective_from,
       review_due_at, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15::jsonb, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW())
     RETURNING id, code, title, summary, problem_statement, root_cause, what_worked, what_failed,
               preventive_recommendation, standardization_action, source_type, source_ref,
               category, department, tags, risk_level, applicability, status, owner_id, approved_by,
               approved_at, effective_from, review_due_at, created_at, updated_at`,
    [
      tenantId,
      code,
      title,
      payload.summary ?? null,
      payload.problem_statement ?? null,
      payload.root_cause ?? null,
      payload.what_worked ?? null,
      payload.what_failed ?? null,
      payload.preventive_recommendation ?? null,
      payload.standardization_action ?? null,
      sourceType,
      payload.source_ref ?? null,
      payload.category ?? null,
      payload.department ?? null,
      JSON.stringify(tags),
      riskLevel,
      applicability,
      status,
      payload.owner_id ?? null,
      approvedBy,
      approvedAt,
      payload.effective_from ?? null,
      payload.review_due_at ?? null,
      userId,
    ]
  );
  const created = rows[0];
  await logLessonEvent({
    tenantId,
    lessonId: Number(created.id),
    eventType: 'Created',
    message: `Lesson ${created.code} created`,
    newData: created,
    createdBy: userId,
  });
  return res.status(201).json(created);
});

router.put('/lessons/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const lessonId = Number(req.params.id);
  if (!lessonId) {
    return res.status(400).json({ detail: 'Invalid lesson id' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const currentResult = await pool.query(
    `SELECT id, code, title, summary, problem_statement, root_cause, what_worked, what_failed,
            preventive_recommendation, standardization_action, source_type, source_ref,
            category, department, tags, risk_level, applicability, status, owner_id, approved_by,
            approved_at, effective_from, review_due_at, created_at, updated_at
     FROM lessons_learned
     WHERE id = $1 AND tenant_id = $2`,
    [lessonId, tenantId]
  );
  const current = currentResult.rows[0];
  if (!current) {
    return res.status(404).json({ detail: 'Lesson not found' });
  }

  const payload = req.body ?? {};
  const fields = ([
    ['title', payload.title],
    ['summary', payload.summary],
    ['problem_statement', payload.problem_statement],
    ['root_cause', payload.root_cause],
    ['what_worked', payload.what_worked],
    ['what_failed', payload.what_failed],
    ['preventive_recommendation', payload.preventive_recommendation],
    ['standardization_action', payload.standardization_action],
    ['source_type', payload.source_type],
    ['source_ref', payload.source_ref],
    ['category', payload.category],
    ['department', payload.department],
    ['risk_level', payload.risk_level],
    ['applicability', payload.applicability],
    ['status', payload.status],
    ['owner_id', payload.owner_id],
    ['effective_from', payload.effective_from],
    ['review_due_at', payload.review_due_at],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);

  if (payload.tags !== undefined) {
    fields.push(['tags', JSON.stringify(normalizeTags(payload.tags))]);
  }

  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }

  const sourceType = fields.find(([field]) => field === 'source_type')?.[1];
  const riskLevel = fields.find(([field]) => field === 'risk_level')?.[1];
  const applicability = fields.find(([field]) => field === 'applicability')?.[1];
  const status = fields.find(([field]) => field === 'status')?.[1];
  if (sourceType !== undefined && !['Audit', 'NC', 'Complaint', 'Change', 'Manual'].includes(String(sourceType))) {
    return res.status(400).json({ detail: 'Invalid source_type' });
  }
  if (riskLevel !== undefined && !['Low', 'Medium', 'High', 'Critical'].includes(String(riskLevel))) {
    return res.status(400).json({ detail: 'Invalid risk_level' });
  }
  if (applicability !== undefined && !['Plant', 'Line', 'Product', 'Global'].includes(String(applicability))) {
    return res.status(400).json({ detail: 'Invalid applicability' });
  }
  if (status !== undefined && !['Draft', 'Published', 'Archived'].includes(String(status))) {
    return res.status(400).json({ detail: 'Invalid status' });
  }

  const setClause = fields
    .map(([field], index) => `${field} = ${field === 'tags' ? `$${index + 1}::jsonb` : `$${index + 1}`}`)
    .join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE lessons_learned
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, code, title, summary, problem_statement, root_cause, what_worked, what_failed,
               preventive_recommendation, standardization_action, source_type, source_ref,
               category, department, tags, risk_level, applicability, status, owner_id, approved_by,
               approved_at, effective_from, review_due_at, created_at, updated_at`,
    [...values, lessonId, tenantId]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Lesson not found' });
  }
  const updated = rows[0];
  await logLessonEvent({
    tenantId,
    lessonId,
    eventType: 'Updated',
    message: `Lesson ${updated.code} updated`,
    oldData: current,
    newData: updated,
    createdBy: userId,
  });
  return res.json(updated);
});

router.post('/lessons/:id/publish', requireAuth, async (req: AuthedRequest, res) => {
  const role = String(req.user?.role ?? '').trim().toLowerCase();
  if (!['manager', 'admin', 'super admin'].includes(role)) {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const lessonId = Number(req.params.id);
  if (!lessonId) {
    return res.status(400).json({ detail: 'Invalid lesson id' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const { rows } = await pool.query(
    `UPDATE lessons_learned
     SET status = 'Published',
         approved_by = $1,
         approved_at = NOW(),
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3
     RETURNING id, code, status, approved_by, approved_at`,
    [userId, lessonId, tenantId]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Lesson not found' });
  }
  await logLessonEvent({
    tenantId,
    lessonId,
    eventType: 'Published',
    message: `Lesson ${rows[0].code} published`,
    newData: rows[0],
    createdBy: userId,
  });
  return res.json(rows[0]);
});

router.post('/lessons/:id/archive', requireAuth, async (req: AuthedRequest, res) => {
  const role = String(req.user?.role ?? '').trim().toLowerCase();
  if (!['manager', 'admin', 'super admin'].includes(role)) {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const lessonId = Number(req.params.id);
  if (!lessonId) {
    return res.status(400).json({ detail: 'Invalid lesson id' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const { rows } = await pool.query(
    `UPDATE lessons_learned
     SET status = 'Archived', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, code, status`,
    [lessonId, tenantId]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Lesson not found' });
  }
  await logLessonEvent({
    tenantId,
    lessonId,
    eventType: 'Archived',
    message: `Lesson ${rows[0].code} archived`,
    newData: rows[0],
    createdBy: userId,
  });
  return res.json(rows[0]);
});

router.post('/lessons/:id/acknowledge', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const lessonId = Number(req.params.id);
  const userId = Number(req.user?.sub ?? 0);
  const tenantId = Number(req.user?.tenant_id ?? 0);
  if (!lessonId || !userId) {
    return res.status(400).json({ detail: 'Invalid request' });
  }
  const lessonQuery = await pool.query(
    `SELECT id, code, status
     FROM lessons_learned
     WHERE id = $1 AND tenant_id = $2`,
    [lessonId, tenantId]
  );
  const lesson = lessonQuery.rows[0];
  if (!lesson) {
    return res.status(404).json({ detail: 'Lesson not found' });
  }
  await pool.query(
    `INSERT INTO lesson_acknowledgements
      (tenant_id, lesson_id, user_id, acknowledged_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, lesson_id, user_id)
     DO UPDATE SET acknowledged_at = NOW()`,
    [tenantId, lessonId, userId]
  );
  await logLessonEvent({
    tenantId,
    lessonId,
    eventType: 'Acknowledged',
    message: `Lesson ${lesson.code} acknowledged`,
    createdBy: userId,
  });
  return res.json({ detail: 'Acknowledged' });
});

router.get('/lessons/:id/ack-status', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const lessonId = Number(req.params.id);
  if (!lessonId) {
    return res.status(400).json({ detail: 'Invalid lesson id' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);

  const lessonResult = await pool.query(
    `SELECT id, department
     FROM lessons_learned
     WHERE id = $1 AND tenant_id = $2`,
    [lessonId, tenantId]
  );
  const lesson = lessonResult.rows[0];
  if (!lesson) {
    return res.status(404).json({ detail: 'Lesson not found' });
  }

  const department = String(lesson.department ?? '').trim();
  const userQuery = await pool.query(
    `SELECT id
     FROM users
     WHERE tenant_id = $1
       AND status = 'Active'
       ${department ? 'AND department = $2' : ''}`,
    department ? [tenantId, department] : [tenantId]
  );
  const totalUsers = userQuery.rows.length;
  const ackQuery = await pool.query(
    `SELECT user_id, acknowledged_at
     FROM lesson_acknowledgements
     WHERE tenant_id = $1 AND lesson_id = $2`,
    [tenantId, lessonId]
  );
  return res.json({
    total_users: totalUsers,
    acknowledged_count: ackQuery.rows.length,
    acknowledgements: ackQuery.rows,
  });
});

router.get('/instruments', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const { rows } = await pool.query(
    `SELECT id, code, name, instrument_type, serial_number, location, owner_department,
            calibration_frequency_days, last_calibrated_at, next_calibration_due,
            status, remarks, created_at, updated_at
     FROM instruments
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/instruments', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const name = String(payload.name ?? '').trim();
  if (!name) {
    return res.status(400).json({ detail: 'name is required' });
  }
  const frequencyDays = Math.max(1, Math.floor(Number(payload.calibration_frequency_days ?? 180)));
  const status = String(payload.status ?? 'Active').trim();
  if (!['Active', 'Inactive', 'Out of Service'].includes(status)) {
    return res.status(400).json({ detail: 'Invalid status' });
  }
  const lastCalibratedAt = String(payload.last_calibrated_at ?? '').trim();
  const baseline = lastCalibratedAt ? new Date(lastCalibratedAt) : new Date();
  const nextDue = new Date(baseline.getTime() + frequencyDays * 24 * 60 * 60 * 1000);

  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateInstrumentCode();
    const exists = await pool.query(
      'SELECT 1 FROM instruments WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [req.user?.tenant_id, code]
    );
    if (!exists.rows.length) {
      break;
    }
    code = '';
  }
  if (!code) {
    return res.status(500).json({ detail: 'Unable to generate instrument code' });
  }

  const { rows } = await pool.query(
    `INSERT INTO instruments
      (tenant_id, code, name, instrument_type, serial_number, location, owner_department,
       calibration_frequency_days, last_calibrated_at, next_calibration_due, status, remarks,
       created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
     RETURNING id, code, name, instrument_type, serial_number, location, owner_department,
               calibration_frequency_days, last_calibrated_at, next_calibration_due,
               status, remarks, created_at, updated_at`,
    [
      req.user?.tenant_id,
      code,
      name,
      payload.instrument_type ?? null,
      payload.serial_number ?? null,
      payload.location ?? null,
      payload.owner_department ?? null,
      frequencyDays,
      lastCalibratedAt || null,
      nextDue.toISOString().slice(0, 10),
      status,
      payload.remarks ?? null,
      Number(req.user?.sub ?? 0) || null,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/instruments/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid instrument id' });
  }
  const payload = req.body ?? {};
  const fields = ([
    ['name', payload.name],
    ['instrument_type', payload.instrument_type],
    ['serial_number', payload.serial_number],
    ['location', payload.location],
    ['owner_department', payload.owner_department],
    ['calibration_frequency_days', payload.calibration_frequency_days],
    ['last_calibrated_at', payload.last_calibrated_at],
    ['next_calibration_due', payload.next_calibration_due],
    ['status', payload.status],
    ['remarks', payload.remarks],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);

  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }
  const status = fields.find(([field]) => field === 'status')?.[1];
  if (status !== undefined && !['Active', 'Inactive', 'Out of Service'].includes(String(status))) {
    return res.status(400).json({ detail: 'Invalid status' });
  }
  const frequency = fields.find(([field]) => field === 'calibration_frequency_days')?.[1];
  if (frequency !== undefined && Number(frequency) < 1) {
    return res.status(400).json({ detail: 'Invalid calibration_frequency_days' });
  }

  const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE instruments
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, code, name, instrument_type, serial_number, location, owner_department,
               calibration_frequency_days, last_calibrated_at, next_calibration_due,
               status, remarks, created_at, updated_at`,
    [...values, id, req.user?.tenant_id]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Instrument not found' });
  }
  return res.json(rows[0]);
});

router.get('/instruments/:id/calibrations', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const instrumentId = Number(req.params.id);
  if (!instrumentId) {
    return res.status(400).json({ detail: 'Invalid instrument id' });
  }
  const instrumentQuery = await pool.query(
    `SELECT id
     FROM instruments
     WHERE id = $1 AND tenant_id = $2`,
    [instrumentId, req.user?.tenant_id]
  );
  if (!instrumentQuery.rows.length) {
    return res.status(404).json({ detail: 'Instrument not found' });
  }
  const { rows } = await pool.query(
    `SELECT id, instrument_id, calibration_date, calibrated_by, result, certificate_no,
            notes, next_due_date, created_at
     FROM instrument_calibrations
     WHERE instrument_id = $1 AND tenant_id = $2
     ORDER BY calibration_date DESC`,
    [instrumentId, req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/instruments/:id/calibrations', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const instrumentId = Number(req.params.id);
  if (!instrumentId) {
    return res.status(400).json({ detail: 'Invalid instrument id' });
  }
  const payload = req.body ?? {};
  const calibrationDate = String(payload.calibration_date ?? '').trim();
  if (!calibrationDate) {
    return res.status(400).json({ detail: 'calibration_date is required' });
  }
  const result = String(payload.result ?? 'Pass').trim();
  if (!['Pass', 'Fail', 'Conditional'].includes(result)) {
    return res.status(400).json({ detail: 'Invalid result' });
  }
  const instrumentQuery = await pool.query(
    `SELECT id, calibration_frequency_days
     FROM instruments
     WHERE id = $1 AND tenant_id = $2`,
    [instrumentId, req.user?.tenant_id]
  );
  const instrument = instrumentQuery.rows[0];
  if (!instrument) {
    return res.status(404).json({ detail: 'Instrument not found' });
  }

  const frequencyDays = Math.max(1, Number(instrument.calibration_frequency_days ?? 180));
  const baseline = new Date(calibrationDate);
  const nextDueDate = new Date(baseline.getTime() + frequencyDays * 24 * 60 * 60 * 1000);

  const { rows } = await pool.query(
    `INSERT INTO instrument_calibrations
      (tenant_id, instrument_id, calibration_date, calibrated_by, result, certificate_no,
       notes, next_due_date, created_by, created_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id, instrument_id, calibration_date, calibrated_by, result, certificate_no,
               notes, next_due_date, created_at`,
    [
      req.user?.tenant_id,
      instrumentId,
      calibrationDate,
      payload.calibrated_by ?? null,
      result,
      payload.certificate_no ?? null,
      payload.notes ?? null,
      nextDueDate.toISOString().slice(0, 10),
      Number(req.user?.sub ?? 0) || null,
    ]
  );

  await pool.query(
    `UPDATE instruments
     SET last_calibrated_at = $1,
         next_calibration_due = $2,
         updated_at = NOW()
     WHERE id = $3 AND tenant_id = $4`,
    [calibrationDate, nextDueDate.toISOString().slice(0, 10), instrumentId, req.user?.tenant_id]
  );

  return res.status(201).json(rows[0]);
});

router.get('/suppliers', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const { rows } = await pool.query(
    `SELECT id, code, name, category, contact_name, contact_email, contact_phone,
            status, created_at, updated_at
     FROM suppliers
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/suppliers', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const name = String(payload.name ?? '').trim();
  if (!name) {
    return res.status(400).json({ detail: 'name is required' });
  }
  const status = String(payload.status ?? 'Active').trim();
  if (!['Active', 'Inactive', 'Blocked'].includes(status)) {
    return res.status(400).json({ detail: 'Invalid status' });
  }

  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateSupplierCode();
    const exists = await pool.query(
      'SELECT 1 FROM suppliers WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [req.user?.tenant_id, code]
    );
    if (!exists.rows.length) {
      break;
    }
    code = '';
  }
  if (!code) {
    return res.status(500).json({ detail: 'Unable to generate supplier code' });
  }

  const { rows } = await pool.query(
    `INSERT INTO suppliers
      (tenant_id, code, name, category, contact_name, contact_email, contact_phone,
       status, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING id, code, name, category, contact_name, contact_email, contact_phone,
               status, created_at, updated_at`,
    [
      req.user?.tenant_id,
      code,
      name,
      payload.category ?? null,
      payload.contact_name ?? null,
      payload.contact_email ?? null,
      payload.contact_phone ?? null,
      status,
      Number(req.user?.sub ?? 0) || null,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/suppliers/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid supplier id' });
  }
  const payload = req.body ?? {};
  const fields = ([
    ['name', payload.name],
    ['category', payload.category],
    ['contact_name', payload.contact_name],
    ['contact_email', payload.contact_email],
    ['contact_phone', payload.contact_phone],
    ['status', payload.status],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }
  const status = fields.find(([field]) => field === 'status')?.[1];
  if (status !== undefined && !['Active', 'Inactive', 'Blocked'].includes(String(status))) {
    return res.status(400).json({ detail: 'Invalid status' });
  }

  const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE suppliers
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, code, name, category, contact_name, contact_email, contact_phone,
               status, created_at, updated_at`,
    [...values, id, req.user?.tenant_id]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Supplier not found' });
  }
  return res.json(rows[0]);
});

router.get('/supplier-ppap', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.supplier_id, s.code AS supplier_code, s.name AS supplier_name, p.part_no, p.level,
              p.submission_date, p.approval_status, p.approved_by, p.approved_at, p.remarks,
              p.created_at, p.updated_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', d.id,
                    'file_name', d.file_name,
                    'file_key', d.file_key,
                    'file_url', d.file_url,
                    'created_at', d.created_at
                  )
                  ORDER BY d.created_at DESC
                ) FILTER (WHERE d.id IS NOT NULL),
                '[]'::json
              ) AS documents
       FROM supplier_ppap p
       JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN supplier_ppap_documents d
         ON d.ppap_id = p.id AND d.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1
       GROUP BY p.id, s.code, s.name
       ORDER BY p.created_at DESC`,
      [req.user?.tenant_id]
    );
    return res.json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('supplier_ppap_documents')) {
      throw error;
    }
    const fallback = await pool.query(
      `SELECT p.id, p.supplier_id, s.code AS supplier_code, s.name AS supplier_name, p.part_no, p.level,
              p.submission_date, p.approval_status, p.approved_by, p.approved_at, p.remarks,
              p.created_at, p.updated_at,
              '[]'::json AS documents
       FROM supplier_ppap p
       JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.tenant_id = $1
       ORDER BY p.created_at DESC`,
      [req.user?.tenant_id]
    );
    return res.json(fallback.rows);
  }
});

router.post('/supplier-ppap', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const supplierId = Number(payload.supplier_id);
  const partNo = String(payload.part_no ?? '').trim() || 'N/A';
  if (!supplierId) {
    return res.status(400).json({ detail: 'supplier_id is required' });
  }
  const approvalStatus = String(payload.approval_status ?? 'Pending').trim();
  if (!['Pending', 'Approved', 'Rejected'].includes(approvalStatus)) {
    return res.status(400).json({ detail: 'Invalid approval_status' });
  }
  const level = normalizePpapLevel(payload.level);
  if (!level) {
    return res.status(400).json({
      detail: `Invalid PPAP level. Allowed values: ${PPAP_LEVEL_OPTIONS.join(', ')}`,
    });
  }

  const supplierQuery = await pool.query(
    'SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2',
    [supplierId, req.user?.tenant_id]
  );
  if (!supplierQuery.rows.length) {
    return res.status(404).json({ detail: 'Supplier not found' });
  }

  const approvedAt = approvalStatus === 'Approved' ? new Date().toISOString() : null;
  const { rows } = await pool.query(
    `INSERT INTO supplier_ppap
      (tenant_id, supplier_id, part_no, level, submission_date, approval_status,
       approved_by, approved_at, remarks, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     RETURNING id, supplier_id, part_no, level, submission_date, approval_status,
               approved_by, approved_at, remarks, created_at, updated_at`,
    [
      req.user?.tenant_id,
      supplierId,
      partNo,
      level,
      payload.submission_date ?? null,
      approvalStatus,
      payload.approved_by ?? null,
      approvedAt,
      payload.remarks ?? null,
      Number(req.user?.sub ?? 0) || null,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/supplier-ppap/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid PPAP id' });
  }
  const payload = req.body ?? {};
  const fields = ([
    ['part_no', payload.part_no],
    ['level', payload.level],
    ['submission_date', payload.submission_date],
    ['approval_status', payload.approval_status],
    ['approved_by', payload.approved_by],
    ['remarks', payload.remarks],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }
  const approvalStatus = fields.find(([field]) => field === 'approval_status')?.[1];
  if (approvalStatus !== undefined && !['Pending', 'Approved', 'Rejected'].includes(String(approvalStatus))) {
    return res.status(400).json({ detail: 'Invalid approval_status' });
  }
  const levelFieldIndex = fields.findIndex(([field]) => field === 'level');
  if (levelFieldIndex >= 0) {
    const normalized = normalizePpapLevel(fields[levelFieldIndex][1]);
    if (!normalized) {
      return res.status(400).json({
        detail: `Invalid PPAP level. Allowed values: ${PPAP_LEVEL_OPTIONS.join(', ')}`,
      });
    }
    fields[levelFieldIndex] = ['level', normalized];
  }
  if (approvalStatus !== undefined) {
    fields.push(['approved_at', String(approvalStatus) === 'Approved' ? new Date().toISOString() : null]);
  }

  const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE supplier_ppap
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, supplier_id, part_no, level, submission_date, approval_status,
               approved_by, approved_at, remarks, created_at, updated_at`,
    [...values, id, req.user?.tenant_id]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'PPAP record not found' });
  }
  return res.json(rows[0]);
});

router.post('/supplier-ppap/:id/documents/presign', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  if (!spacesClient || !spacesBucket || !spacesPublicBase) {
    return res.status(500).json({ detail: 'Spaces configuration missing' });
  }
  const ppapId = Number(req.params.id);
  if (!ppapId) {
    return res.status(400).json({ detail: 'Invalid PPAP id' });
  }
  const ppapResult = await pool.query(
    'SELECT id FROM supplier_ppap WHERE id = $1 AND tenant_id = $2 LIMIT 1',
    [ppapId, req.user?.tenant_id]
  );
  if (!ppapResult.rows.length) {
    return res.status(404).json({ detail: 'PPAP record not found' });
  }
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length) {
    return res.status(400).json({ detail: 'Missing files' });
  }
  const folder = `supplier-ppap/${ppapId}`;
  const uploads = await Promise.all(
    files.map(async (file: any, index: number) => {
      const originalName = String(file?.name ?? `document-${index + 1}`);
      const contentType = String(file?.type ?? 'application/octet-stream');
      const key = `${folder}/${Date.now()}-${sanitizeFilename(originalName)}`;
      const command = new PutObjectCommand({
        Bucket: spacesBucket,
        Key: key,
        ContentType: contentType,
        ACL: 'public-read',
      });
      const uploadUrl = await getSignedUrl(spacesClient, command, { expiresIn: 900 });
      const publicUrl = `${spacesPublicBase.replace(/\/$/, '')}/${key}`;
      return { name: originalName, key, uploadUrl, publicUrl };
    })
  );
  return res.json({
    folderUrl: `${spacesPublicBase.replace(/\/$/, '')}/${folder}/`,
    uploads,
  });
});

router.post('/supplier-ppap/:id/documents', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const ppapId = Number(req.params.id);
  if (!ppapId) {
    return res.status(400).json({ detail: 'Invalid PPAP id' });
  }
  const ppapResult = await pool.query(
    'SELECT id FROM supplier_ppap WHERE id = $1 AND tenant_id = $2 LIMIT 1',
    [ppapId, req.user?.tenant_id]
  );
  if (!ppapResult.rows.length) {
    return res.status(404).json({ detail: 'PPAP record not found' });
  }
  const documents = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (!documents.length) {
    return res.status(400).json({ detail: 'Missing documents' });
  }
  const folderPrefix = `supplier-ppap/${ppapId}/`;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (let index = 0; index < documents.length; index += 1) {
    const doc = documents[index] ?? {};
    const fileName = String(doc.name ?? '').trim();
    const fileKey = String(doc.key ?? '').replace(/^\/+/, '');
    const fileUrl = String(doc.url ?? '').trim();
    if (!fileName || !fileKey || !fileUrl || !fileKey.startsWith(folderPrefix)) {
      return res.status(400).json({ detail: 'Invalid document payload' });
    }
    const start = values.length;
    values.push(
      req.user?.tenant_id,
      ppapId,
      fileName,
      fileKey,
      fileUrl,
      Number(req.user?.sub ?? 0) || null
    );
    tuples.push(`($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, NOW())`);
  }
  const { rows } = await pool.query(
    `INSERT INTO supplier_ppap_documents
      (tenant_id, ppap_id, file_name, file_key, file_url, uploaded_by, created_at)
     VALUES ${tuples.join(', ')}
     RETURNING id, ppap_id, file_name, file_key, file_url, created_at`,
    values
  );
  return res.status(201).json(rows);
});

router.delete('/supplier-ppap/:id/documents/:documentId', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const ppapId = Number(req.params.id);
  const documentId = Number(req.params.documentId);
  if (!ppapId || !documentId) {
    return res.status(400).json({ detail: 'Invalid ids' });
  }
  const existing = await pool.query(
    `SELECT id, file_key
     FROM supplier_ppap_documents
     WHERE id = $1 AND ppap_id = $2 AND tenant_id = $3`,
    [documentId, ppapId, req.user?.tenant_id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ detail: 'Document not found' });
  }
  const fileKey = String(existing.rows[0].file_key ?? '');
  await pool.query(
    'DELETE FROM supplier_ppap_documents WHERE id = $1 AND ppap_id = $2 AND tenant_id = $3',
    [documentId, ppapId, req.user?.tenant_id]
  );
  if (spacesClient && spacesBucket && fileKey) {
    try {
      await spacesClient.send(
        new DeleteObjectCommand({
          Bucket: spacesBucket,
          Key: fileKey,
        })
      );
    } catch (error) {
      functions.logger.warn('Failed to delete PPAP document from Spaces', {
        ppapId,
        documentId,
        fileKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return res.json({ ok: true });
});

router.get('/supplier-performance', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const { rows } = await pool.query(
    `SELECT p.id, p.supplier_id, s.code AS supplier_code, s.name AS supplier_name, p.period_month,
            p.quality_score, p.delivery_score, p.service_score, p.total_score, p.remarks,
            p.created_at, p.updated_at
     FROM supplier_performance p
     JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.tenant_id = $1
     ORDER BY p.period_month DESC, p.created_at DESC`,
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/supplier-performance', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const supplierId = Number(payload.supplier_id);
  const periodMonth = String(payload.period_month ?? '').trim();
  if (!supplierId) {
    return res.status(400).json({ detail: 'supplier_id is required' });
  }
  if (!periodMonth) {
    return res.status(400).json({ detail: 'period_month is required' });
  }
  const supplierQuery = await pool.query(
    'SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2',
    [supplierId, req.user?.tenant_id]
  );
  if (!supplierQuery.rows.length) {
    return res.status(404).json({ detail: 'Supplier not found' });
  }

  const { rows } = await pool.query(
    `INSERT INTO supplier_performance
      (tenant_id, supplier_id, period_month, quality_score, delivery_score, service_score,
       remarks, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     RETURNING id, supplier_id, period_month, quality_score, delivery_score, service_score,
               total_score, remarks, created_at, updated_at`,
    [
      req.user?.tenant_id,
      supplierId,
      periodMonth,
      Number(payload.quality_score ?? 0),
      Number(payload.delivery_score ?? 0),
      Number(payload.service_score ?? 0),
      payload.remarks ?? null,
      Number(req.user?.sub ?? 0) || null,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/supplier-performance/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid performance id' });
  }
  const payload = req.body ?? {};
  const fields = ([
    ['period_month', payload.period_month],
    ['quality_score', payload.quality_score],
    ['delivery_score', payload.delivery_score],
    ['service_score', payload.service_score],
    ['remarks', payload.remarks],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }

  const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE supplier_performance
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, supplier_id, period_month, quality_score, delivery_score, service_score,
               total_score, remarks, created_at, updated_at`,
    [...values, id, req.user?.tenant_id]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Performance record not found' });
  }
  return res.json(rows[0]);
});

router.get('/supplier-ppm', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const { rows } = await pool.query(
    `SELECT p.id, p.supplier_id, s.code AS supplier_code, s.name AS supplier_name, p.period_month,
            p.delivered_qty, p.defective_qty, p.ppm, p.remarks, p.created_at, p.updated_at
     FROM supplier_ppm p
     JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.tenant_id = $1
     ORDER BY p.period_month DESC, p.created_at DESC`,
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/supplier-ppm', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const supplierId = Number(payload.supplier_id);
  const periodMonth = String(payload.period_month ?? '').trim();
  if (!supplierId) {
    return res.status(400).json({ detail: 'supplier_id is required' });
  }
  if (!periodMonth) {
    return res.status(400).json({ detail: 'period_month is required' });
  }
  const deliveredQty = Math.max(0, Math.floor(Number(payload.delivered_qty ?? 0)));
  const defectiveQty = Math.max(0, Math.floor(Number(payload.defective_qty ?? 0)));
  if (defectiveQty > deliveredQty) {
    return res.status(400).json({ detail: 'defective_qty cannot exceed delivered_qty' });
  }
  const supplierQuery = await pool.query(
    'SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2',
    [supplierId, req.user?.tenant_id]
  );
  if (!supplierQuery.rows.length) {
    return res.status(404).json({ detail: 'Supplier not found' });
  }

  const { rows } = await pool.query(
    `INSERT INTO supplier_ppm
      (tenant_id, supplier_id, period_month, delivered_qty, defective_qty, remarks,
       created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING id, supplier_id, period_month, delivered_qty, defective_qty, ppm,
               remarks, created_at, updated_at`,
    [
      req.user?.tenant_id,
      supplierId,
      periodMonth,
      deliveredQty,
      defectiveQty,
      payload.remarks ?? null,
      Number(req.user?.sub ?? 0) || null,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/supplier-ppm/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid PPM id' });
  }
  const payload = req.body ?? {};
  const fields = ([
    ['period_month', payload.period_month],
    ['delivered_qty', payload.delivered_qty],
    ['defective_qty', payload.defective_qty],
    ['remarks', payload.remarks],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }

  const deliveredQty = fields.find(([field]) => field === 'delivered_qty')?.[1];
  const defectiveQty = fields.find(([field]) => field === 'defective_qty')?.[1];
  if (deliveredQty !== undefined && Number(deliveredQty) < 0) {
    return res.status(400).json({ detail: 'Invalid delivered_qty' });
  }
  if (defectiveQty !== undefined && Number(defectiveQty) < 0) {
    return res.status(400).json({ detail: 'Invalid defective_qty' });
  }

  const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE supplier_ppm
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, supplier_id, period_month, delivered_qty, defective_qty, ppm,
               remarks, created_at, updated_at`,
    [...values, id, req.user?.tenant_id]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'PPM record not found' });
  }
  return res.json(rows[0]);
});

router.get('/supplier-audits', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.supplier_id, s.code AS supplier_code, s.name AS supplier_name, a.audit_date,
            a.audit_type, a.auditor_name, a.score, a.status, a.findings, a.action_owner,
            a.target_close_date, a.created_at, a.updated_at
     FROM supplier_audits a
     JOIN suppliers s ON s.id = a.supplier_id
     WHERE a.tenant_id = $1
     ORDER BY a.audit_date DESC, a.created_at DESC`,
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/supplier-audits', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const supplierId = Number(payload.supplier_id);
  const auditDate = String(payload.audit_date ?? '').trim();
  if (!supplierId) {
    return res.status(400).json({ detail: 'supplier_id is required' });
  }
  if (!auditDate) {
    return res.status(400).json({ detail: 'audit_date is required' });
  }
  const status = String(payload.status ?? 'Planned').trim();
  if (!['Planned', 'In Progress', 'Closed'].includes(status)) {
    return res.status(400).json({ detail: 'Invalid status' });
  }
  const supplierQuery = await pool.query(
    'SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2',
    [supplierId, req.user?.tenant_id]
  );
  if (!supplierQuery.rows.length) {
    return res.status(404).json({ detail: 'Supplier not found' });
  }

  const { rows } = await pool.query(
    `INSERT INTO supplier_audits
      (tenant_id, supplier_id, audit_date, audit_type, auditor_name, score, status,
       findings, action_owner, target_close_date, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
     RETURNING id, supplier_id, audit_date, audit_type, auditor_name, score, status,
               findings, action_owner, target_close_date, created_at, updated_at`,
    [
      req.user?.tenant_id,
      supplierId,
      auditDate,
      payload.audit_type ?? null,
      payload.auditor_name ?? null,
      payload.score ?? null,
      status,
      payload.findings ?? null,
      payload.action_owner ?? null,
      payload.target_close_date ?? null,
      Number(req.user?.sub ?? 0) || null,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/supplier-audits/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: 'Invalid supplier audit id' });
  }
  const payload = req.body ?? {};
  const fields = ([
    ['audit_date', payload.audit_date],
    ['audit_type', payload.audit_type],
    ['auditor_name', payload.auditor_name],
    ['score', payload.score],
    ['status', payload.status],
    ['findings', payload.findings],
    ['action_owner', payload.action_owner],
    ['target_close_date', payload.target_close_date],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }
  const status = fields.find(([field]) => field === 'status')?.[1];
  if (status !== undefined && !['Planned', 'In Progress', 'Closed'].includes(String(status))) {
    return res.status(400).json({ detail: 'Invalid status' });
  }

  const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE supplier_audits
     SET ${setClause}, updated_at = NOW()
     WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
     RETURNING id, supplier_id, audit_date, audit_type, auditor_name, score, status,
               findings, action_owner, target_close_date, created_at, updated_at`,
    [...values, id, req.user?.tenant_id]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Supplier audit not found' });
  }
  return res.json(rows[0]);
});

router.get('/supplier-worst', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const limit = Math.min(Math.max(Number(req.query.limit ?? 10), 1), 50);
  const { rows } = await pool.query(
    `SELECT s.id, s.code, s.name,
            COALESCE(ppm.avg_ppm, 0)::numeric(12,2) AS avg_ppm,
            COALESCE(perf.avg_total_score, 0)::numeric(6,2) AS avg_total_score,
            (COALESCE(ppm.avg_ppm, 0) + (300 - LEAST(COALESCE(perf.avg_total_score, 0), 300)) * 100)::numeric(14,2) AS risk_index,
            aud.status AS latest_audit_status,
            aud.audit_date AS latest_audit_date
     FROM suppliers s
     LEFT JOIN LATERAL (
       SELECT AVG(spm.ppm) AS avg_ppm
       FROM supplier_ppm spm
       WHERE spm.tenant_id = s.tenant_id AND spm.supplier_id = s.id
     ) ppm ON TRUE
     LEFT JOIN LATERAL (
       SELECT AVG(sp.total_score) AS avg_total_score
       FROM supplier_performance sp
       WHERE sp.tenant_id = s.tenant_id AND sp.supplier_id = s.id
     ) perf ON TRUE
     LEFT JOIN LATERAL (
       SELECT sa.status, sa.audit_date
       FROM supplier_audits sa
       WHERE sa.tenant_id = s.tenant_id AND sa.supplier_id = s.id
       ORDER BY sa.audit_date DESC NULLS LAST, sa.created_at DESC
       LIMIT 1
     ) aud ON TRUE
     WHERE s.tenant_id = $1
     ORDER BY risk_index DESC, avg_ppm DESC, avg_total_score ASC
     LIMIT $2`,
    [req.user?.tenant_id, limit]
  );
  return res.json(rows);
});

router.get('/supplier-dashboard', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);

  const [kpiResult, monthlyPpmResult, worstSupplierResult, ppapAgingResult] = await Promise.all([
    pool.query(
      `SELECT
          COUNT(*)::int AS total_suppliers,
          COUNT(*) FILTER (WHERE status = 'Active')::int AS active_suppliers,
          (SELECT COUNT(*)::int FROM supplier_ppap WHERE tenant_id = $1 AND approval_status = 'Pending') AS pending_ppap,
          (SELECT COUNT(*)::int FROM supplier_audits WHERE tenant_id = $1 AND status <> 'Closed') AS open_supplier_audits
       FROM suppliers
       WHERE tenant_id = $1`,
      [tenantId]
    ),
    pool.query(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
           date_trunc('month', CURRENT_DATE),
           INTERVAL '1 month'
         )::date AS month_start
       )
       SELECT to_char(m.month_start, 'Mon YYYY') AS label,
              COALESCE(AVG(spm.ppm), 0)::numeric(12,2) AS avg_ppm
       FROM months m
       LEFT JOIN supplier_ppm spm
         ON spm.tenant_id = $1
        AND date_trunc('month', spm.period_month) = m.month_start
       GROUP BY m.month_start
       ORDER BY m.month_start`,
      [tenantId]
    ),
    pool.query(
      `SELECT s.id, s.code, s.name,
              COALESCE(ppm.avg_ppm, 0)::numeric(12,2) AS avg_ppm,
              COALESCE(perf.avg_total_score, 0)::numeric(6,2) AS avg_total_score,
              (COALESCE(ppm.avg_ppm, 0) + (300 - LEAST(COALESCE(perf.avg_total_score, 0), 300)) * 100)::numeric(14,2) AS risk_index
       FROM suppliers s
       LEFT JOIN LATERAL (
         SELECT AVG(spm.ppm) AS avg_ppm
         FROM supplier_ppm spm
         WHERE spm.tenant_id = s.tenant_id AND spm.supplier_id = s.id
       ) ppm ON TRUE
       LEFT JOIN LATERAL (
         SELECT AVG(sp.total_score) AS avg_total_score
         FROM supplier_performance sp
         WHERE sp.tenant_id = s.tenant_id AND sp.supplier_id = s.id
       ) perf ON TRUE
       WHERE s.tenant_id = $1
       ORDER BY risk_index DESC, avg_ppm DESC, avg_total_score ASC
       LIMIT 5`,
      [tenantId]
    ),
    pool.query(
      `SELECT
          SUM(CASE WHEN age_days BETWEEN 0 AND 7 THEN 1 ELSE 0 END)::int AS bucket_0_7,
          SUM(CASE WHEN age_days BETWEEN 8 AND 15 THEN 1 ELSE 0 END)::int AS bucket_8_15,
          SUM(CASE WHEN age_days BETWEEN 16 AND 30 THEN 1 ELSE 0 END)::int AS bucket_16_30,
          SUM(CASE WHEN age_days > 30 THEN 1 ELSE 0 END)::int AS bucket_gt_30
       FROM (
         SELECT (CURRENT_DATE - COALESCE(submission_date, created_at::date))::int AS age_days
         FROM supplier_ppap
         WHERE tenant_id = $1
           AND approval_status = 'Pending'
       ) pending_ppap`,
      [tenantId]
    ),
  ]);

  return res.json({
    kpis: kpiResult.rows[0] ?? {
      total_suppliers: 0,
      active_suppliers: 0,
      pending_ppap: 0,
      open_supplier_audits: 0,
    },
    monthly_ppm_trend: monthlyPpmResult.rows,
    top_worst_suppliers: worstSupplierResult.rows,
    ppap_approval_aging: ppapAgingResult.rows[0] ?? {
      bucket_0_7: 0,
      bucket_8_15: 0,
      bucket_16_30: 0,
      bucket_gt_30: 0,
    },
  });
});

const avg = (values: number[]) => {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const stdDevSample = (values: number[]) => {
  if (values.length < 2) {
    return 0;
  }
  const mean = avg(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
};

const toStudyStatus = (value: unknown) => String(value ?? '').trim();

const getMsaStudyForTenant = async (tenantId: number, studyId: number) => {
  const studyResult = await pool.query(
    `SELECT s.id, s.code, s.study_type, s.title, s.characteristic, s.method, s.design_type,
            s.tolerance_min, s.tolerance_max, s.resolution, s.reference_value, s.owner_name,
            s.due_date, s.status, s.review_notes, s.instrument_id, s.created_at, s.updated_at,
            i.code AS instrument_code, i.name AS instrument_name
     FROM msa_studies s
     LEFT JOIN instruments i ON i.id = s.instrument_id AND i.tenant_id = s.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [studyId, tenantId]
  );
  return studyResult.rows[0] ?? null;
};

const computeToleranceSpan = (study: any) => {
  const min = Number(study?.tolerance_min);
  const max = Number(study?.tolerance_max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }
  return Math.max(0, max - min);
};

router.get('/msa/studies', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const studyType = String(req.query.study_type ?? '').trim();
  const status = String(req.query.status ?? '').trim();

  const whereParts = ['s.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  if (studyType) {
    params.push(studyType);
    whereParts.push(`s.study_type = $${params.length}`);
  }
  if (status) {
    params.push(status);
    whereParts.push(`s.status = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT s.id, s.code, s.study_type, s.title, s.characteristic, s.method, s.design_type,
            s.tolerance_min, s.tolerance_max, s.resolution, s.reference_value, s.owner_name,
            s.due_date, s.status, s.review_notes, s.instrument_id, s.created_at, s.updated_at,
            i.code AS instrument_code, i.name AS instrument_name,
            r.pass_fail AS latest_result, r.calculated_at AS latest_result_at
     FROM msa_studies s
     LEFT JOIN instruments i ON i.id = s.instrument_id AND i.tenant_id = s.tenant_id
     LEFT JOIN LATERAL (
       SELECT pass_fail, calculated_at
       FROM msa_results
       WHERE tenant_id = s.tenant_id AND study_id = s.id
       ORDER BY calculated_at DESC
       LIMIT 1
     ) r ON TRUE
     WHERE ${whereParts.join(' AND ')}
     ORDER BY s.created_at DESC`,
    params
  );
  return res.json(rows);
});

router.post('/msa/studies', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const payload = req.body ?? {};
  const studyType = String(payload.study_type ?? '').trim();
  const title = String(payload.title ?? '').trim();
  const status = toStudyStatus(payload.status || 'Draft') || 'Draft';
  if (!['GRR', 'Bias', 'Linearity', 'Stability'].includes(studyType)) {
    return res.status(400).json({ detail: 'Invalid study_type' });
  }
  if (!title) {
    return res.status(400).json({ detail: 'title is required' });
  }
  if (!['Draft', 'Data Collection', 'Calculated', 'Under Review', 'Approved', 'Rejected', 'Closed'].includes(status)) {
    return res.status(400).json({ detail: 'Invalid status' });
  }
  const instrumentId = payload.instrument_id ? Number(payload.instrument_id) : null;
  if (instrumentId) {
    const instrumentResult = await pool.query(
      `SELECT 1 FROM instruments WHERE id = $1 AND tenant_id = $2`,
      [instrumentId, tenantId]
    );
    if (!instrumentResult.rows.length) {
      return res.status(400).json({ detail: 'Invalid instrument_id' });
    }
  }

  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateMsaCode();
    const exists = await pool.query(
      'SELECT 1 FROM msa_studies WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [tenantId, code]
    );
    if (!exists.rows.length) {
      break;
    }
    code = '';
  }
  if (!code) {
    return res.status(500).json({ detail: 'Unable to generate study code' });
  }

  const { rows } = await pool.query(
    `INSERT INTO msa_studies
      (tenant_id, code, instrument_id, study_type, title, characteristic, method, design_type,
       tolerance_min, tolerance_max, resolution, reference_value, owner_name, due_date,
       status, review_notes, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, $17, NOW(), NOW())
     RETURNING id`,
    [
      tenantId,
      code,
      instrumentId,
      studyType,
      title,
      payload.characteristic ?? null,
      payload.method ?? null,
      payload.design_type ?? null,
      payload.tolerance_min ?? null,
      payload.tolerance_max ?? null,
      payload.resolution ?? null,
      payload.reference_value ?? null,
      payload.owner_name ?? null,
      payload.due_date ?? null,
      status,
      payload.review_notes ?? null,
      userId,
    ]
  );
  const studyId = Number(rows[0].id);

  if (studyType === 'GRR') {
    const grr = payload.grr_design ?? {};
    const operatorsCount = Math.max(1, Math.floor(Number(grr.operators_count ?? 3)));
    const partsCount = Math.max(1, Math.floor(Number(grr.parts_count ?? 10)));
    const trialsCount = Math.max(1, Math.floor(Number(grr.trials_count ?? 2)));
    const designType = String(grr.design_type ?? 'Crossed');
    const randomized = Boolean(grr.randomized ?? true);
    if (!['Crossed', 'Nested'].includes(designType)) {
      return res.status(400).json({ detail: 'Invalid grr design_type' });
    }
    await pool.query(
      `INSERT INTO msa_grr_design
        (tenant_id, study_id, operators_count, parts_count, trials_count, design_type, randomized, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [tenantId, studyId, operatorsCount, partsCount, trialsCount, designType, randomized]
    );
  }

  const createdStudy = await getMsaStudyForTenant(tenantId, studyId);
  return res.status(201).json(createdStudy);
});

router.put('/msa/studies/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const payload = req.body ?? {};
  const fields = ([
    ['instrument_id', payload.instrument_id],
    ['study_type', payload.study_type],
    ['title', payload.title],
    ['characteristic', payload.characteristic],
    ['method', payload.method],
    ['design_type', payload.design_type],
    ['tolerance_min', payload.tolerance_min],
    ['tolerance_max', payload.tolerance_max],
    ['resolution', payload.resolution],
    ['reference_value', payload.reference_value],
    ['owner_name', payload.owner_name],
    ['due_date', payload.due_date],
    ['status', payload.status],
    ['review_notes', payload.review_notes],
  ] as [string, unknown][]).filter(([, value]) => value !== undefined);
  if (!fields.length && payload.grr_design === undefined) {
    return res.status(400).json({ detail: 'No updates provided' });
  }

  const studyType = fields.find(([field]) => field === 'study_type')?.[1];
  const status = fields.find(([field]) => field === 'status')?.[1];
  const instrumentId = fields.find(([field]) => field === 'instrument_id')?.[1];
  if (
    studyType !== undefined &&
    !['GRR', 'Bias', 'Linearity', 'Stability'].includes(String(studyType))
  ) {
    return res.status(400).json({ detail: 'Invalid study_type' });
  }
  if (
    status !== undefined &&
    !['Draft', 'Data Collection', 'Calculated', 'Under Review', 'Approved', 'Rejected', 'Closed']
      .includes(String(status))
  ) {
    return res.status(400).json({ detail: 'Invalid status' });
  }
  if (instrumentId !== undefined && instrumentId !== null) {
    const instrumentQuery = await pool.query(
      'SELECT 1 FROM instruments WHERE id = $1 AND tenant_id = $2',
      [Number(instrumentId), tenantId]
    );
    if (!instrumentQuery.rows.length) {
      return res.status(400).json({ detail: 'Invalid instrument_id' });
    }
  }

  if (fields.length) {
    const setClause = fields.map(([field], index) => `${field} = $${index + 1}`).join(', ');
    const values = fields.map(([, value]) => value);
    const updateResult = await pool.query(
      `UPDATE msa_studies
       SET ${setClause}, updated_at = NOW()
       WHERE id = $${values.length + 1} AND tenant_id = $${values.length + 2}
       RETURNING id`,
      [...values, studyId, tenantId]
    );
    if (!updateResult.rows.length) {
      return res.status(404).json({ detail: 'Study not found' });
    }
  } else {
    const exists = await getMsaStudyForTenant(tenantId, studyId);
    if (!exists) {
      return res.status(404).json({ detail: 'Study not found' });
    }
  }

  if (payload.grr_design !== undefined) {
    const grr = payload.grr_design ?? {};
    const operatorsCount = Math.max(1, Math.floor(Number(grr.operators_count ?? 3)));
    const partsCount = Math.max(1, Math.floor(Number(grr.parts_count ?? 10)));
    const trialsCount = Math.max(1, Math.floor(Number(grr.trials_count ?? 2)));
    const designType = String(grr.design_type ?? 'Crossed').trim();
    const randomized = Boolean(grr.randomized ?? true);
    if (!['Crossed', 'Nested'].includes(designType)) {
      return res.status(400).json({ detail: 'Invalid grr design_type' });
    }
    await pool.query(
      `INSERT INTO msa_grr_design
        (tenant_id, study_id, operators_count, parts_count, trials_count, design_type, randomized, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (study_id)
       DO UPDATE SET
         operators_count = EXCLUDED.operators_count,
         parts_count = EXCLUDED.parts_count,
         trials_count = EXCLUDED.trials_count,
         design_type = EXCLUDED.design_type,
         randomized = EXCLUDED.randomized,
         updated_at = NOW()`,
      [tenantId, studyId, operatorsCount, partsCount, trialsCount, designType, randomized]
    );
  }

  const updatedStudy = await getMsaStudyForTenant(tenantId, studyId);
  return res.json(updatedStudy);
});

router.get('/msa/studies/:id/measurements', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const study = await getMsaStudyForTenant(tenantId, studyId);
  if (!study) {
    return res.status(404).json({ detail: 'Study not found' });
  }
  const { rows } = await pool.query(
    `SELECT id, study_id, operator_name, part_name, trial_no, measured_value, reference_value, measured_at, created_at
     FROM msa_measurements
     WHERE tenant_id = $1 AND study_id = $2
     ORDER BY created_at ASC`,
    [tenantId, studyId]
  );
  return res.json(rows);
});

router.post('/msa/studies/:id/measurements', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const study = await getMsaStudyForTenant(tenantId, studyId);
  if (!study) {
    return res.status(404).json({ detail: 'Study not found' });
  }

  const payload = req.body ?? {};
  const rawRows = Array.isArray(payload.rows) ? payload.rows : [payload];
  const sanitizedRows = rawRows
    .map((row: any) => ({
      operator_name: String(row?.operator_name ?? '').trim() || null,
      part_name: String(row?.part_name ?? '').trim() || null,
      trial_no: row?.trial_no === undefined || row?.trial_no === null ? null : Number(row.trial_no),
      measured_value: Number(row?.measured_value),
      reference_value: row?.reference_value === undefined || row?.reference_value === null || row?.reference_value === ''
        ? null
        : Number(row.reference_value),
      measured_at: row?.measured_at ? String(row.measured_at) : null,
    }))
    .filter((row: any) => Number.isFinite(row.measured_value));

  if (!sanitizedRows.length) {
    return res.status(400).json({ detail: 'No valid measurements provided' });
  }

  const inserted: any[] = [];
  for (const row of sanitizedRows) {
    const insertResult = await pool.query(
      `INSERT INTO msa_measurements
        (tenant_id, study_id, operator_name, part_name, trial_no, measured_value, reference_value, measured_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9, NOW())
       RETURNING id, study_id, operator_name, part_name, trial_no, measured_value, reference_value, measured_at, created_at`,
      [
        tenantId,
        studyId,
        row.operator_name,
        row.part_name,
        row.trial_no,
        row.measured_value,
        row.reference_value,
        row.measured_at,
        userId,
      ]
    );
    inserted.push(insertResult.rows[0]);
  }

  if (study.status === 'Draft') {
    await pool.query(
      `UPDATE msa_studies
       SET status = 'Data Collection', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [studyId, tenantId]
    );
  }

  return res.status(201).json({ inserted_count: inserted.length, rows: inserted });
});

router.get('/msa/studies/:id/results', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const study = await getMsaStudyForTenant(tenantId, studyId);
  if (!study) {
    return res.status(404).json({ detail: 'Study not found' });
  }

  const { rows } = await pool.query(
    `SELECT id, study_id, result_type, metrics_json, pass_fail, recommendation,
            calculated_by, calculated_at, approved_by, approved_at, created_at
     FROM msa_results
     WHERE tenant_id = $1 AND study_id = $2
     ORDER BY calculated_at DESC`,
    [tenantId, studyId]
  );
  return res.json(rows);
});

router.post('/msa/studies/:id/calculate', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const study = await getMsaStudyForTenant(tenantId, studyId);
  if (!study) {
    return res.status(404).json({ detail: 'Study not found' });
  }

  const measurementResult = await pool.query(
    `SELECT operator_name, part_name, trial_no, measured_value, reference_value, measured_at, created_at
     FROM msa_measurements
     WHERE tenant_id = $1 AND study_id = $2
     ORDER BY measured_at ASC, created_at ASC`,
    [tenantId, studyId]
  );
  const measurementRows = measurementResult.rows;
  if (!measurementRows.length) {
    return res.status(400).json({ detail: 'No measurements available for calculation' });
  }

  const studyType = String(study.study_type);
  const toleranceSpan = computeToleranceSpan(study);
  let metrics: Record<string, unknown> = {};
  let passFail: 'Pass' | 'Conditional' | 'Fail' = 'Conditional';
  let recommendation = 'Review study result and take action if needed.';

  if (studyType === 'GRR') {
    const designResult = await pool.query(
      `SELECT operators_count, parts_count, trials_count, design_type, randomized
       FROM msa_grr_design
       WHERE tenant_id = $1 AND study_id = $2`,
      [tenantId, studyId]
    );
    const design = designResult.rows[0] ?? {
      operators_count: 3,
      parts_count: 10,
      trials_count: 2,
      design_type: 'Crossed',
      randomized: true,
    };
    const expectedSamples =
      Number(design.operators_count) * Number(design.parts_count) * Number(design.trials_count);
    if (measurementRows.length < expectedSamples) {
      return res.status(400).json({
        detail: 'Not enough samples for GRR calculation',
        expected_samples: expectedSamples,
        actual_samples: measurementRows.length,
      });
    }

    const allValues = measurementRows.map((row) => Number(row.measured_value)).filter((value) => Number.isFinite(value));
    const cellGroups = new Map<string, number[]>();
    const operatorGroups = new Map<string, number[]>();
    const partGroups = new Map<string, number[]>();

    measurementRows.forEach((row) => {
      const operator = String(row.operator_name ?? 'Unknown');
      const part = String(row.part_name ?? 'Unknown');
      const value = Number(row.measured_value);
      if (!Number.isFinite(value)) {
        return;
      }
      const cellKey = `${operator}::${part}`;
      cellGroups.set(cellKey, [...(cellGroups.get(cellKey) ?? []), value]);
      operatorGroups.set(operator, [...(operatorGroups.get(operator) ?? []), value]);
      partGroups.set(part, [...(partGroups.get(part) ?? []), value]);
    });

    const repeatability = avg(
      Array.from(cellGroups.values()).map((values) => stdDevSample(values)).filter((value) => value > 0)
    );
    const reproducibility = stdDevSample(
      Array.from(operatorGroups.values()).map((values) => avg(values))
    );
    const partVariation = stdDevSample(
      Array.from(partGroups.values()).map((values) => avg(values))
    );
    const totalVariation = stdDevSample(allValues);
    const grrVariation = Math.sqrt((repeatability ** 2) + (reproducibility ** 2));
    const grrPercent = totalVariation > 0 ? (grrVariation / totalVariation) * 100 : 0;
    const partPercent = totalVariation > 0 ? (partVariation / totalVariation) * 100 : 0;
    const ndc = grrVariation > 0 ? (1.41 * (partVariation / grrVariation)) : 0;

    if (grrPercent < 10) {
      passFail = 'Pass';
      recommendation = 'GRR acceptable (<10%). System is suitable for release.';
    } else if (grrPercent <= 30) {
      passFail = 'Conditional';
      recommendation = 'GRR between 10% and 30%. Use conditionally and improve measurement process.';
    } else {
      passFail = 'Fail';
      recommendation = 'GRR >30%. Measurement system not acceptable; containment and corrective action required.';
    }

    metrics = {
      study_type: 'GRR',
      expected_samples: expectedSamples,
      sample_count: measurementRows.length,
      repeatability_ev: repeatability,
      reproducibility_av: reproducibility,
      grr_variation: grrVariation,
      total_variation_tv: totalVariation,
      part_variation_pv: partVariation,
      grr_percent: grrPercent,
      pv_percent: partPercent,
      ndc,
      design,
    };
  } else if (studyType === 'Bias') {
    const defaultReference = study.reference_value !== null ? Number(study.reference_value) : null;
    const biasValues = measurementRows
      .map((row) => {
        const reference = row.reference_value !== null && row.reference_value !== undefined
          ? Number(row.reference_value)
          : defaultReference;
        const measured = Number(row.measured_value);
        if (!Number.isFinite(measured) || reference === null || !Number.isFinite(reference)) {
          return null;
        }
        return measured - reference;
      })
      .filter((value) => value !== null) as number[];

    if (biasValues.length < 10) {
      return res.status(400).json({
        detail: 'Bias study needs at least 10 valid measurements with reference values',
        actual_samples: biasValues.length,
      });
    }

    const meanBias = avg(biasValues);
    const sigma = stdDevSample(biasValues);
    const tStatistic = sigma > 0 ? (meanBias / (sigma / Math.sqrt(biasValues.length))) : 0;
    const biasPctTolerance = toleranceSpan > 0 ? (Math.abs(meanBias) / toleranceSpan) * 100 : null;

    if (biasPctTolerance !== null && biasPctTolerance <= 10) {
      passFail = 'Pass';
      recommendation = 'Bias within 10% of tolerance. System acceptable.';
    } else if (biasPctTolerance !== null && biasPctTolerance <= 30) {
      passFail = 'Conditional';
      recommendation = 'Bias moderate. Keep under monitoring and verify fixture/setup.';
    } else {
      passFail = 'Fail';
      recommendation = 'Bias exceeds acceptable limits. Recalibration and corrective action required.';
    }

    metrics = {
      study_type: 'Bias',
      sample_count: biasValues.length,
      mean_bias: meanBias,
      stddev_bias: sigma,
      t_statistic: tStatistic,
      tolerance_span: toleranceSpan || null,
      bias_pct_tolerance: biasPctTolerance,
    };
  } else if (studyType === 'Linearity') {
    const points = measurementRows
      .map((row) => {
        const reference = row.reference_value !== null && row.reference_value !== undefined
          ? Number(row.reference_value)
          : null;
        const measured = Number(row.measured_value);
        if (!Number.isFinite(measured) || reference === null || !Number.isFinite(reference)) {
          return null;
        }
        return { x: reference, y: measured - reference };
      })
      .filter((point) => point !== null) as { x: number; y: number }[];

    const distinctReferenceCount = new Set(points.map((point) => point.x.toFixed(6))).size;
    if (points.length < 15 || distinctReferenceCount < 5) {
      return res.status(400).json({
        detail: 'Linearity requires at least 15 points and 5 distinct reference levels',
        actual_samples: points.length,
        distinct_reference_levels: distinctReferenceCount,
      });
    }

    const n = points.length;
    const sumX = points.reduce((sum, point) => sum + point.x, 0);
    const sumY = points.reduce((sum, point) => sum + point.y, 0);
    const sumXY = points.reduce((sum, point) => sum + (point.x * point.y), 0);
    const sumX2 = points.reduce((sum, point) => sum + (point.x ** 2), 0);
    const denominator = (n * sumX2) - (sumX ** 2);
    const slope = denominator !== 0 ? ((n * sumXY) - (sumX * sumY)) / denominator : 0;
    const intercept = n > 0 ? ((sumY - (slope * sumX)) / n) : 0;
    const avgAbsBias = avg(points.map((point) => Math.abs(point.y)));
    const avgBiasPctTolerance = toleranceSpan > 0 ? (avgAbsBias / toleranceSpan) * 100 : null;

    if (Math.abs(slope) <= 0.1 && (avgBiasPctTolerance === null || avgBiasPctTolerance <= 10)) {
      passFail = 'Pass';
      recommendation = 'Linearity slope and average bias are within acceptance.';
    } else if (Math.abs(slope) <= 0.2 && (avgBiasPctTolerance === null || avgBiasPctTolerance <= 30)) {
      passFail = 'Conditional';
      recommendation = 'Linearity is marginal. Apply correction factor and monitor.';
    } else {
      passFail = 'Fail';
      recommendation = 'Linearity unacceptable. Investigate sensor/range non-linearity.';
    }

    metrics = {
      study_type: 'Linearity',
      sample_count: points.length,
      distinct_reference_levels: distinctReferenceCount,
      slope,
      intercept,
      avg_abs_bias: avgAbsBias,
      tolerance_span: toleranceSpan || null,
      avg_bias_pct_tolerance: avgBiasPctTolerance,
    };
  } else if (studyType === 'Stability') {
    const values = measurementRows
      .map((row) => Number(row.measured_value))
      .filter((value) => Number.isFinite(value));
    if (values.length < 20) {
      return res.status(400).json({
        detail: 'Stability study needs at least 20 measurements',
        actual_samples: values.length,
      });
    }

    const mean = avg(values);
    const sigma = stdDevSample(values);
    const outOfControl = sigma > 0
      ? values.filter((value) => Math.abs(value - mean) > (3 * sigma)).length
      : 0;

    const n = values.length;
    const xValues = Array.from({ length: n }, (_value, index) => index + 1);
    const sumX = xValues.reduce((sum, value) => sum + value, 0);
    const sumY = values.reduce((sum, value) => sum + value, 0);
    const sumXY = values.reduce((sum, value, index) => sum + (value * xValues[index]), 0);
    const sumX2 = xValues.reduce((sum, value) => sum + (value ** 2), 0);
    const denominator = (n * sumX2) - (sumX ** 2);
    const driftSlope = denominator !== 0 ? ((n * sumXY) - (sumX * sumY)) / denominator : 0;
    const driftPctTolerance = toleranceSpan > 0 ? (Math.abs(driftSlope) / toleranceSpan) * 100 : null;

    if (outOfControl === 0 && (driftPctTolerance === null || driftPctTolerance <= 1)) {
      passFail = 'Pass';
      recommendation = 'Stability is acceptable with no out-of-control points.';
    } else if (outOfControl <= 2 && (driftPctTolerance === null || driftPctTolerance <= 3)) {
      passFail = 'Conditional';
      recommendation = 'Stability has mild drift. Increase monitoring frequency.';
    } else {
      passFail = 'Fail';
      recommendation = 'Stability failed. Investigate drift and recalibrate immediately.';
    }

    metrics = {
      study_type: 'Stability',
      sample_count: values.length,
      mean,
      stddev: sigma,
      out_of_control_count: outOfControl,
      drift_slope_per_sample: driftSlope,
      tolerance_span: toleranceSpan || null,
      drift_pct_tolerance: driftPctTolerance,
    };
  } else {
    return res.status(400).json({ detail: 'Unsupported study_type' });
  }

  const resultInsert = await pool.query(
    `INSERT INTO msa_results
      (tenant_id, study_id, result_type, metrics_json, pass_fail, recommendation, calculated_by, calculated_at, created_at)
     VALUES
      ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW(), NOW())
     RETURNING id, study_id, result_type, metrics_json, pass_fail, recommendation,
               calculated_by, calculated_at, approved_by, approved_at, created_at`,
    [tenantId, studyId, studyType, JSON.stringify(metrics), passFail, recommendation, userId]
  );
  const latestResult = resultInsert.rows[0];

  await pool.query(
    `UPDATE msa_studies
     SET status = 'Calculated', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [studyId, tenantId]
  );

  let autoActionId: number | null = null;
  if (passFail === 'Fail') {
    const actionInsert = await pool.query(
      `INSERT INTO msa_actions
        (tenant_id, study_id, action_type, description, owner_name, target_date, status, created_by, created_at, updated_at)
       VALUES
        ($1, $2, 'MSA Failure', $3, $4, (CURRENT_DATE + INTERVAL '14 days')::date, 'Open', $5, NOW(), NOW())
       RETURNING id`,
      [
        tenantId,
        studyId,
        `Auto-created: ${studyType} failed for study ${study.code}.`,
        study.owner_name ?? null,
        userId,
      ]
    );
    autoActionId = Number(actionInsert.rows[0]?.id ?? 0) || null;
  }

  return res.json({
    result: latestResult,
    status: 'Calculated',
    auto_action_id: autoActionId,
  });
});

router.post('/msa/studies/:id/approve', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const study = await getMsaStudyForTenant(tenantId, studyId);
  if (!study) {
    return res.status(404).json({ detail: 'Study not found' });
  }
  const latestResultQuery = await pool.query(
    `SELECT id
     FROM msa_results
     WHERE tenant_id = $1 AND study_id = $2
     ORDER BY calculated_at DESC
     LIMIT 1`,
    [tenantId, studyId]
  );
  const latestResult = latestResultQuery.rows[0];
  if (!latestResult) {
    return res.status(400).json({ detail: 'Study has no calculated result' });
  }

  await pool.query(
    `UPDATE msa_studies
     SET status = 'Approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [userId, studyId, tenantId]
  );
  await pool.query(
    `UPDATE msa_results
     SET approved_by = $1, approved_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [userId, Number(latestResult.id), tenantId]
  );

  const updatedStudy = await getMsaStudyForTenant(tenantId, studyId);
  return res.json({ detail: 'Approved', study: updatedStudy });
});

router.post('/msa/studies/:id/reject', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const reason = String(req.body?.reason ?? '').trim();
  const study = await getMsaStudyForTenant(tenantId, studyId);
  if (!study) {
    return res.status(404).json({ detail: 'Study not found' });
  }
  await pool.query(
    `UPDATE msa_studies
     SET status = 'Rejected',
         review_notes = $1,
         approved_by = NULL,
         approved_at = NULL,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [reason || 'Rejected during review', studyId, tenantId]
  );
  const updatedStudy = await getMsaStudyForTenant(tenantId, studyId);
  return res.json({ detail: 'Rejected', study: updatedStudy });
});

router.get('/msa/studies/:id/actions', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const study = await getMsaStudyForTenant(tenantId, studyId);
  if (!study) {
    return res.status(404).json({ detail: 'Study not found' });
  }
  const { rows } = await pool.query(
    `SELECT id, study_id, action_type, description, owner_name, target_date, status, linked_nc_id, created_at, updated_at
     FROM msa_actions
     WHERE tenant_id = $1 AND study_id = $2
     ORDER BY created_at DESC`,
    [tenantId, studyId]
  );
  return res.json(rows);
});

router.post('/msa/studies/:id/actions', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const tenantId = Number(req.user?.tenant_id ?? 0);
  const userId = Number(req.user?.sub ?? 0) || null;
  const studyId = Number(req.params.id);
  if (!studyId) {
    return res.status(400).json({ detail: 'Invalid study id' });
  }
  const study = await getMsaStudyForTenant(tenantId, studyId);
  if (!study) {
    return res.status(404).json({ detail: 'Study not found' });
  }
  const payload = req.body ?? {};
  const description = String(payload.description ?? '').trim();
  if (!description) {
    return res.status(400).json({ detail: 'description is required' });
  }
  const status = String(payload.status ?? 'Open').trim();
  if (!['Open', 'In Progress', 'Closed'].includes(status)) {
    return res.status(400).json({ detail: 'Invalid status' });
  }
  const { rows } = await pool.query(
    `INSERT INTO msa_actions
      (tenant_id, study_id, action_type, description, owner_name, target_date, status, linked_nc_id, created_by, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING id, study_id, action_type, description, owner_name, target_date, status, linked_nc_id, created_at, updated_at`,
    [
      tenantId,
      studyId,
      payload.action_type ?? 'MSA Action',
      description,
      payload.owner_name ?? null,
      payload.target_date ?? null,
      status,
      payload.linked_nc_id ?? null,
      userId,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.post('/audit-plans', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  if (config.app?.disable_audit_create === 'true') {
    return res.status(403).json({ detail: 'Audit creation disabled' });
  }
  const payload = req.body ?? {};
  const code = payload.code ? String(payload.code) : generateCode();
  const auditType = payload.audit_type ? String(payload.audit_type) : null;
  if (!auditType) {
    return res.status(400).json({ detail: 'Invalid audit_type' });
  }
  const assetScope = (() => {
    if (Array.isArray(payload.asset_scope)) {
      return payload.asset_scope.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value));
    }
    if (typeof payload.asset_scope === 'string' && payload.asset_scope.trim()) {
      try {
        const parsed = JSON.parse(payload.asset_scope);
        if (Array.isArray(parsed)) {
          return parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value));
        }
      } catch {
        return null;
      }
    }
    if (typeof payload.asset_scope === 'number' && Number.isFinite(payload.asset_scope)) {
      return [payload.asset_scope];
    }
    return null;
  })();
  const assetScopeJson = assetScope ? JSON.stringify(assetScope) : null;
  const { rows } = await pool.query(
    `INSERT INTO audit_plans (tenant_id, code, start_date, end_date, audit_type, audit_subtype, auditor_name, department, location_city, site, country, region, audit_note, response_type, asset_scope, customer_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, NOW(), NOW())
     RETURNING id, code, start_date, end_date, audit_type, audit_subtype, auditor_name, department, location_city, site, country, region, audit_note, response_type, asset_scope, customer_id, created_at, updated_at`,
    [
      req.user?.tenant_id,
      code,
      payload.start_date,
      payload.end_date,
      auditType,
      payload.audit_subtype ?? null,
      payload.auditor_name ?? null,
      payload.department ?? null,
      payload.location_city ?? null,
      payload.site ?? null,
      payload.country ?? null,
      payload.region ?? null,
      payload.audit_note ?? null,
      payload.response_type ?? null,
      assetScopeJson,
      payload.customer_id ?? null,
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/audit-plans/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const planId = Number(req.params.id);
  const payload = req.body ?? {};
  const assetScope = (() => {
    if (Array.isArray(payload.asset_scope)) {
      return payload.asset_scope.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value));
    }
    if (typeof payload.asset_scope === 'string' && payload.asset_scope.trim()) {
      try {
        const parsed = JSON.parse(payload.asset_scope);
        if (Array.isArray(parsed)) {
          return parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value));
        }
      } catch {
        return undefined;
      }
    }
    if (typeof payload.asset_scope === 'number' && Number.isFinite(payload.asset_scope)) {
      return [payload.asset_scope];
    }
    return undefined;
  })();
  const assetScopeJson =
    assetScope !== undefined ? (assetScope ? JSON.stringify(assetScope) : null) : undefined;
  const fields = [
    ['start_date', payload.start_date],
    ['end_date', payload.end_date],
    ['audit_type', payload.audit_type],
    ['auditor_name', payload.auditor_name],
    ['department', payload.department],
    ['location_city', payload.location_city],
    ['site', payload.site],
    ['country', payload.country],
    ['region', payload.region],
    ['audit_note', payload.audit_note],
    ['response_type', payload.response_type],
    ['asset_scope', assetScopeJson],
    ['customer_id', payload.customer_id],
  ].filter(([, value]) => value !== undefined);
  if (!fields.length) {
    return res.status(400).json({ detail: 'No updates provided' });
  }
  const setClause = fields.map(([field], index) => `${field} = $${index + 2}`).join(', ');
  const values = fields.map(([, value]) => value);
  const { rows } = await pool.query(
    `UPDATE audit_plans SET ${setClause}, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $${fields.length + 2}
     RETURNING id, code, start_date, end_date, audit_type, audit_subtype, auditor_name, department, location_city, site, country, region, audit_note, response_type, asset_scope, customer_id, created_at, updated_at`,
    [planId, ...values, req.user?.tenant_id]
  );
  if (!rows[0]) {
    return res.status(404).json({ detail: 'Audit plan not found' });
  }
  return res.json(rows[0]);
});

router.delete('/audit-plans/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  await pool.query('DELETE FROM audit_plans WHERE id = $1 AND tenant_id = $2', [
    Number(req.params.id),
    req.user?.tenant_id,
  ]);
  return res.status(204).send();
});

router.get('/audit-answers', requireAuth, async (req: AuthedRequest, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  const auditCode = String(req.query.audit_code ?? '');
  const auditPlanId = req.query.audit_plan_id ? Number(req.query.audit_plan_id) : null;
  let planId = auditPlanId;
  if (!planId && auditCode) {
    const plan = await pool.query(
      'SELECT id FROM audit_plans WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [req.user?.tenant_id, auditCode]
    );
    planId = plan.rows[0]?.id ?? null;
  }
  if (!planId) {
    return res.status(400).json({ detail: 'Missing audit identifier' });
  }
  if (req.user?.role === 'Customer') {
    const customerEmail = await getCustomerEmail(req);
    if (!customerEmail) {
      return res.status(403).json({ detail: 'Not authorized' });
    }
    const planCheck = await pool.query(
      'SELECT customer_id FROM audit_plans WHERE id = $1 AND tenant_id = $2',
      [planId, req.user?.tenant_id]
    );
    const planCustomer = String(planCheck.rows[0]?.customer_id ?? '').toLowerCase();
    if (!planCustomer || planCustomer !== customerEmail) {
      return res.status(403).json({ detail: 'Not authorized' });
    }
  }
  const { rows } = await pool.query(
    `SELECT id, audit_plan_id, asset_number, question_index, question_text, response, response_is_negative,
            assigned_nc, note, evidence_name, evidence_data_url, evidence_urls, status, created_at, updated_at
     FROM audit_answers
     WHERE tenant_id = $1 AND audit_plan_id = $2
     ORDER BY asset_number ASC, question_index ASC`,
    [req.user?.tenant_id, planId]
  );
  return res.json(rows);
});

router.post('/evidence/presign', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  if (!spacesClient || !spacesBucket || !spacesPublicBase) {
    return res.status(500).json({ detail: 'Spaces configuration missing' });
  }
  const payload = req.body ?? {};
  const auditCode = String(payload.audit_code ?? '').trim();
  const assetNumber = Number(payload.asset_number ?? 0);
  const questionIndex = Number(payload.question_index ?? 0);
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!auditCode || !assetNumber || !files.length) {
    return res.status(400).json({ detail: 'Missing upload details' });
  }
  await ensureFolderMarkers(auditCode, assetNumber);
  const folder = buildAssetFolder(auditCode, assetNumber);
  const uploads = await Promise.all(
    files.map(async (file: any, index: number) => {
      const originalName = String(file?.name ?? `evidence-${index + 1}`);
      const contentType = String(file?.type ?? 'application/octet-stream');
      const safeName = sanitizeFilename(originalName);
      const key = `${folder}/${questionIndex + 1}-${Date.now()}-${safeName}`;
      const command = new PutObjectCommand({
        Bucket: spacesBucket,
        Key: key,
        ContentType: contentType,
        ACL: 'public-read',
      });
      const uploadUrl = await getSignedUrl(spacesClient, command, { expiresIn: 900 });
      const publicUrl = `${spacesPublicBase.replace(/\/$/, '')}/${key}`;
      return { name: originalName, key, uploadUrl, publicUrl };
    })
  );
  const folderUrl = `${spacesPublicBase.replace(/\/$/, '')}/${folder}/`;
  return res.json({ folderUrl, uploads });
});

router.get('/evidence/list', requireAuth, async (req: AuthedRequest, res) => {
  if (!spacesClient || !spacesBucket || !spacesPublicBase) {
    return res.status(500).json({ detail: 'Spaces configuration missing' });
  }
  const auditCode = String(req.query.audit_code ?? '').trim();
  if (!auditCode) {
    return res.status(400).json({ detail: 'Missing audit code' });
  }
  if (req.user?.role === 'Customer') {
    const customerEmail = await getCustomerEmail(req);
    if (!customerEmail) {
      return res.status(403).json({ detail: 'Not authorized' });
    }
    const planCheck = await pool.query(
      'SELECT customer_id FROM audit_plans WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [req.user?.tenant_id, auditCode]
    );
    const planCustomer = String(planCheck.rows[0]?.customer_id ?? '').toLowerCase();
    if (!planCustomer || planCustomer !== customerEmail) {
      return res.status(403).json({ detail: 'Not authorized' });
    }
  }
  const prefix = `${auditCode}/`;
  const { Contents } = await spacesClient.send(
    new ListObjectsV2Command({
      Bucket: spacesBucket,
      Prefix: prefix,
    })
  );
  const items =
    Contents?.filter((item) => item.Key && !item.Key.endsWith('/')).map(async (item) => {
      const key = item.Key as string;
      const command = new GetObjectCommand({
        Bucket: spacesBucket,
        Key: key,
      });
      const signedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 3600 });
      return {
        key,
        url: signedUrl,
        size: item.Size ?? 0,
        lastModified: item.LastModified ? item.LastModified.toISOString() : '',
      };
    }) ?? [];
  const resolvedItems = await Promise.all(items);
  const folderUrl = `${spacesPublicBase.replace(/\/$/, '')}/${prefix}`;
  return res.json({ folderUrl, items: resolvedItems });
});

router.post('/evidence/sign', requireAuth, async (req: AuthedRequest, res) => {
  if (!spacesClient || !spacesBucket) {
    return res.status(500).json({ detail: 'Spaces configuration missing' });
  }
  const payload = req.body ?? {};
  const auditCode = String(payload.audit_code ?? '').trim();
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  if (!auditCode || !keys.length) {
    return res.status(400).json({ detail: 'Missing keys' });
  }
  if (req.user?.role === 'Customer') {
    const customerEmail = await getCustomerEmail(req);
    if (!customerEmail) {
      return res.status(403).json({ detail: 'Not authorized' });
    }
    const planCheck = await pool.query(
      'SELECT customer_id FROM audit_plans WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [req.user?.tenant_id, auditCode]
    );
    const planCustomer = String(planCheck.rows[0]?.customer_id ?? '').toLowerCase();
    if (!planCustomer || planCustomer !== customerEmail) {
      return res.status(403).json({ detail: 'Not authorized' });
    }
  }
  const urls = await Promise.all(
    keys.map(async (rawKey: string) => {
      const key = String(rawKey ?? '').replace(/^\/+/, '');
      const command = new GetObjectCommand({
        Bucket: spacesBucket,
        Key: key,
      });
      return getSignedUrl(spacesClient, command, { expiresIn: 3600 });
    })
  );
  return res.json({ urls });
});

router.post('/evidence/delete', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  if (!spacesClient || !spacesBucket) {
    return res.status(500).json({ detail: 'Spaces configuration missing' });
  }
  const payload = req.body ?? {};
  const auditCode = String(payload.audit_code ?? '').trim();
  const key = normalizeEvidenceKey(payload.key ?? '');
  if (!auditCode || !key) {
    return res.status(400).json({ detail: 'Missing delete details' });
  }
  if (!key.startsWith(`${auditCode}/`)) {
    return res.status(400).json({ detail: 'Invalid evidence key' });
  }
  const planCheck = await pool.query(
    'SELECT id FROM audit_plans WHERE tenant_id = $1 AND code = $2 LIMIT 1',
    [req.user?.tenant_id, auditCode]
  );
  if (!planCheck.rows.length) {
    return res.status(404).json({ detail: 'Audit not found' });
  }
  await spacesClient.send(
    new DeleteObjectCommand({
      Bucket: spacesBucket,
      Key: key,
    })
  );
  return res.json({ ok: true });
});

router.post('/audit-answers', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const auditCode = payload.audit_code ? String(payload.audit_code) : '';
  const auditPlanId = payload.audit_plan_id ? Number(payload.audit_plan_id) : null;
  let planId = auditPlanId;
  if (!planId && auditCode) {
    const plan = await pool.query(
      'SELECT id FROM audit_plans WHERE tenant_id = $1 AND code = $2 LIMIT 1',
      [req.user?.tenant_id, auditCode]
    );
    planId = plan.rows[0]?.id ?? null;
  }
  const questionIndex =
    payload.question_index !== undefined ? Number(payload.question_index) : null;
  const assetNumber =
    payload.asset_number !== undefined && payload.asset_number !== null
      ? Number(payload.asset_number)
      : 1;
  const evidenceUrls = Array.isArray(payload.evidence_urls) ? payload.evidence_urls : null;
  if (!planId || questionIndex === null) {
    return res.status(400).json({ detail: 'Missing audit answer fields' });
  }
  const { rows } = await pool.query(
    `INSERT INTO audit_answers
      (tenant_id, audit_plan_id, asset_number, question_index, question_text, response, response_is_negative,
       assigned_nc, note, evidence_name, evidence_data_url, evidence_urls, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
     ON CONFLICT (tenant_id, audit_plan_id, asset_number, question_index)
     DO UPDATE SET
       question_text = EXCLUDED.question_text,
       response = EXCLUDED.response,
       response_is_negative = EXCLUDED.response_is_negative,
       assigned_nc = EXCLUDED.assigned_nc,
       note = EXCLUDED.note,
       evidence_name = EXCLUDED.evidence_name,
       evidence_data_url = EXCLUDED.evidence_data_url,
       evidence_urls = EXCLUDED.evidence_urls,
       status = EXCLUDED.status,
       updated_at = NOW()
     RETURNING id, audit_plan_id, asset_number, question_index, question_text, response, response_is_negative,
               assigned_nc, note, evidence_name, evidence_data_url, evidence_urls, status, created_at, updated_at`,
    [
      req.user?.tenant_id,
      planId,
      assetNumber,
      questionIndex,
      payload.question_text ?? '',
      payload.response ?? null,
      payload.response_is_negative ?? false,
      payload.assigned_nc ?? null,
      payload.note ?? null,
      payload.evidence_name ?? null,
      payload.evidence_data_url ?? null,
      evidenceUrls ? JSON.stringify(evidenceUrls) : null,
      payload.status ?? 'Saved',
    ]
  );
  return res.status(201).json(rows[0]);
});

router.put('/audit-answers/:id/assigned-nc', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const answerId = Number(req.params.id);
  if (!answerId) {
    return res.status(400).json({ detail: 'Missing answer id' });
  }
  const assignedNc = String(req.body?.assigned_nc ?? '').trim();
  const { rows } = await pool.query(
    `UPDATE audit_answers
     SET assigned_nc = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3
     RETURNING id, assigned_nc`,
    [assignedNc || null, answerId, req.user?.tenant_id]
  );
  if (!rows.length) {
    return res.status(404).json({ detail: 'Answer not found' });
  }
  return res.json(rows[0]);
});

router.get('/nc-records', requireAuth, async (req: AuthedRequest, res) => {
  const customerEmail = await getCustomerEmail(req);
  const { rows } = await pool.query(
    `SELECT a.id AS answer_id,
            p.code AS audit_code,
            p.audit_type,
            p.audit_subtype,
            p.start_date,
            p.end_date,
            p.auditor_name,
            a.asset_number,
            a.question_text,
            a.response,
            a.assigned_nc,
            a.note,
            a.updated_at AS submitted_at,
            n.root_cause,
            n.containment_action,
            n.corrective_action,
            n.preventive_action,
            n.evidence_name,
            n.gd_summary,
            n.fishbone_data,
            n.why_why_data,
            n.assigned_user_id,
            u.first_name AS assigned_user_first_name,
            u.last_name AS assigned_user_last_name,
            u.email AS assigned_user_email,
            COALESCE(n.status, 'Assigned') AS nc_status
     FROM audit_answers a
     JOIN audit_plans p ON p.id = a.audit_plan_id
     LEFT JOIN nc_actions n ON n.audit_answer_id = a.id AND n.tenant_id = a.tenant_id
     LEFT JOIN users u ON u.id = n.assigned_user_id AND u.tenant_id = a.tenant_id
     WHERE a.tenant_id = $1
       AND a.status = 'Submitted'
       AND a.response_is_negative = TRUE
       ${customerEmail ? 'AND p.customer_id = $2' : ''}
     ORDER BY a.updated_at DESC`,
    customerEmail ? [req.user?.tenant_id, customerEmail] : [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/nc-actions', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === 'Customer') {
    return res.status(403).json({ detail: 'Not authorized' });
  }
  const payload = req.body ?? {};
  const answerId = Number(payload.answer_id);
  if (!answerId) {
    return res.status(400).json({ detail: 'Missing answer id' });
  }
  const requestedStatus = String(payload.status ?? 'In Progress');
  const gdSummary = String(payload.gd_summary ?? '').trim();
  const fishboneData = sanitizeFishbone(payload.fishbone_data);
  const whyWhyData = sanitizeWhyWhy(payload.why_why_data);
  const assignedUserId =
    payload.assigned_user_id !== undefined && payload.assigned_user_id !== null
      ? Number(payload.assigned_user_id)
      : null;
  const userId = Number(req.user?.sub ?? 0);
  if (!userId) {
    return res.status(401).json({ detail: 'Missing user' });
  }
  const userQuery = await pool.query(
    'SELECT first_name, last_name, department FROM users WHERE id = $1 AND tenant_id = $2',
    [userId, req.user?.tenant_id]
  );
  const user = userQuery.rows[0];
  if (!user) {
    return res.status(401).json({ detail: 'Invalid user' });
  }
  const auditQuery = await pool.query(
    `SELECT p.auditor_name, a.assigned_nc
     FROM audit_answers a
     JOIN audit_plans p ON p.id = a.audit_plan_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [answerId, req.user?.tenant_id]
  );
  const auditRow = auditQuery.rows[0];
  const auditorName = String(auditRow?.auditor_name ?? '').toLowerCase();
  const assignedDepartment = String(auditRow?.assigned_nc ?? '').toLowerCase();
  const userFullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim().toLowerCase();
  const userRole = String(req.user?.role ?? '').trim().toLowerCase();
  if (assignedUserId) {
    const assigneeQuery = await pool.query(
      'SELECT department FROM users WHERE id = $1 AND tenant_id = $2',
      [assignedUserId, req.user?.tenant_id]
    );
    const assignee = assigneeQuery.rows[0];
    const assigneeDepartment = String(assignee?.department ?? '').toLowerCase();
    if (!assigneeDepartment || assigneeDepartment !== assignedDepartment) {
      return res.status(400).json({ detail: 'Invalid assignee for department' });
    }
  }
  if (requestedStatus === 'Closed' || requestedStatus === 'Rework') {
    if (userRole !== 'manager' && (!userFullName || userFullName !== auditorName)) {
      return res.status(403).json({ detail: 'Not authorized to change status' });
    }
  }
  if (requestedStatus === 'Resolution Submitted' || requestedStatus === 'In Progress') {
    const userDepartment = String(user.department ?? '').toLowerCase();
    if (!userDepartment || userDepartment !== assignedDepartment) {
      return res.status(403).json({ detail: 'Not authorized to submit resolution' });
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO nc_actions
      (tenant_id, audit_answer_id, root_cause, containment_action, corrective_action,
       preventive_action, evidence_name, gd_summary, fishbone_data, why_why_data,
       assigned_user_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, NOW(), NOW())
     ON CONFLICT (tenant_id, audit_answer_id)
     DO UPDATE SET
       root_cause = EXCLUDED.root_cause,
       containment_action = EXCLUDED.containment_action,
       corrective_action = EXCLUDED.corrective_action,
       preventive_action = EXCLUDED.preventive_action,
       evidence_name = EXCLUDED.evidence_name,
       gd_summary = EXCLUDED.gd_summary,
       fishbone_data = EXCLUDED.fishbone_data,
       why_why_data = EXCLUDED.why_why_data,
       assigned_user_id = EXCLUDED.assigned_user_id,
       status = EXCLUDED.status,
       updated_at = NOW()
     RETURNING id, audit_answer_id, root_cause, containment_action, corrective_action,
               preventive_action, evidence_name, gd_summary, fishbone_data, why_why_data,
               assigned_user_id, status, created_at, updated_at`,
    [
      req.user?.tenant_id,
      answerId,
      payload.root_cause ?? null,
      payload.containment_action ?? null,
      payload.corrective_action ?? null,
      payload.preventive_action ?? null,
      payload.evidence_name ?? null,
      gdSummary || null,
      JSON.stringify(fishboneData),
      JSON.stringify(whyWhyData),
      assignedUserId,
      requestedStatus,
    ]
  );
  return res.json(rows[0]);
});

app.use('/', router);
app.use('/api', router);

export const api = functions.region('asia-south1').https.onRequest(app);

export const complaintEscalationScheduler = functions
  .region('asia-south1')
  .pubsub.schedule('every 30 minutes')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const result = await evaluateComplaintEscalations();
    functions.logger.info('Complaint escalation scheduler run', result);
    return null;
  });
