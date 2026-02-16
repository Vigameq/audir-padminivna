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
import { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
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

const jwtSecret = env.jwtSecret;
const jwtExpiryMinutes = Number(env.accessTokenExpireMinutes);

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
  const passwordHash = await bcrypt.hash(String(payload.password ?? ''), 10);
  const { rows } = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, phone, department, role, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id, email, first_name, last_name, phone, department, role, status, last_active, created_at`,
    [
      req.user?.tenant_id,
      String(payload.email ?? '').toLowerCase(),
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
    'SELECT id, name, note, tags, questions, created_at FROM audit_templates WHERE tenant_id = $1 ORDER BY created_at DESC',
    [req.user?.tenant_id]
  );
  return res.json(rows);
});

router.post('/templates', requireAuth, async (req: AuthedRequest, res) => {
  const { name, note, tags, questions } = req.body ?? {};
  const { rows } = await pool.query(
    `INSERT INTO audit_templates (tenant_id, name, note, tags, questions, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, name, note, tags, questions, created_at`,
    [req.user?.tenant_id, name, note ?? null, JSON.stringify(tags ?? []), JSON.stringify(questions ?? [])]
  );
  return res.status(201).json(rows[0]);
});

router.put('/templates/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { name, note, tags, questions } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE audit_templates
     SET name = $1, note = $2, tags = $3, questions = $4
     WHERE id = $5 AND tenant_id = $6
     RETURNING id, name, note, tags, questions, created_at`,
    [
      name,
      note ?? null,
      JSON.stringify(tags ?? []),
      JSON.stringify(questions ?? []),
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
       preventive_action, evidence_name, assigned_user_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     ON CONFLICT (tenant_id, audit_answer_id)
     DO UPDATE SET
       root_cause = EXCLUDED.root_cause,
       containment_action = EXCLUDED.containment_action,
       corrective_action = EXCLUDED.corrective_action,
       preventive_action = EXCLUDED.preventive_action,
       evidence_name = EXCLUDED.evidence_name,
       assigned_user_id = EXCLUDED.assigned_user_id,
       status = EXCLUDED.status,
       updated_at = NOW()
     RETURNING id, audit_answer_id, root_cause, containment_action, corrective_action,
               preventive_action, evidence_name, assigned_user_id, status, created_at, updated_at`,
    [
      req.user?.tenant_id,
      answerId,
      payload.root_cause ?? null,
      payload.containment_action ?? null,
      payload.corrective_action ?? null,
      payload.preventive_action ?? null,
      payload.evidence_name ?? null,
      assignedUserId,
      requestedStatus,
    ]
  );
  return res.json(rows[0]);
});

app.use('/', router);
app.use('/api', router);

export const api = functions.region('asia-south1').https.onRequest(app);
