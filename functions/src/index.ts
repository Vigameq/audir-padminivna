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
