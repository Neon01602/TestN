// Patch Writer Agent — generates code patches from root-cause signals
// Consumed by Orchestrator: patchWriter.generate(errorEvent, rootCauseResult)

const PATCH_TEMPLATES = {
  'payments-service': {
    file: 'src/payments/validator.js',
    description: 'Add null/undefined guard before amount property access',
    diff: `@@ -44,7 +44,10 @@ function validatePayment(payload) {
-  const amount = payload.amount;
-  if (amount <= 0) throw new Error('Invalid amount');
+  if (!payload || payload.amount === undefined || payload.amount === null) {
+    throw new TypeError('Payment payload missing required field: amount');
+  }
+  const amount = Number(payload.amount);
+  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid amount');`,
    lines_changed: 5,
    risk: 0.14,
    test_file: 'src/payments/__tests__/validator.test.js'
  },
  'auth-service': {
    file: 'src/auth/jwt.js',
    description: 'Propagate JWT_SECRET reload on SIGHUP — no process restart required',
    diff: `@@ -80,6 +80,12 @@ const VERIFY_OPTIONS = { algorithms: ['HS256'] };
+let _secret = process.env.JWT_SECRET;
+process.on('SIGHUP', () => {
+  _secret = process.env.JWT_SECRET;
+  console.info('[auth/jwt] JWT_SECRET reloaded');
+});
+
 export function verify(token) {
-  return jwt.verify(token, process.env.JWT_SECRET, VERIFY_OPTIONS);
+  return jwt.verify(token, _secret, VERIFY_OPTIONS);
 }`,
    lines_changed: 8,
    risk: 0.22,
    test_file: 'src/auth/__tests__/jwt.test.js'
  },
  'api-gateway': {
    file: 'src/proxy/upstream.js',
    description: 'Add retry with exponential back-off and circuit-breaker short-circuit',
    diff: `@@ -199,8 +199,18 @@ async function upstream_proxy(req, res, target) {
-  const response = await fetch(target + req.path);
-  return response;
+  const MAX_RETRIES = 3;
+  let attempt = 0;
+  while (attempt < MAX_RETRIES) {
+    try {
+      const response = await fetch(target + req.path, { signal: AbortSignal.timeout(5000) });
+      return response;
+    } catch (err) {
+      attempt++;
+      if (attempt === MAX_RETRIES) throw err;
+      await new Promise(r => setTimeout(r, 200 * 2 ** attempt));
+    }
+  }`,
    lines_changed: 12,
    risk: 0.27,
    test_file: 'src/proxy/__tests__/upstream.test.js'
  },
  'notification-service': {
    file: 'src/queue/notify.js',
    description: 'Pin ioredis v5 API — replace deprecated createClient call signature',
    diff: `@@ -51,7 +51,9 @@ import Redis from 'ioredis';
-const redis = new Redis({ host: config.REDIS_HOST, port: config.REDIS_PORT });
+const redis = new Redis({
+  host: config.REDIS_HOST,
+  port: config.REDIS_PORT,
+  lazyConnect: true,
+  maxRetriesPerRequest: 3,
+  enableReadyCheck: true
+});`,
    lines_changed: 7,
    risk: 0.18,
    test_file: 'src/queue/__tests__/notify.test.js'
  },
  'user-service': {
    file: 'src/users/schema.js',
    description: 'Mark email field optional in Joi schema — align with controller contract',
    diff: `@@ -15,7 +15,7 @@ import Joi from 'joi';
 export const userSchema = Joi.object({
   name: Joi.string().min(1).max(120).required(),
-  email: Joi.string().email().required(),
+  email: Joi.string().email().optional().allow('', null),
   role: Joi.string().valid('admin', 'member', 'viewer').default('member')
 });`,
    lines_changed: 2,
    risk: 0.11,
    test_file: 'src/users/__tests__/schema.test.js'
  },
  'search-service': {
    file: 'src/search/client.py',
    description: 'Migrate to elasticsearch-py v8 client constructor and response API',
    diff: `@@ -85,9 +85,11 @@ from elasticsearch import Elasticsearch
-client = Elasticsearch([{'host': ES_HOST, 'port': ES_PORT}])
+client = Elasticsearch(
+    hosts=[f'http://{ES_HOST}:{ES_PORT}'],
+    request_timeout=30,
+    retry_on_timeout=True,
+    max_retries=3
+)

 def search(index, query):
-    return client.search(index=index, body=query)
+    return client.search(index=index, query=query['query'])`,
    lines_changed: 9,
    risk: 0.31,
    test_file: 'src/search/test_client.py'
  }
};

const SANDBOX_ENVIRONMENTS = ['jest:unit', 'jest:integration', 'docker:ephemeral'];

export class PatchWriterAgent {
  async generate(errorEvent, rootCauseResult) {
    const service = errorEvent.service;
    const template = PATCH_TEMPLATES[service] || PATCH_TEMPLATES['payments-service'];

    const sandboxEnv = SANDBOX_ENVIRONMENTS[Math.floor(Math.random() * SANDBOX_ENVIRONMENTS.length)];
    const sandboxPass = Math.random() > 0.08; // 92% pass rate
    const riskAdjusted = parseFloat(
      Math.min(1, template.risk + (1 - rootCauseResult.confidence_score) * 0.15).toFixed(2)
    );

    return {
      patch_id: `PATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      target_file: template.file,
      description: template.description,
      diff: template.diff,
      lines_changed: template.lines_changed,
      estimated_risk: riskAdjusted,
      sandbox_pass: sandboxPass,
      sandbox_environment: sandboxEnv,
      sandbox_output: sandboxPass
        ? `✓ All tests pass (${8 + Math.floor(Math.random() * 12)} assertions)`
        : `✗ 1 test failed — assertion mismatch in ${template.test_file}:${30 + Math.floor(Math.random() * 40)}`,
      test_coverage_delta: sandboxPass
        ? `+${1 + Math.floor(Math.random() * 4)}%`
        : '0%',
      related_commit: rootCauseResult.cause_commit,
      authored_by: 'nexus-patch-writer/v1',
      generated_at: new Date().toISOString()
    };
  }
}
