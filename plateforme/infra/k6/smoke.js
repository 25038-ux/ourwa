import http from 'k6/http';
import { check, group } from 'k6';

/**
 * Load smoke test. Introduced in Phase 3 per the bootstrap, kept here from
 * session 1 so the harness is not a late unknown.
 *
 * What this measures is NOT throughput — one school of ~2,000 students is small.
 * It measures that tenant resolution stays correct under concurrency: the bug
 * worth hunting is a tenant setting leaking across a pooled connection, and that
 * only appears when requests interleave.
 */

const API = __ENV.API_URL || 'http://localhost:3001';
const BRANCHES = ['nour', 'rissala', 'salam'];

export const options = {
  scenarios: {
    interleaved_tenants: {
      executor: 'constant-vus',
      vus: 30,
      duration: '20s',
    },
  },
  thresholds: {
    checks: ['rate==1.00'],          // any wrong-tenant answer fails the run
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  // Deliberately random so branches interleave on the same pooled connections.
  const slug = BRANCHES[Math.floor(Math.random() * BRANCHES.length)];

  group('student count is always the calling branch\'s own', () => {
    const response = http.get(`${API}/students/count`, {
      headers: { 'X-School-Slug': slug },
    });
    const body = response.json();
    check(response, {
      'status 200': (r) => r.status === 200,
      'answered for the branch we asked for': () => body.school === slug,
      'count is this branch alone, never the platform total': () => body.total === 200,
    });
  });
}
