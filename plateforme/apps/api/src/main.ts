import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env before anything reads process.env. Without stable
// JWT keys the dev server generates an ephemeral pair on every restart, which
// silently logs everyone out each time a file is saved.
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import { corsEnv, isAllowedOrigin } from './cors.js';
import { applyApiSecurityHeaders } from './security-headers.js';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { logger: ['error', 'warn', 'log'] },
  );

  /**
   * Compress responses.
   *
   * ⚠ THE API WAS SENDING EVERYTHING UNCOMPRESSED. The web app is behind Next,
   * which gzips its own HTML, so this was invisible there — but the parent app
   * talks to this directly, over mobile data in Nouakchott that families pay
   * for by the megabyte. JSON is the most compressible thing there is.
   *
   * `threshold` keeps tiny payloads alone: below about a kilobyte the header
   * and the CPU cost more than the saving.
   */
  await app.register(compress, {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
  });

  // Homework attachments arrive as multipart. The limit is declared here as
  // well as checked in the validator: the plugin stops reading once it is
  // passed, so an oversized upload never reaches memory in the first place.
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  /**
   * ⚠ THE API SENT NO SECURITY HEADERS AT ALL. The web app carries a full set
   * because it renders HTML; this one answers JSON and so looked as though it
   * needed none. The one that matters most is `Cache-Control: no-store` —
   * every authenticated response here is one family's debt, one child's marks
   * or one colleague's salary, and without it a proxy between the school and
   * this server may keep a copy and hand it to whoever asks next.
   *
   * `onSend` rather than `onRequest`: a header set on the way out covers error
   * responses too, and an error page is a document.
   */
  app.getHttpAdapter().getInstance().addHook('onSend', (request, reply, payload, done) => {
    applyApiSecurityHeaders(request, reply);
    done(null, payload);
  });

  /**
   * ⚠ THIS SAID YES TO EVERY ORIGIN, WITH `credentials: true`.
   *
   * Any page a signed-in member of staff opened could make authenticated
   * requests against this API from their browser — students, debts, payroll.
   * The comment excused it as a development convenience, and the convenience is
   * real (every *.localhost subdomain is a branch), but the predicate said yes
   * in production too.
   *
   * `isAllowedOrigin` now decides, and it fails closed: no configured suffix
   * means nothing is allowed. See src/cors.ts.
   */
  const cors = corsEnv();
  if (!cors.dev && !cors.suffix) {
    // Refusing to boot beats booting with the door open — a missing env var in
    // production would otherwise be indistinguishable from a working deploy.
    throw new Error(
      'ALLOWED_ORIGIN_SUFFIX must be set in production (e.g. "elourwa.com"). ' +
        'Refusing to start with an unrestricted CORS policy.',
    );
  }
  /*
   * ⚠ FASTIFY 5 ATTEND LA FORME ASYNCHRONE. Son rappel à la mode `(origin, cb)`
   * n'est plus dans le type ; on rend la réponse au lieu de la passer. La
   * DÉCISION ne change pas d'un caractère : `isAllowedOrigin` répond, et il
   * échoue fermé — aucun suffixe configuré, aucune origine admise. Les huit
   * tests de `cors.spec.ts` portent sur cette fonction, pas sur la plomberie,
   * et c'est pourquoi ils tiennent toujours après le saut de version.
   */
  app.enableCors({
    origin: async (origin: string | undefined) => isAllowedOrigin(origin, cors),
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://localhost:${port}`);
  console.log('Try: curl -H "X-School-Slug: nour" http://localhost:3001/students/count');
}

bootstrap().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
